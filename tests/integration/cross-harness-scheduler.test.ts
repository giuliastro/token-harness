import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harnessId,
  scheduleCrossHarness,
  type CrossHarnessSchedulerInput,
  type HarnessSchedulingEvidence,
} from '@token-harness/core';

function evidence(
  id: 'claude' | 'codex',
  overrides: Partial<HarnessSchedulingEvidence> = {},
): HarnessSchedulingEvidence {
  return {
    harnessId: harnessId(id),
    available: true,
    fiveHourPace: 'on-pace',
    weeklyPace: 'on-pace',
    quality: 'passed',
    qualityTaskClass: 'hard',
    qualitySamples: 3,
    ...overrides,
  };
}

function input(overrides: Partial<CrossHarnessSchedulerInput> = {}): CrossHarnessSchedulerInput {
  return {
    taskClass: 'hard',
    current: evidence('claude', { fiveHourPace: 'over-pace' }),
    candidate: evidence('codex', { fiveHourPace: 'under-pace' }),
    transfer: {
      handoffBytes: 900,
      maxHandoffBytes: 2048,
      benefit: 'proven-positive',
    },
    ...overrides,
  };
}

test('switches only when pressure, headroom, quality and transfer benefit are all proven', () => {
  const decision = scheduleCrossHarness(input());

  assert.equal(decision.decision, 'switch');
  assert.deepEqual(
    decision.reasons.map((entry) => entry.code),
    [
      'current-over-pace',
      'candidate-headroom',
      'candidate-quality-passed',
      'transfer-benefit-positive',
    ],
  );
});

test('stays when the current harness has healthy headroom', () => {
  const decision = scheduleCrossHarness(
    input({ current: evidence('claude', { fiveHourPace: 'on-pace', weeklyPace: 'under-pace' }) }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'current-headroom-healthy');
});

test('refuses to infer candidate headroom from unknown quota state', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { fiveHourPace: 'unknown' }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'candidate-quota-unknown');
});

test('requires quality evidence for the exact task class', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { qualityTaskClass: 'mechanical' }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'candidate-quality-task-mismatch');
});

test('requires at least one attributable quality sample', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { qualitySamples: 0, qualityTaskClass: null }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'candidate-quality-unattributed');
});

test('stays when quality-gated evidence fails for the candidate', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { quality: 'failed', qualitySamples: 2 }) }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'candidate-quality-failed');
});

test('stays when the compact handoff exceeds its transfer budget', () => {
  const decision = scheduleCrossHarness(
    input({
      transfer: { handoffBytes: 2049, maxHandoffBytes: 2048, benefit: 'proven-positive' },
    }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'handoff-over-budget');
});

test('does not switch when transfer benefit is unknown', () => {
  const decision = scheduleCrossHarness(
    input({ transfer: { handoffBytes: 900, maxHandoffBytes: 2048, benefit: 'unknown' } }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'transfer-benefit-unknown');
});

test('stays when comparable evidence says transfer cost is not worth it', () => {
  const decision = scheduleCrossHarness(
    input({ transfer: { handoffBytes: 900, maxHandoffBytes: 2048, benefit: 'non-positive' } }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'transfer-cost-not-worth-it');
});

test('same-harness scheduling is a stay without further inference', () => {
  const current = evidence('codex', { fiveHourPace: 'over-pace' });
  const decision = scheduleCrossHarness(input({ current, candidate: current }));

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'same-harness');
});

test('malformed evidence is surfaced instead of converted into a recommendation', () => {
  const invalidTransfer = scheduleCrossHarness(
    input({ transfer: { handoffBytes: -1, maxHandoffBytes: 2048, benefit: 'proven-positive' } }),
  );
  assert.equal(invalidTransfer.decision, 'insufficient-evidence');
  assert.equal(invalidTransfer.reasons[0]?.code, 'invalid-transfer-evidence');

  const invalidQuality = scheduleCrossHarness(
    input({ candidate: evidence('codex', { qualitySamples: -1 }) }),
  );
  assert.equal(invalidQuality.decision, 'insufficient-evidence');
  assert.equal(invalidQuality.reasons[0]?.code, 'invalid-quality-evidence');
});
