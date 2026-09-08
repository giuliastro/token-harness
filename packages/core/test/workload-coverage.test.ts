import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessWorkloadCoverage,
  constrainBudgetForWorkload,
  harnessId,
  type AcceptedTaskCapacityEstimate,
  type BudgetDecision,
} from '../src/index.js';

const CODEX = harnessId('codex');

function capacity(acceptedTasksRemaining: number | null): AcceptedTaskCapacityEstimate {
  return {
    harnessId: CODEX,
    taskClass: 'standard',
    policy: { model: 'gpt-5.6', reasoningEffort: 'medium', verbosity: 'low' },
    status: acceptedTasksRemaining === null ? 'insufficient-evidence' : 'estimated',
    acceptedTasksRemaining,
    eligibleReceipts: 3,
    fiveHour: {
      scope: 'five-hour',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: acceptedTasksRemaining === null ? null : 4,
      spendableRemainingPercent: acceptedTasksRemaining === null ? null : 20,
      taskEquivalents: acceptedTasksRemaining === null ? null : acceptedTasksRemaining + 0.5,
    },
    weekly: {
      scope: 'weekly',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: acceptedTasksRemaining === null ? null : 6,
      spendableRemainingPercent: acceptedTasksRemaining === null ? null : 30,
      taskEquivalents: acceptedTasksRemaining === null ? null : acceptedTasksRemaining + 1,
    },
    reasons: [],
  };
}

function budget(state: BudgetDecision['state']): BudgetDecision {
  return {
    state,
    allowEffortIncrease: state === 'use-headroom',
    pressuredScopes: [],
    missingScopes: [],
    recheckAt: state === 'wait-for-reset' ? '2026-09-08T10:00:00.000Z' : null,
    reasons: [{ code: `budget-${state}`, summary: state }],
  };
}

describe('workload coverage', () => {
  it('does not infer a workload target when the user supplied none', () => {
    const decision = assessWorkloadCoverage({ tasksRemaining: null, capacity: capacity(8) });

    assert.equal(decision.state, 'unavailable');
    assert.equal(decision.protectCapacity, false);
    assert.equal(decision.acceptedTasksRemaining, null);
    assert.equal(decision.reasons[0]?.code, 'workload-target-absent');
  });

  it('keeps the target advisory until exact-policy capacity is complete', () => {
    const decision = assessWorkloadCoverage({ tasksRemaining: 5, capacity: capacity(null) });

    assert.equal(decision.state, 'unknown');
    assert.equal(decision.protectCapacity, false);
    assert.equal(decision.reasons[0]?.code, 'workload-capacity-unproven');
  });

  it('rejects class-level capacity that does not carry an exact policy boundary', () => {
    const estimate = capacity(8);
    delete estimate.policy;
    const decision = assessWorkloadCoverage({ tasksRemaining: 5, capacity: estimate });

    assert.equal(decision.state, 'unknown');
    assert.equal(decision.reasons[0]?.code, 'workload-capacity-unproven');
  });

  it('reports the uncovered backlog without converting tokens into quota', () => {
    const decision = assessWorkloadCoverage({ tasksRemaining: 5, capacity: capacity(2) });

    assert.equal(decision.state, 'shortfall');
    assert.equal(decision.acceptedTasksRemaining, 2);
    assert.equal(decision.shortfallTasks, 3);
    assert.equal(decision.coverageRatio, 0.4);
    assert.equal(decision.protectCapacity, true);
  });

  it('reports exact-policy capacity as covered when it fits the stated backlog', () => {
    const decision = assessWorkloadCoverage({ tasksRemaining: 5, capacity: capacity(7) });

    assert.equal(decision.state, 'covered');
    assert.equal(decision.shortfallTasks, 0);
    assert.equal(decision.coverageRatio, 1.4);
    assert.equal(decision.protectCapacity, false);
  });

  it('turns headroom into conservation when the backlog exceeds current capacity', () => {
    const workload = assessWorkloadCoverage({ tasksRemaining: 5, capacity: capacity(2) });
    const decision = constrainBudgetForWorkload(budget('use-headroom'), workload);

    assert.equal(decision.state, 'conserve');
    assert.equal(decision.allowEffortIncrease, false);
    assert.equal(decision.reasons.at(-1)?.code, 'workload-capacity-shortfall');
  });

  it('does not weaken an exhausted reset decision', () => {
    const workload = assessWorkloadCoverage({ tasksRemaining: 5, capacity: capacity(0) });
    const before = budget('wait-for-reset');
    const decision = constrainBudgetForWorkload(before, workload);

    assert.deepEqual(decision, before);
  });
});
