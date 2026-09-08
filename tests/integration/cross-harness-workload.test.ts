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
    tasksRemaining: 5,
    current: evidence('claude', { acceptedTasksRemaining: 2 }),
    candidate: evidence('codex', { acceptedTasksRemaining: 6 }),
    transfer: {
      handoffBytes: 700,
      maxHandoffBytes: 2048,
      benefit: 'proven-positive',
    },
    ...overrides,
  };
}

test('explicit backlog can route before raw pace becomes over-pace', () => {
  const decision = scheduleCrossHarness(input());

  assert.equal(decision.decision, 'switch');
  assert.equal(decision.tasksRemaining, 5);
  assert.deepEqual(
    decision.reasons.map((entry) => entry.code),
    [
      'current-capacity-below-workload',
      'candidate-headroom',
      'candidate-workload-covered',
      'candidate-quality-passed',
      'transfer-benefit-positive',
    ],
  );
});

test('candidate must cover the stated backlog when workload routing is requested', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { acceptedTasksRemaining: 4 }) }),
  );

  assert.equal(decision.decision, 'stay');
  assert.equal(decision.reasons[0]?.code, 'candidate-capacity-below-workload');
});

test('unknown candidate capacity cannot be treated as backlog coverage', () => {
  const decision = scheduleCrossHarness(
    input({ candidate: evidence('codex', { acceptedTasksRemaining: null }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'candidate-workload-capacity-unknown');
});

test('healthy current pace with unknown workload capacity stays evidence-gated', () => {
  const decision = scheduleCrossHarness(
    input({ current: evidence('claude', { acceptedTasksRemaining: null }) }),
  );

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'current-workload-capacity-unknown');
});

test('an invalid workload target cannot create a routing recommendation', () => {
  const decision = scheduleCrossHarness(input({ tasksRemaining: 0 }));

  assert.equal(decision.decision, 'insufficient-evidence');
  assert.equal(decision.reasons[0]?.code, 'invalid-workload-target');
});

test('omitting workload target preserves the historical capacity semantics', () => {
  const decision = scheduleCrossHarness(
    input({
      tasksRemaining: null,
      current: evidence('claude', { fiveHourPace: 'over-pace', acceptedTasksRemaining: null }),
      candidate: evidence('codex', { acceptedTasksRemaining: null }),
    }),
  );

  assert.equal(decision.decision, 'switch');
  assert.equal(decision.tasksRemaining, null);
  assert.equal(decision.reasons[0]?.code, 'current-over-pace');
  assert.equal(
    decision.reasons.some((entry) => entry.code === 'candidate-capacity-sufficient'),
    false,
  );
});
