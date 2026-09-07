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

function usage(total: number) {
  return {
    inputTokens: total,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: total,
  };
}

function receipt(input: {
  id: string;
  variant: 'baseline' | 'optimized';
  model: string;
  quality?: TaskQualityGate;
  attempts?: number;
  failedAttempts?: number;
  tokens?: number;
  startMinute: number;
  effort?: string;
  verbosity?: string;
}): TaskBenchmarkReceipt {
  const effort = input.effort ?? 'medium';
  const verbosity = input.verbosity ?? 'medium';
  const start = new Date(Date.parse('2026-09-07T08:00:00.000Z') + input.startMinute * 60_000);
  const end = new Date(start.getTime() + 5 * 60_000);
  return {
    schemaVersion: 1,
    benchmarkId: input.id,
    variant: input.variant,
    taskClass: 'standard',
    harnessId: CODEX,
    model: input.model,
    reasoningEffort: effort,
    verbosity,
    startedAt: start.toISOString(),
    completedAt: end.toISOString(),
    usageBefore: [],
    usageAfter: [],
    localUsage: usage(input.tokens ?? 100),
    outcome: {
      qualityGate: input.quality ?? 'passed',
      attempts: input.attempts ?? 1,
      failedAttempts: input.failedAttempts ?? 0,
      errorCodes: [],
    },
    policyAtFinish: {
      model: input.model,
      reasoningEffort: effort,
      verbosity,
      verification: 'config-only',
    },
  };
}

function paired(input: {
  baseQuality?: TaskQualityGate;
  candidateQuality?: TaskQualityGate;
  baseTokens?: number;
  candidateTokens?: number;
  candidateModel?: string;
} = {}): TaskBenchmarkReceipt[] {
  const rows: TaskBenchmarkReceipt[] = [];
  for (let index = 0; index < 3; index += 1) {
    const minute = index * 20;
    rows.push(
      receipt({
        id: `case-${String(index)}`,
        variant: 'baseline',
        model: 'model-a',
        ...(input.baseQuality === undefined ? {} : { quality: input.baseQuality }),
        tokens: input.baseTokens ?? 100,
        startMinute: minute,
      }),
      receipt({
        id: `case-${String(index)}`,
        variant: 'optimized',
        model: input.candidateModel ?? 'model-b',
        ...(input.candidateQuality === undefined ? {} : { quality: input.candidateQuality }),
        tokens: input.candidateTokens ?? 80,
        startMinute: minute + 10,
      }),
    );
  }
  return rows;
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
    const decision = decide(paired({ baseTokens: 100, candidateTokens: 80 }));

    assert.equal(decision.state, 'learned');
    assert.equal(decision.candidateModel, 'model-b');
    assert.equal(decision.intent, 'allowance-efficiency');
    assert.equal(decision.candidates[0]?.bases['local-tokens'], 3);
  });

  it('classifies a proven alternative as quality recovery when the current model repeatedly fails', () => {
    const decision = decide(
      paired({ baseQuality: 'failed', candidateQuality: 'passed', candidateTokens: 120 }),
    );

    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedModel, 'model-b');
    assert.equal(decision.intent, 'quality-recovery');
    assert.equal(decision.candidates[0]?.bases.quality, 3);
  });

  it('ignores a candidate that is absent from the current native model catalog', () => {
    const decision = decide(paired({ candidateModel: 'model-z' }), ['model-a', 'model-b']);

    assert.equal(decision.state, 'insufficient-evidence');
    assert.equal(decision.recommendedModel, 'model-a');
    assert.equal(decision.candidateModel, null);
  });

  it('does not mix reasoning-effort experiments into model learning', () => {
    const rows = paired();
    const changed = rows.map((row) =>
      row.model === 'model-b'
        ? {
            ...row,
            reasoningEffort: 'high',
            policyAtFinish: { ...row.policyAtFinish!, reasoningEffort: 'high' },
          }
        : row,
    );
    const decision = decide(changed);

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
