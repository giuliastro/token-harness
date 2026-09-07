import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  refineModelForAllowance,
  type AcceptedTaskCapacityEstimate,
  type ModelLearningDecision,
} from '../src/index.js';

const CODEX = harnessId('codex');

function learning(
  intent: 'allowance-efficiency' | 'quality-recovery' = 'allowance-efficiency',
): ModelLearningDecision {
  return {
    state: 'learned',
    verification: 'config-only',
    policy: { reasoningEffort: 'medium', verbosity: 'medium' },
    baseModel: 'model-a',
    recommendedModel: 'model-b',
    candidateModel: 'model-b',
    intent,
    minimumPairs: 3,
    matchedReceipts: 6,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [{ code: 'fixture-model-learning', summary: 'quality-gated fixture' }],
  };
}

function capacity(
  model: string,
  fiveHourCost: number,
  weeklyCost: number,
  remaining = 4,
): AcceptedTaskCapacityEstimate {
  return {
    harnessId: CODEX,
    taskClass: 'standard',
    policy: { model, reasoningEffort: 'medium', verbosity: 'medium' },
    status: 'estimated',
    acceptedTasksRemaining: remaining,
    eligibleReceipts: 3,
    fiveHour: {
      scope: 'five-hour',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: fiveHourCost,
      spendableRemainingPercent: 20,
      taskEquivalents: 20 / fiveHourCost,
    },
    weekly: {
      scope: 'weekly',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: weeklyCost,
      spendableRemainingPercent: 40,
      taskEquivalents: 40 / weeklyCost,
    },
    reasons: [],
  };
}

function unknown(model: string): AcceptedTaskCapacityEstimate {
  const result = capacity(model, 4, 8);
  return {
    ...result,
    status: 'insufficient-evidence',
    acceptedTasksRemaining: null,
    weekly: { ...result.weekly, sampleCount: 1, p75UsedPercentPerAcceptedTask: null },
  };
}

describe('model quality per allowance refinement', () => {
  it('switches only when p75 quota cost is non-worse in both windows and better in one', () => {
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning(),
      baseCapacity: capacity('model-a', 6, 9, 3),
      candidateCapacity: capacity('model-b', 4, 9, 5),
    });

    assert.equal(decision.state, 'allowance-efficient');
    assert.equal(decision.recommendedModel, 'model-b');
    assert.equal(decision.reasons[0]?.code, 'model-allowance-throughput-improved');
  });

  it('keeps the current model if the candidate worsens either allowance window', () => {
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning(),
      baseCapacity: capacity('model-a', 6, 9),
      candidateCapacity: capacity('model-b', 4, 10),
    });

    assert.equal(decision.state, 'kept');
    assert.equal(decision.recommendedModel, 'model-a');
    assert.equal(decision.reasons[0]?.code, 'model-allowance-no-throughput-gain');
  });

  it('does not switch models from incomplete exact capacity even after outcome learning', () => {
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning(),
      baseCapacity: capacity('model-a', 6, 9),
      candidateCapacity: unknown('model-b'),
    });

    assert.equal(decision.state, 'capacity-unproven');
    assert.equal(decision.recommendedModel, 'model-a');
    assert.equal(decision.reasons[0]?.code, 'model-capacity-unproven');
  });

  it('permits a proven quality-recovery model when at least one accepted task still fits', () => {
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning('quality-recovery'),
      baseCapacity: capacity('model-a', 4, 6, 2),
      candidateCapacity: capacity('model-b', 8, 12, 1),
    });

    assert.equal(decision.state, 'quality-recovery');
    assert.equal(decision.recommendedModel, 'model-b');
    assert.equal(decision.reasons[0]?.code, 'model-quality-recovery-with-capacity');
  });

  it('defers even quality recovery when the candidate has zero accepted-task capacity', () => {
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning('quality-recovery'),
      baseCapacity: capacity('model-a', 4, 6, 1),
      candidateCapacity: capacity('model-b', 8, 12, 0),
    });

    assert.equal(decision.state, 'deferred');
    assert.equal(decision.recommendedModel, null);
    assert.equal(decision.reasons[0]?.code, 'model-candidate-no-capacity');
  });

  it('rejects exact-capacity evidence from another policy tuple', () => {
    const mismatched = capacity('model-b', 4, 8);
    mismatched.policy = { ...mismatched.policy!, verbosity: 'high' };
    const decision = refineModelForAllowance({
      taskClass: 'standard',
      learning: learning(),
      baseCapacity: capacity('model-a', 6, 9),
      candidateCapacity: mismatched,
    });

    assert.equal(decision.state, 'kept');
    assert.equal(decision.recommendedModel, 'model-a');
    assert.equal(decision.reasons[0]?.code, 'model-capacity-policy-mismatch');
  });
});
