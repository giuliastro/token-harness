import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  refineVerbosityForAllowance,
  type AcceptedTaskCapacityEstimate,
  type VerbosityLearningDecision,
} from '../src/index.js';

const CODEX = harnessId('codex');

function learning(baseVerbosity: string, candidateVerbosity: string): VerbosityLearningDecision {
  return {
    state: 'learned',
    verification: 'config-only',
    policy: { model: 'gpt-5.6', reasoningEffort: 'medium' },
    baseVerbosity,
    recommendedVerbosity: candidateVerbosity,
    candidateVerbosity,
    minimumPairs: 3,
    matchedReceipts: 6,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [{ code: 'fixture-learning', summary: 'quality-gated verbosity fixture' }],
  };
}

function capacity(
  verbosity: string,
  fiveHourCost: number,
  weeklyCost: number,
  remaining = 4,
): AcceptedTaskCapacityEstimate {
  return {
    harnessId: CODEX,
    taskClass: 'standard',
    policy: {
      model: 'gpt-5.6',
      reasoningEffort: 'medium',
      verbosity,
    },
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

function unknownCapacity(verbosity: string): AcceptedTaskCapacityEstimate {
  const base = capacity(verbosity, 5, 8);
  return {
    ...base,
    status: 'insufficient-evidence',
    acceptedTasksRemaining: null,
    fiveHour: {
      ...base.fiveHour,
      sampleCount: 1,
      p75UsedPercentPerAcceptedTask: null,
    },
  };
}

describe('verbosity quality per allowance', () => {
  it('adopts lower verbosity only when p75 quota cost is non-worse in both windows and better in one', () => {
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9, 3),
      candidateCapacity: capacity('low', 4, 9, 5),
    });
    assert.equal(decision.state, 'allowance-efficient');
    assert.equal(decision.recommendedVerbosity, 'low');
    assert.equal(decision.reasons[0]?.code, 'verbosity-allowance-throughput-improved');
  });

  it('keeps base verbosity when the lower setting worsens either included window', () => {
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9),
      candidateCapacity: capacity('low', 4, 10),
    });
    assert.equal(decision.state, 'kept');
    assert.equal(decision.recommendedVerbosity, 'medium');
    assert.equal(decision.reasons[0]?.code, 'verbosity-allowance-no-throughput-gain');
  });

  it('does not lower verbosity when exact-policy backend capacity is incomplete', () => {
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9),
      candidateCapacity: unknownCapacity('low'),
    });
    assert.equal(decision.state, 'kept');
    assert.equal(decision.recommendedVerbosity, 'medium');
    assert.equal(decision.reasons[0]?.code, 'verbosity-allowance-capacity-unproven');
  });

  it('allows demonstrated quality recovery to raise verbosity when capacity remains', () => {
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('low', 'medium'),
      baseCapacity: capacity('low', 4, 6, 6),
      candidateCapacity: capacity('medium', 7, 10, 2),
    });
    assert.equal(decision.state, 'quality-recovery');
    assert.equal(decision.recommendedVerbosity, 'medium');
    assert.equal(decision.reasons[0]?.code, 'verbosity-quality-recovery-with-capacity');
  });

  it('defers higher verbosity when measured safe capacity is below one accepted task', () => {
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('low', 'medium'),
      baseCapacity: capacity('low', 4, 6, 1),
      candidateCapacity: capacity('medium', 7, 10, 0),
    });
    assert.equal(decision.state, 'deferred');
    assert.equal(decision.recommendedVerbosity, null);
    assert.equal(decision.reasons[0]?.code, 'verbosity-quality-recovery-no-capacity');
  });

  it('fails closed when capacity came from a different fixed reasoning effort', () => {
    const candidate = capacity('low', 4, 8);
    candidate.policy = { ...candidate.policy!, reasoningEffort: 'high' };
    const decision = refineVerbosityForAllowance({
      taskClass: 'standard',
      learning: learning('medium', 'low'),
      baseCapacity: capacity('medium', 6, 9),
      candidateCapacity: candidate,
    });
    assert.equal(decision.state, 'unavailable');
    assert.equal(decision.recommendedVerbosity, 'medium');
    assert.equal(decision.reasons[0]?.code, 'verbosity-quality-per-allowance-capacity-mismatch');
  });
});
