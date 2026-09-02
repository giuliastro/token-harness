import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareTaskBenchmarkReceipts,
  comparableQuotaDeltas,
  harnessId,
  type TaskBenchmarkReceipt,
  type UsageWindowSnapshot,
} from '../src/index.js';

const CODEX = harnessId('codex');

function window(overrides: Partial<UsageWindowSnapshot> = {}): UsageWindowSnapshot {
  return {
    harnessId: CODEX,
    bucketId: 'codex-main',
    bucketName: 'Codex',
    window: 'primary',
    scope: 'five-hour',
    usedPercent: 20,
    remainingPercent: 80,
    windowDurationMinutes: 300,
    resetsAt: '2026-09-02T14:00:00.000Z',
    observedAt: '2026-09-02T12:00:00.000Z',
    source: 'native-rpc',
    confidence: 'authoritative',
    ...overrides,
  };
}

function receipt(
  variant: 'baseline' | 'optimized',
  overrides: Partial<TaskBenchmarkReceipt> = {},
): TaskBenchmarkReceipt {
  const before = window();
  const after = window({
    usedPercent: variant === 'baseline' ? 30 : 26,
    remainingPercent: variant === 'baseline' ? 70 : 74,
    observedAt: '2026-09-02T12:20:00.000Z',
  });
  return {
    schemaVersion: 1,
    benchmarkId: 'mechanical-fixture-1',
    variant,
    taskClass: 'mechanical',
    harnessId: CODEX,
    model: 'gpt-5',
    reasoningEffort: 'low',
    verbosity: 'low',
    startedAt: '2026-09-02T12:00:00.000Z',
    completedAt: '2026-09-02T12:20:00.000Z',
    usageBefore: [before],
    usageAfter: [after],
    localUsage: {
      inputTokens: 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 500,
      outputTokens: variant === 'baseline' ? 400 : 250,
      totalTokens: variant === 'baseline' ? 1900 : 1750,
    },
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
    ...overrides,
  };
}

describe('comparable quota deltas', () => {
  it('uses one unchanged authoritative backend window', () => {
    const deltas = comparableQuotaDeltas(receipt('baseline'));
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.scope, 'five-hour');
    assert.equal(deltas[0]?.usedPercentDelta, 10);
    assert.equal(deltas[0]?.confidence, 'authoritative');
  });

  it('rejects cached or estimated quota observations', () => {
    const input = receipt('baseline', {
      usageBefore: [window({ confidence: 'cached', source: 'companion-cli' })],
      usageAfter: [
        window({
          confidence: 'cached',
          source: 'companion-cli',
          usedPercent: 30,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
    });
    assert.deepEqual(comparableQuotaDeltas(input), []);
  });

  it('rejects a reset boundary or backwards used percentage', () => {
    const resetChanged = receipt('baseline', {
      usageAfter: [
        window({
          usedPercent: 30,
          resetsAt: '2026-09-02T19:00:00.000Z',
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
    });
    assert.deepEqual(comparableQuotaDeltas(resetChanged), []);

    const backwards = receipt('baseline', {
      usageAfter: [
        window({
          usedPercent: 10,
          remainingPercent: 90,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
    });
    assert.deepEqual(comparableQuotaDeltas(backwards), []);
  });

  it('rejects an ambiguous backend identity instead of choosing one row', () => {
    const duplicate = window({
      usedPercent: 30,
      observedAt: '2026-09-02T12:20:00.000Z',
    });
    const input = receipt('baseline', { usageAfter: [duplicate, { ...duplicate }] });
    assert.deepEqual(comparableQuotaDeltas(input), []);
  });
});

describe('paired task benchmark comparison', () => {
  it('lets a quality regression lose even when the optimized run is locally smaller', () => {
    const baseline = receipt('baseline');
    const optimized = receipt('optimized', {
      localUsage: {
        inputTokens: 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 10,
        totalTokens: 20,
      },
      outcome: {
        qualityGate: 'failed',
        attempts: 1,
        failedAttempts: 1,
        errorCodes: [],
      },
    });

    const result = compareTaskBenchmarkReceipts(baseline, optimized);
    assert.equal(result.verdict, 'baseline-better');
    assert.equal(result.basis, 'quality');
    assert.equal(result.evidenceLevel, 'quality-only');
    assert.equal(result.quota, null);
  });

  it('uses comparable backend quota as the primary efficiency evidence', () => {
    const result = compareTaskBenchmarkReceipts(receipt('baseline'), receipt('optimized'));
    assert.equal(result.verdict, 'optimized-better');
    assert.equal(result.basis, 'backend-quota');
    assert.equal(result.evidenceLevel, 'quota-backed');
    assert.equal(result.quota?.baselineDeltaUsedPercent, 10);
    assert.equal(result.quota?.optimizedDeltaUsedPercent, 6);
  });

  it('falls back to failed attempts when backend quota is not trustworthy', () => {
    const baseline = receipt('baseline', {
      usageBefore: [window({ confidence: 'estimated', source: 'local-history' })],
      usageAfter: [
        window({
          confidence: 'estimated',
          source: 'local-history',
          usedPercent: 30,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
      outcome: {
        qualityGate: 'passed',
        attempts: 3,
        failedAttempts: 2,
        errorCodes: [],
      },
    });
    const optimized = receipt('optimized', {
      usageBefore: [window({ confidence: 'estimated', source: 'local-history' })],
      usageAfter: [
        window({
          confidence: 'estimated',
          source: 'local-history',
          usedPercent: 26,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
      outcome: {
        qualityGate: 'passed',
        attempts: 1,
        failedAttempts: 0,
        errorCodes: [],
      },
    });

    const result = compareTaskBenchmarkReceipts(baseline, optimized);
    assert.equal(result.verdict, 'optimized-better');
    assert.equal(result.basis, 'failed-attempts');
    assert.equal(result.evidenceLevel, 'local-evidence');
    assert.equal(result.quota, null);
    assert.match(result.reasons.join(' '), /no comparable/i);
  });

  it('uses runtime failures before local token volume when quota ties', () => {
    const baseline = receipt('baseline', {
      usageAfter: [
        window({
          usedPercent: 26,
          remainingPercent: 74,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
      localUsage: {
        inputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 100,
        totalTokens: 200,
      },
      outcome: {
        qualityGate: 'passed',
        attempts: 1,
        failedAttempts: 0,
        errorCodes: ['harnesstrim-reducer-failed:test-output-slim'],
      },
    });
    const optimized = receipt('optimized', {
      localUsage: {
        inputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 500,
        outputTokens: 500,
        totalTokens: 2000,
      },
    });

    const result = compareTaskBenchmarkReceipts(baseline, optimized);
    assert.equal(result.verdict, 'optimized-better');
    assert.equal(result.basis, 'runtime-errors');
    assert.equal(result.evidenceLevel, 'local-evidence');
    assert.equal(result.quota?.baselineDeltaUsedPercent, 6);
    assert.equal(result.quota?.optimizedDeltaUsedPercent, 6);
  });

  it('uses local token volume only as secondary local evidence', () => {
    const noQuotaBefore = window({ confidence: 'estimated', source: 'local-history' });
    const noQuotaAfter = window({
      confidence: 'estimated',
      source: 'local-history',
      usedPercent: 30,
      observedAt: '2026-09-02T12:20:00.000Z',
    });
    const baseline = receipt('baseline', {
      usageBefore: [noQuotaBefore],
      usageAfter: [noQuotaAfter],
    });
    const optimized = receipt('optimized', {
      usageBefore: [{ ...noQuotaBefore }],
      usageAfter: [{ ...noQuotaAfter }],
    });

    const result = compareTaskBenchmarkReceipts(baseline, optimized);
    assert.equal(result.verdict, 'optimized-better');
    assert.equal(result.basis, 'local-usage');
    assert.equal(result.evidenceLevel, 'local-evidence');
    assert.equal(result.quota, null);
    assert.match(result.reasons.join(' '), /not a backend quota claim/);
  });

  it('stays inconclusive when quality is unknown', () => {
    const optimized = receipt('optimized', {
      outcome: {
        qualityGate: 'unknown',
        attempts: 1,
        failedAttempts: 0,
        errorCodes: [],
      },
    });
    const result = compareTaskBenchmarkReceipts(receipt('baseline'), optimized);
    assert.equal(result.verdict, 'inconclusive');
    assert.equal(result.basis, 'quality');
  });

  it('refuses mismatched task identity, class, role or harness', () => {
    const optimized = receipt('optimized', {
      benchmarkId: 'other-task',
    });
    const result = compareTaskBenchmarkReceipts(receipt('baseline'), optimized);
    assert.equal(result.verdict, 'incomparable');
    assert.equal(result.basis, 'none');
  });
});
