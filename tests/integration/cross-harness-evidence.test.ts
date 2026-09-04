import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessId,
  hydrateCrossHarnessPaceFromBudget,
  type BudgetReport,
  type CrossHarnessSchedulerInput,
  type UsageConfidence,
  type UsageWindowSnapshot,
} from '@token-harness/core';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const OBSERVED_AT = '2026-09-04T13:00:00.000Z';

function window(input: {
  harnessId: typeof CLAUDE;
  scope: 'five-hour' | 'weekly';
  usedPercent: number;
  confidence?: UsageConfidence;
}): UsageWindowSnapshot {
  return {
    harnessId: input.harnessId,
    bucketId: `${input.harnessId}-${input.scope}`,
    bucketName: input.scope,
    window: 'primary',
    scope: input.scope,
    usedPercent: input.usedPercent,
    remainingPercent: 100 - input.usedPercent,
    windowDurationMinutes: input.scope === 'five-hour' ? 300 : 10_080,
    resetsAt:
      input.scope === 'five-hour'
        ? '2026-09-04T15:00:00.000Z'
        : '2026-09-08T10:00:00.000Z',
    observedAt: OBSERVED_AT,
    source: 'native-rpc',
    confidence: input.confidence ?? 'authoritative',
  };
}

function report(input?: {
  currentConfidence?: UsageConfidence;
  duplicateCandidateWeekly?: boolean;
}): BudgetReport {
  const candidateWeekly = window({ harnessId: CODEX, scope: 'weekly', usedPercent: 20 });
  const currentFiveHour = window({
    harnessId: CLAUDE,
    scope: 'five-hour',
    usedPercent: 70,
    ...(input?.currentConfidence === undefined ? {} : { confidence: input.currentConfidence }),
  });
  return {
    platform: {
      os: 'linux',
      osDisplayName: 'Linux',
      arch: 'x64',
      nodeVersion: '22.13.0',
      isWsl: false,
    },
    observedAt: OBSERVED_AT,
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'observed',
        windows: [currentFiveHour, window({ harnessId: CLAUDE, scope: 'weekly', usedPercent: 60 })],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
      {
        harnessId: CODEX,
        state: 'observed',
        windows: [
          window({ harnessId: CODEX, scope: 'five-hour', usedPercent: 20 }),
          candidateWeekly,
          ...(input?.duplicateCandidateWeekly ? [candidateWeekly] : []),
        ],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
    ],
  };
}

function schedulerInput(): CrossHarnessSchedulerInput {
  return {
    taskClass: 'hard',
    current: {
      harnessId: CLAUDE,
      available: true,
      fiveHourPace: 'unknown',
      weeklyPace: 'unknown',
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    candidate: {
      harnessId: CODEX,
      available: true,
      fiveHourPace: 'unknown',
      weeklyPace: 'unknown',
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    transfer: {
      handoffBytes: 512,
      maxHandoffBytes: 2048,
      benefit: 'unknown',
    },
  };
}

test('hydrates each harness from its own observed allowance windows', () => {
  const hydrated = hydrateCrossHarnessPaceFromBudget(schedulerInput(), report());

  assert.equal(hydrated.input.current.fiveHourPace, 'over-pace');
  assert.equal(hydrated.input.current.weeklyPace, 'over-pace');
  assert.equal(hydrated.input.candidate.fiveHourPace, 'under-pace');
  assert.equal(hydrated.input.candidate.weeklyPace, 'under-pace');
  assert.equal(hydrated.notes.filter((entry) => entry.code === 'budget-pace-observed').length, 4);
});

test('cached provider quota never becomes live scheduler pace', () => {
  const hydrated = hydrateCrossHarnessPaceFromBudget(
    schedulerInput(),
    report({ currentConfidence: 'cached' }),
  );

  assert.equal(hydrated.input.current.fiveHourPace, 'unknown');
  assert.ok(
    hydrated.notes.some(
      (entry) =>
        entry.harnessId === CLAUDE &&
        entry.scope === 'five-hour' &&
        entry.code === 'budget-pace-unknown',
    ),
  );
});

test('ambiguous same-scope windows remain unknown instead of picking one', () => {
  const hydrated = hydrateCrossHarnessPaceFromBudget(
    schedulerInput(),
    report({ duplicateCandidateWeekly: true }),
  );

  assert.equal(hydrated.input.candidate.weeklyPace, 'unknown');
  assert.ok(
    hydrated.notes.some(
      (entry) =>
        entry.harnessId === CODEX &&
        entry.scope === 'weekly' &&
        entry.code === 'budget-window-ambiguous',
    ),
  );
});

test('explicit scheduler pace evidence wins over automatic hydration', () => {
  const input = schedulerInput();
  input.current.fiveHourPace = 'on-pace';
  const hydrated = hydrateCrossHarnessPaceFromBudget(input, report());

  assert.equal(hydrated.input.current.fiveHourPace, 'on-pace');
  assert.ok(
    hydrated.notes.some(
      (entry) =>
        entry.harnessId === CLAUDE &&
        entry.scope === 'five-hour' &&
        entry.code === 'explicit-pace-preserved',
    ),
  );
});

test('budget hydration never fabricates quality or transfer benefit', () => {
  const input = schedulerInput();
  const hydrated = hydrateCrossHarnessPaceFromBudget(input, report());

  assert.equal(hydrated.input.candidate.quality, 'unknown');
  assert.equal(hydrated.input.candidate.qualityTaskClass, null);
  assert.equal(hydrated.input.candidate.qualitySamples, 0);
  assert.equal(hydrated.input.transfer.benefit, 'unknown');
  assert.deepEqual(hydrated.input.transfer, input.transfer);
});

test('an unobserved budget state does not turn into headroom', () => {
  const budget = report();
  budget.harnesses[1]!.state = 'unavailable';
  budget.harnesses[1]!.windows = [];
  const hydrated = hydrateCrossHarnessPaceFromBudget(schedulerInput(), budget);

  assert.equal(hydrated.input.candidate.fiveHourPace, 'unknown');
  assert.equal(hydrated.input.candidate.weeklyPace, 'unknown');
  assert.equal(hydrated.notes.filter((entry) => entry.code === 'budget-not-observed').length, 2);
});
