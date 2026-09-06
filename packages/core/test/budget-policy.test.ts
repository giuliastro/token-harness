import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessBudgetDecision,
  assessWindowPace,
  BUDGET_PROFILES,
  chooseSupportedEffort,
  TASK_CLASSES,
  type TaskClass,
  type WindowPaceAssessment,
} from '../src/domain/optimizer.js';
import type { UsageWindowSnapshot } from '../src/domain/budget.js';

const NOW = '2026-09-06T12:00:00.000Z';
const CODEX = 'codex' as UsageWindowSnapshot['harnessId'];
const CLAUDE = 'claude' as UsageWindowSnapshot['harnessId'];
const SUPPORTED = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function snapshot(patch: Partial<UsageWindowSnapshot> = {}): UsageWindowSnapshot {
  return {
    harnessId: CODEX,
    bucketId: 'included',
    bucketName: 'Included allowance',
    window: 'primary',
    scope: 'five-hour',
    usedPercent: 30,
    remainingPercent: 70,
    windowDurationMinutes: 300,
    resetsAt: '2026-09-06T12:30:00.000Z',
    observedAt: NOW,
    source: 'native-rpc',
    confidence: 'authoritative',
    ...patch,
  };
}
function short(used = 30, patch: Partial<UsageWindowSnapshot> = {}): WindowPaceAssessment {
  return assessWindowPace(
    snapshot({ usedPercent: used, remainingPercent: 100 - used, ...patch }),
    NOW,
    20,
  );
}
function weekly(used = 20, patch: Partial<UsageWindowSnapshot> = {}): WindowPaceAssessment {
  return short(used, {
    scope: 'weekly',
    window: 'secondary',
    windowDurationMinutes: 10_080,
    resetsAt: '2026-09-09T12:00:00.000Z',
    ...patch,
  });
}
function effort(pace: WindowPaceAssessment[], taskClass: TaskClass = 'hard') {
  return chooseSupportedEffort({
    supported: SUPPORTED,
    current: 'high',
    defaultEffort: 'medium',
    taskClass,
    profile: 'balanced',
    pace,
    contextPressure: 'low',
  });
}

describe('joint five-hour and seven-day policy', () => {
  for (const harnessId of [CODEX, CLAUDE]) {
    it(`${harnessId}: weekly pressure vetoes expiring short-window headroom`, () => {
      const pace = [short(30, { harnessId }), weekly(75, { harnessId })];
      assert.equal(assessBudgetDecision(pace, 'hard').state, 'conserve');
      assert.equal(effort(pace), 'medium');
      assert.equal(effort([pace[0]!]), 'high');
    });
  }
  it('uses headroom on difficult work only when both windows are safe', () => {
    assert.equal(assessBudgetDecision([short(), weekly()], 'hard').state, 'use-headroom');
    assert.equal(effort([short(), weekly()]), 'xhigh');
    assert.equal(assessBudgetDecision([short(), weekly()], 'mechanical').state, 'balanced');
  });
  it('does not assume that a missing weekly limit means unlimited weekly allowance', () => {
    const result = assessBudgetDecision([short()], 'hard');
    assert.equal(result.state, 'unknown');
    assert.deepEqual(result.missingScopes, ['weekly']);
    assert.equal(result.allowEffortIncrease, false);
  });
  it('treats a reserve breach as pressure even inside the pacing deadband', () => {
    const window = short(82, { resetsAt: '2026-09-06T12:00:10.000Z' });
    assert.equal(window.state, 'on-pace');
    assert.equal(window.spendableRemainingPercent, 0);
    assert.equal(assessBudgetDecision([window, weekly()], 'hard').state, 'conserve');
  });
  it('keeps full reset precision instead of making the last seconds look expired', () => {
    const window = short(30, { resetsAt: '2026-09-06T12:00:10.000Z' });
    assert.equal(window.minutesToReset, 1 / 6);
    assert.equal(window.spendablePercentPerHour, 18_000);
    assert.equal(assessBudgetDecision([window, weekly()], 'hard').state, 'use-headroom');
  });
  it('rechecks after the latest known exhausted reset, not merely the next short reset', () => {
    const result = assessBudgetDecision([short(100), weekly(100)], 'critical');
    assert.equal(result.state, 'wait-for-reset');
    assert.equal(result.recheckAt, '2026-09-09T12:00:00.000Z');
    assert.equal(result.allowEffortIncrease, false);
    assert.equal(effort([short(100), weekly(100)], 'critical'), 'high');
    assert.match(result.reasons[0]!.summary, /other limits may still apply/);
  });
  it('never ranks, sums, or silently maps multiple same-scope buckets', () => {
    const ambiguous = [short(), weekly(), weekly(0, { bucketId: 'other-model' })];
    assert.equal(assessBudgetDecision(ambiguous, 'hard').state, 'unknown');
    assert.equal(assessBudgetDecision([...ambiguous, weekly(100)], 'hard').state, 'conserve');
    assert.equal(assessBudgetDecision([...ambiguous, weekly(100)], 'hard').recheckAt, null);
  });
  it('does not mix Codex and Claude quota domains', () => {
    const result = assessBudgetDecision([short(), weekly(10, { harnessId: CLAUDE })], 'hard');
    assert.equal(result.state, 'unknown');
    assert.equal(result.reasons[0]!.code, 'mixed-budget-domains');
  });
  it('ignores paid credit inventory in both directions', () => {
    const safe = [short(), weekly()];
    const credit = short(100, { scope: 'credit', harnessId: CLAUDE });
    assert.deepEqual(
      assessBudgetDecision([...safe, credit], 'hard'),
      assessBudgetDecision(safe, 'hard'),
    );
  });
  it('requires additional unmapped limits to be resolved before a spending bonus', () => {
    assert.equal(
      assessBudgetDecision([short(), weekly(), short(0, { scope: 'model' })], 'hard').state,
      'unknown',
    );
  });
  it('keeps allowances separate and labels the allocation instead of forecasting burn', () => {
    const window = short();
    assert.equal(window.spendableRemainingPercent, 50);
    assert.equal(window.spendablePercentPerHour, 100);
    assert.equal(weekly().spendablePercentPerHour, 60 / 72);
  });
  it('does not let context pressure turn a quota bonus into an effort increase', () => {
    assert.equal(
      chooseSupportedEffort({
        supported: SUPPORTED,
        current: 'medium',
        defaultEffort: 'medium',
        taskClass: 'hard',
        profile: 'quality',
        pace: [short(), weekly()],
        contextPressure: 'high',
      }),
      'medium',
    );
  });
  it('refuses an unsupported quality floor instead of endorsing a below-floor fallback', () => {
    assert.equal(
      chooseSupportedEffort({
        supported: ['low'],
        current: 'low',
        defaultEffort: 'low',
        taskClass: 'critical',
        profile: 'economy',
        pace: [short(100), weekly(100)],
        contextPressure: 'low',
      }),
      null,
    );
  });
  it('preserves a supported unranked preference without inventing its quality', () => {
    assert.equal(
      chooseSupportedEffort({
        supported: ['custom-fast'],
        current: 'custom-fast',
        defaultEffort: null,
        taskClass: 'critical',
        profile: 'quality',
        pace: [],
        contextPressure: 'unknown',
      }),
      'custom-fast',
    );
  });
});

describe('quota evidence admission', () => {
  const cases: [string, Partial<UsageWindowSnapshot>][] = [
    ['cached', { confidence: 'cached' }],
    ['estimated', { confidence: 'estimated' }],
    ['local token history', { source: 'local-history' }],
    ['unknown source', { source: 'unknown' }],
    ['stale authoritative snapshot', { observedAt: '2026-09-06T11:54:59.000Z' }],
    ['future snapshot', { observedAt: '2026-09-06T12:01:01.000Z' }],
    ['invalid observation time', { observedAt: 'invalid' }],
    ['negative used', { usedPercent: -1 }],
    ['excess used', { usedPercent: 101 }],
    ['NaN used', { usedPercent: NaN }],
    ['infinite remaining', { remainingPercent: Infinity }],
    ['inconsistent percentages', { usedPercent: 20, remainingPercent: 70 }],
    ['zero duration', { windowDurationMinutes: 0 }],
    ['infinite duration', { windowDurationMinutes: Infinity }],
    ['missing reset', { resetsAt: null }],
    ['expired reset', { resetsAt: NOW }],
    ['invalid reset', { resetsAt: 'invalid' }],
    [
      'previous cycle observation',
      {
        observedAt: '2026-09-06T11:58:00.000Z',
        resetsAt: '2026-09-06T16:59:00.000Z',
      },
    ],
  ];
  for (const [name, patch] of cases) {
    it(`rejects ${name} as evidence for extra spending`, () => {
      const window = short(30, patch);
      assert.equal(window.state, 'unknown');
      assert.equal(window.spendablePercentPerHour, null);
      assert.equal(assessBudgetDecision([window, weekly()], 'hard').allowEffortIncrease, false);
    });
  }
  it('admits the documented freshness boundary and small clock skew', () => {
    assert.notEqual(short(30, { observedAt: '2026-09-06T11:55:00.000Z' }).state, 'unknown');
    assert.notEqual(short(30, { observedAt: '2026-09-06T12:01:00.000Z' }).state, 'unknown');
  });
  it('admits rounded backend values conservatively', () => {
    const window = short(30, { remainingPercent: 69.5 });
    assert.equal(window.usedPercent, 30.5);
    assert.equal(window.remainingPercent, 69.5);
  });
  it('derives remaining only from an observed valid used percentage', () => {
    assert.equal(short(30, { remainingPercent: null }).remainingPercent, 70);
    assert.equal(short(30, { usedPercent: null }).state, 'unknown');
  });
  for (const reserve of [-1, 96, NaN, Infinity]) {
    it(`rejects invalid reserve ${String(reserve)}`, () => {
      assert.equal(assessWindowPace(snapshot(), NOW, reserve).state, 'unknown');
    });
  }
});

describe('deterministic policy invariants', () => {
  it('adding weekly pressure never increases effort across profiles and task classes', () => {
    for (const taskClass of TASK_CLASSES)
      for (const profile of BUDGET_PROFILES) {
        for (const used of [0, 10, 30, 60, 80, 90, 100]) {
          const choose = (pace: WindowPaceAssessment[]) =>
            chooseSupportedEffort({
              supported: SUPPORTED,
              current: 'high',
              defaultEffort: 'medium',
              taskClass,
              profile,
              pace,
              contextPressure: 'low',
            });
          const initial = choose([short(used), weekly()]);
          const pressured = choose([short(used), weekly(90)]);
          assert.ok(SUPPORTED.indexOf(pressured!) <= SUPPORTED.indexOf(initial!));
        }
      }
  });
  it('is order invariant and never leaves the supported catalog or task quality floor', () => {
    const floors = { mechanical: 0, standard: 1, hard: 2, critical: 3 };
    for (const taskClass of TASK_CLASSES)
      for (const profile of BUDGET_PROFILES) {
        for (let five = 0; five <= 100; five += 5)
          for (let week = 0; week <= 100; week += 5) {
            const pace = [short(five), weekly(week)];
            assert.deepEqual(
              assessBudgetDecision(pace, taskClass),
              assessBudgetDecision([...pace].reverse(), taskClass),
            );
            const result = chooseSupportedEffort({
              supported: [...SUPPORTED].reverse(),
              current: 'high',
              defaultEffort: 'medium',
              taskClass,
              profile,
              pace,
              contextPressure: 'low',
            });
            assert.ok(result !== null && SUPPORTED.includes(result));
            assert.ok(SUPPORTED.indexOf(result!) >= floors[taskClass]);
          }
      }
  });
});
