import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  refineEffortForAllowance,
  type AcceptedTaskCapacityEstimate,
  type EffortLearningDecision,
} from '../src/index.js';

const CODEX = harnessId('codex');

function learning(
  baseEffort: string,
  candidateEffort: string,
  overrides: Partial<EffortLearningDecision> = {},
): EffortLearningDecision {
  return {
    state: 'learned',
    verification: 'config-only',
    policy: { model: 'gpt-5.6', verbosity: 'low' },
    baseEffort,
    recommendedEffort: candidateEffort,
    candidateEffort,
    minimumPairs: 3,
    matchedReceipts: 6,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [{ code: 'fixture-learning', summary: 'quality-gated fixture' }],
    ...overrides,
  };
}

function capacity(
  effort: string,
  fiveHourCost: number,
  weeklyCost: number,
  remaining = 4,
): AcceptedTaskCapacityEstimate {
  return {
    harnessId: CODEX,
    taskClass: 'standard',
    policy: { model: 'gpt-5.6', reasoningEffort: effort, verbosity: 'low' },
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

function unknownCapacity(effort: string): AcceptedTaskCapacityEstimate {
  const base = capacity(effort, 5, 8);
  return {
    ...base,
    status: 'insufficient-evidence',
    acceptedTasksRemaining: null,
    fiveHour: { ...base.fiveHour, sampleCount: 1, p75UsedPercentPerAcceptedTask: null },
  };
}

describe('quality per allowance effort refinement', () => {
  it('adopts a learned lower effort only when p75 quota cost is non-worse in both windows and better in one', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9, 3),
      candidateCapacity: capacity('low', 4, 9, 5),
    });

    assert.equal(decision.state, 'allowance-efficient');
    assert.equal(decision.recommendedEffort, 'low');
    assert.equal(decision.reasons[0]?.code, 'allowance-throughput-improved');
  });

  it('keeps the base effort when the lower effort worsens either included allowance window', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9),
      candidateCapacity: capacity('low', 4, 10),
    });

    assert.equal(decision.state, 'kept');
    assert.equal(decision.recommendedEffort, 'medium');
    assert.equal(decision.reasons[0]?.code, 'allowance-no-throughput-gain');
  });

  it('preserves a quality-gated lower effort without making a throughput claim when exact capacity is incomplete', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9),
      candidateCapacity: unknownCapacity('low'),
    });

    assert.equal(decision.state, 'capacity-unproven');
    assert.equal(decision.recommendedEffort, 'low');
    assert.equal(decision.reasons[0]?.code, 'allowance-capacity-unproven');
  });

  it('lets repeated quality recovery use higher effort when at least one accepted task still fits', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'standard',
      learning: learning('low', 'medium'),
      baseCapacity: capacity('low', 4, 6, 6),
      candidateCapacity: capacity('medium', 7, 10, 2),
    });

    assert.equal(decision.state, 'quality-recovery');
    assert.equal(decision.recommendedEffort, 'medium');
    assert.equal(decision.reasons[0]?.code, 'quality-recovery-with-capacity');
  });

  it('defers higher effort when measured safe capacity is below one accepted task', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'standard',
      learning: learning('low', 'medium'),
      baseCapacity: capacity('low', 4, 6, 1),
      candidateCapacity: capacity('medium', 7, 10, 0),
    });

    assert.equal(decision.state, 'deferred');
    assert.equal(decision.recommendedEffort, null);
    assert.equal(decision.reasons[0]?.code, 'quality-recovery-no-capacity');
  });

  it('cannot lower effort below the task quality floor even if a malformed learned decision asks for it', () => {
    const decision = refineEffortForAllowance({
      taskClass: 'critical',
      learning: learning('high', 'low'),
      baseCapacity: capacity('high', 8, 12),
      candidateCapacity: capacity('low', 2, 3),
    });

    assert.equal(decision.state, 'unavailable');
    assert.equal(decision.recommendedEffort, 'high');
    assert.equal(decision.reasons[0]?.code, 'quality-per-allowance-policy-unranked');
  });
});
