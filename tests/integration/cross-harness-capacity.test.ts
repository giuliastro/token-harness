import assert from 'node:assert/strict';
import { test } from 'node:test';

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
    current: evidence('claude'),
    candidate: evidence('codex', { acceptedTasksRemaining: 4 }),
    transfer: {
      handoffBytes: 700,
      maxHandoffBytes: 2048,
      benefit: 'proven-positive',
    },
    ...overrides,
  };
}

test('accepted-task capacity can prove current allowance pressure before raw pace crosses its deadband', () => {
  const decision = scheduleCrossHarness(
    input({ current: evidence('claude', { acceptedTasksRemaining: 0 }) }),
  );

  assert.equal(decision.decision, 'switch');
  assert.deepEqual(
    decision.reasons.map((entry) => entry.code),
    [
      'current-capacity-below-one',
      'candidate-headroom',
      'candidate-capacity-sufficient',
      'candidate-quality-passed',
      'transfer-benefit-positive',
    ],
  );
});

test('candidate with less than one conservative accepted-task equivalent is not selected', () => {
  const decision = scheduleCrossHarness(
    input({
      current: evidence('claude', { fiveHourPace: 'over-pace' }),
      candidate: evidence('codex', { fiveHourPace: 'under-pace', acceptedTasksRemaining: 0 }),
    }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'candidate-capacity-below-one');
});

test('unknown capacity remains additive and does not weaken existing safe routing evidence', () => {
  const decision = scheduleCrossHarness(
    input({
      current: evidence('claude', { fiveHourPace: 'over-pace' }),
      candidate: evidence('codex', { fiveHourPace: 'under-pace', acceptedTasksRemaining: null }),
    }),
  );

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

test('malformed task-capacity evidence cannot create a routing recommendation', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { acceptedTasksRemaining: 1.5 }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'invalid-capacity-evidence');
});
