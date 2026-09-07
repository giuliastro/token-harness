import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VERBOSITY_LEARNING_MIN_PAIRS,
  harnessId,
  refineVerbosityWithOutcomes,
  type TaskBenchmarkReceipt,
  type VerbosityLearningInput,
} from '../src/index.js';

const NOW = '2026-09-07T12:00:00.000Z';
const MODEL = 'fixture-model';

function receipt(
  index: number,
  variant: 'baseline' | 'optimized',
  patch: Partial<TaskBenchmarkReceipt> = {},
): TaskBenchmarkReceipt {
  const start =
    Date.parse('2026-09-07T08:00:00Z') + (index * 60 + (variant === 'optimized' ? 15 : 0)) * 60_000;
  const verbosity = variant === 'baseline' ? 'medium' : 'low';
  const total = variant === 'baseline' ? 1000 : 700;
  return {
    schemaVersion: 1,
    benchmarkId: 'verbosity-' + String(index),
    variant,
    taskClass: 'standard',
    harnessId: harnessId('codex'),
    model: MODEL,
    reasoningEffort: 'medium',
    verbosity,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + 10 * 60_000).toISOString(),
    usageBefore: [],
    usageAfter: [],
    localUsage: {
      inputTokens: total - 100,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: total,
    },
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
    policyAtFinish: {
      model: MODEL,
      reasoningEffort: 'medium',
      verbosity,
      verification: 'config-only',
    },
    ...patch,
  };
}

function pairs(count = 3): TaskBenchmarkReceipt[] {
  return Array.from({ length: count }, (_, index) => [
    receipt(index, 'baseline'),
    receipt(index, 'optimized'),
  ]).flat();
}

function input(receipts: TaskBenchmarkReceipt[] = pairs()): VerbosityLearningInput {
  return {
    harnessId: harnessId('codex'),
    model: MODEL,
    reasoningEffort: 'medium',
    taskClass: 'standard',
    supported: ['low', 'medium', 'high'],
    baseVerbosity: 'medium',
    budget: {
      state: 'balanced',
      allowEffortIncrease: false,
      pressuredScopes: [],
      missingScopes: [],
      recheckAt: null,
      reasons: [],
    },
    contextPressure: 'low',
    now: NOW,
    receipts,
  };
}

function withVerbosity(row: TaskBenchmarkReceipt, verbosity: string): TaskBenchmarkReceipt {
  return {
    ...row,
    verbosity,
    policyAtFinish: {
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      verbosity,
      verification: 'config-only',
    },
  };
}

describe('outcome-aware verbosity', () => {
  it('learns a lower verbosity only after three quality-passed comparisons', () => {
    const decision = refineVerbosityWithOutcomes(input());
    assert.equal(VERBOSITY_LEARNING_MIN_PAIRS, 3);
    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedVerbosity, 'low');
    assert.equal(decision.candidates[0]?.bases['local-tokens'], 3);
    assert.equal(decision.policy.reasoningEffort, 'medium');
  });

  it('needs three distinct paired experiments', () => {
    for (const count of [0, 1, 2]) {
      assert.equal(
        refineVerbosityWithOutcomes(input(pairs(count))).state,
        'insufficient-evidence',
      );
    }
  });

  it('allows higher verbosity only when repeated quality or retry recovery supports it', () => {
    const rows = pairs().map((row) => {
      if (row.variant === 'baseline') {
        return {
          ...withVerbosity(row, 'low'),
          outcome: { qualityGate: 'passed' as const, attempts: 3, failedAttempts: 2, errorCodes: [] },
        };
      }
      return {
        ...withVerbosity(row, 'medium'),
        outcome: { qualityGate: 'passed' as const, attempts: 1, failedAttempts: 0, errorCodes: [] },
      };
    });
    const decision = refineVerbosityWithOutcomes({ ...input(rows), baseVerbosity: 'low' });
    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedVerbosity, 'medium');
    assert.equal(decision.candidates.find((row) => row.verbosity === 'medium')?.bases.attempts, 3);
  });

  it('never raises verbosity merely because local token volume is lower', () => {
    const rows = pairs().map((row) =>
      withVerbosity(row, row.variant === 'baseline' ? 'low' : 'medium'),
    );
    assert.equal(
      refineVerbosityWithOutcomes({ ...input(rows), baseVerbosity: 'low' }).state,
      'insufficient-evidence',
    );
  });

  it('does not mix receipts from another reasoning effort into verbosity learning', () => {
    const rows = pairs().map((row) => ({
      ...row,
      reasoningEffort: 'high',
      policyAtFinish: { ...row.policyAtFinish!, reasoningEffort: 'high' },
    }));
    const decision = refineVerbosityWithOutcomes(input(rows));
    assert.equal(decision.state, 'insufficient-evidence');
    assert.equal(decision.matchedReceipts, 0);
  });

  it('defers a quality-recovery increase when the joint allowance policy says wait for reset', () => {
    const rows = pairs().map((row) => {
      if (row.variant === 'baseline') {
        return {
          ...withVerbosity(row, 'low'),
          outcome: { qualityGate: 'failed' as const, attempts: 1, failedAttempts: 1, errorCodes: [] },
        };
      }
      return withVerbosity(row, 'medium');
    });
    const data = { ...input(rows), baseVerbosity: 'low' };
    data.budget = { ...data.budget, state: 'wait-for-reset' };
    const decision = refineVerbosityWithOutcomes(data);
    assert.equal(decision.state, 'deferred');
    assert.equal(decision.candidateVerbosity, 'medium');
    assert.equal(decision.recommendedVerbosity, null);
  });

  it('lets an unpaired failed candidate veto otherwise attractive lower-verbosity wins', () => {
    const failure = receipt(3, 'optimized', {
      outcome: { qualityGate: 'failed', attempts: 1, failedAttempts: 1, errorCodes: [] },
    });
    assert.equal(
      refineVerbosityWithOutcomes(input([...pairs(), failure])).state,
      'insufficient-evidence',
    );
  });
});
