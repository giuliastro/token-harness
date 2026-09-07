import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  refineModelWithOutcomes,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
} from '../src/index.js';

const CODEX = harnessId('codex');
const NOW = '2026-09-07T12:00:00.000Z';

function receipt(
  index: number,
  variant: 'baseline' | 'optimized',
  model: string,
  totalTokens = 100,
  qualityGate: TaskQualityGate = 'passed',
  reasoningEffort = 'medium',
): TaskBenchmarkReceipt {
  const start =
    Date.parse('2026-09-07T08:00:00.000Z') +
    (index * 20 + (variant === 'optimized' ? 10 : 0)) * 60_000;
  return {
    schemaVersion: 1,
    benchmarkId: `case-${String(index)}`,
    variant,
    taskClass: 'standard',
    harnessId: CODEX,
    model,
    reasoningEffort,
    verbosity: 'medium',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + 5 * 60_000).toISOString(),
    usageBefore: [],
    usageAfter: [],
    localUsage: {
      inputTokens: totalTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens,
    },
    outcome: {
      qualityGate,
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
    policyAtFinish: {
      model,
      reasoningEffort,
      verbosity: 'medium',
      verification: 'config-only',
    },
  };
}

function pairs(
  input: {
    baseQuality?: TaskQualityGate;
    candidateQuality?: TaskQualityGate;
    baseTokens?: number;
    candidateTokens?: number;
    candidateModel?: string;
  } = {},
): TaskBenchmarkReceipt[] {
  const baseQuality = input.baseQuality ?? 'passed';
  const candidateQuality = input.candidateQuality ?? 'passed';
  const baseTokens = input.baseTokens ?? 100;
  const candidateTokens = input.candidateTokens ?? 80;
  const candidateModel = input.candidateModel ?? 'model-b';
  return Array.from({ length: 3 }, (_, index) => [
    receipt(index, 'baseline', 'model-a', baseTokens, baseQuality),
    receipt(index, 'optimized', candidateModel, candidateTokens, candidateQuality),
  ]).flat();
}

function decide(receipts: readonly TaskBenchmarkReceipt[], catalog = ['model-a', 'model-b']) {
  return refineModelWithOutcomes({
    harnessId: CODEX,
    baseModel: 'model-a',
    reasoningEffort: 'medium',
    verbosity: 'medium',
    taskClass: 'standard',
    availableModels: catalog,
    now: NOW,
    receipts,
  });
}

describe('model outcome learning', () => {
  it('learns an outcome-safe alternative without inferring a model tier from its name', () => {
    const decision = decide(pairs({ baseTokens: 100, candidateTokens: 80 }));

    assert.equal(decision.state, 'learned');
    assert.equal(decision.candidateModel, 'model-b');
    assert.equal(decision.intent, 'allowance-efficiency');
    assert.equal(decision.candidates[0]?.bases['local-tokens'], 3);
  });

  it('classifies a proven alternative as quality recovery when the current model repeatedly fails', () => {
    const decision = decide(
      pairs({ baseQuality: 'failed', candidateQuality: 'passed', candidateTokens: 120 }),
    );

    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedModel, 'model-b');
    assert.equal(decision.intent, 'quality-recovery');
    assert.equal(decision.candidates[0]?.bases.quality, 3);
  });

  it('ignores a candidate that is absent from the current native model catalog', () => {
    const decision = decide(pairs({ candidateModel: 'model-z' }), ['model-a', 'model-b']);

    assert.equal(decision.state, 'insufficient-evidence');
    assert.equal(decision.recommendedModel, 'model-a');
    assert.equal(decision.candidateModel, null);
  });

  it('does not mix reasoning-effort experiments into model learning', () => {
    const rows = pairs().map((row) =>
      row.model === 'model-b'
        ? {
            ...row,
            reasoningEffort: 'high',
            policyAtFinish: { ...row.policyAtFinish!, reasoningEffort: 'high' },
          }
        : row,
    );
    const decision = decide(rows);

    assert.equal(decision.state, 'insufficient-evidence');
    assert.equal(decision.candidateModel, null);
  });

  it('fails closed when project history is unavailable', () => {
    const decision = refineModelWithOutcomes({
      harnessId: CODEX,
      baseModel: 'model-a',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      taskClass: 'standard',
      availableModels: ['model-a', 'model-b'],
      now: NOW,
      receipts: null,
    });

    assert.equal(decision.state, 'unavailable');
    assert.equal(decision.recommendedModel, 'model-a');
  });
});
