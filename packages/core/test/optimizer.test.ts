import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessWindowPace,
  chooseSupportedEffort,
  harnessId,
  type UsageWindowSnapshot,
} from '../src/index.js';

const CODEX = harnessId('codex');

function window(usedPercent: number): UsageWindowSnapshot {
  return {
    harnessId: CODEX,
    bucketId: 'codex',
    bucketName: 'Codex',
    window: 'primary',
    scope: 'five-hour',
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes: 300,
    resetsAt: '2026-08-30T16:00:00.000Z',
    observedAt: '2026-08-30T14:00:00.000Z',
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

describe('quota pacing', () => {
  it('compares backend usage with elapsed spendable allowance', () => {
    const pace = assessWindowPace(window(70), '2026-08-30T14:00:00.000Z', 20);
    assert.equal(pace.state, 'over-pace');
    assert.equal(pace.targetUsedPercent, 48);
    assert.equal(pace.minutesToReset, 120);
  });

  it('keeps pacing unknown when reset timing is not proved', () => {
    const pace = assessWindowPace(
      { ...window(20), resetsAt: null },
      '2026-08-30T14:00:00.000Z',
      20,
    );
    assert.equal(pace.state, 'unknown');
    assert.equal(pace.targetUsedPercent, null);
  });

  it('never uses cached quota snapshots for live pacing', () => {
    const pace = assessWindowPace(
      { ...window(70), confidence: 'cached', source: 'companion-cli' },
      '2026-08-30T14:00:00.000Z',
      20,
    );
    assert.equal(pace.state, 'unknown');
    assert.equal(pace.targetUsedPercent, null);
    assert.match(pace.reason, /cached/i);
  });
});

describe('quality-floor effort policy', () => {
  it('does not let economy plus over-pace push a hard task below medium', () => {
    const pace = [assessWindowPace(window(70), '2026-08-30T14:00:00.000Z', 20)];
    assert.equal(
      chooseSupportedEffort({
        supported: ['low', 'medium', 'high', 'xhigh'],
        current: 'high',
        defaultEffort: 'medium',
        taskClass: 'hard',
        profile: 'economy',
        pace,
        contextPressure: 'low',
      }),
      'medium',
    );
  });

  it('can spend under-used headroom near reset on a hard task', () => {
    const pace = [assessWindowPace(window(30), '2026-08-30T15:30:00.000Z', 20)];
    assert.equal(pace[0]?.state, 'under-pace');
    assert.equal(
      chooseSupportedEffort({
        supported: ['medium', 'high', 'xhigh'],
        current: 'high',
        defaultEffort: 'medium',
        taskClass: 'hard',
        profile: 'balanced',
        pace,
        contextPressure: 'low',
      }),
      'xhigh',
    );
  });

  it('never invents an effort value outside the model catalog', () => {
    assert.equal(
      chooseSupportedEffort({
        supported: ['custom-fast'],
        current: 'custom-fast',
        defaultEffort: 'custom-fast',
        taskClass: 'critical',
        profile: 'quality',
        pace: [],
        contextPressure: 'unknown',
      }),
      'custom-fast',
    );
  });
});
