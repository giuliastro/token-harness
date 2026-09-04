import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessCrossHarnessTransferBenefit,
  harnessId,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
  type UsageWindowSnapshot,
} from '@token-harness/core';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function window(
  harness: typeof CLAUDE | typeof CODEX,
  usedPercent: number,
  observedAt: string,
): UsageWindowSnapshot {
  return {
    harnessId: harness,
    bucketId: `${harness}-primary`,
    bucketName: 'primary',
    window: 'primary',
    scope: 'five-hour',
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes: 300,
    resetsAt: '2026-09-04T20:00:00.000Z',
    observedAt,
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

function receipt(input: {
  harness: typeof CLAUDE | typeof CODEX;
  variant: 'baseline' | 'optimized';
  quality?: TaskQualityGate;
  attempts?: number;
  failedAttempts?: number;
  errors?: string[];
  localTokens?: number;
  beforePercent?: number;
  afterPercent?: number;
  benchmarkId?: string;
  taskClass?: 'standard' | 'hard';
}): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId ?? 'transfer-hard-a',
    variant: input.variant,
    taskClass: input.taskClass ?? 'hard',
    harnessId: input.harness,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T18:00:00.000Z',
    completedAt: '2026-09-04T18:10:00.000Z',
    usageBefore: [window(input.harness, input.beforePercent ?? 10, '2026-09-04T18:00:00.000Z')],
    usageAfter: [window(input.harness, input.afterPercent ?? 20, '2026-09-04T18:10:00.000Z')],
    localUsage: {
      inputTokens: input.localTokens ?? 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: input.localTokens ?? 1000,
    },
    outcome: {
      qualityGate: input.quality ?? 'passed',
      attempts: input.attempts ?? 1,
      failedAttempts: input.failedAttempts ?? 0,
      errorCodes: input.errors ?? [],
    },
  };
}

function experiment(
  stay: TaskBenchmarkReceipt,
  switched: TaskBenchmarkReceipt,
  handoffBytes = 800,
  maxHandoffBytes = 2048,
) {
  return { stay, switched, handoffBytes, maxHandoffBytes };
}

test('quality improvement proves positive transfer benefit inside the handoff budget', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', quality: 'failed' }),
      receipt({ harness: CODEX, variant: 'optimized', quality: 'passed' }),
    ),
  );

  assert.equal(result.benefit, 'proven-positive');
  assert.equal(result.basis, 'quality');
});

test('quality regression makes transfer non-positive', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', quality: 'passed' }),
      receipt({ harness: CODEX, variant: 'optimized', quality: 'failed' }),
    ),
  );

  assert.equal(result.benefit, 'non-positive');
  assert.equal(result.basis, 'quality');
});

test('a failed switched run is non-positive even when the stay run also failed', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', quality: 'failed' }),
      receipt({ harness: CODEX, variant: 'optimized', quality: 'failed' }),
    ),
  );

  assert.equal(result.benefit, 'non-positive');
  assert.equal(result.basis, 'quality');
});

test('unknown quality keeps transfer benefit unknown', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', quality: 'unknown' }),
      receipt({ harness: CODEX, variant: 'optimized', quality: 'passed' }),
    ),
  );

  assert.equal(result.benefit, 'unknown');
  assert.equal(result.basis, 'quality');
});

test('fewer failed attempts proves positive transfer benefit after both quality gates pass', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', attempts: 3, failedAttempts: 2 }),
      receipt({ harness: CODEX, variant: 'optimized', attempts: 2, failedAttempts: 1 }),
    ),
  );

  assert.equal(result.benefit, 'proven-positive');
  assert.equal(result.basis, 'failed-attempts');
});

test('more failed attempts makes transfer non-positive', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', attempts: 1, failedAttempts: 0 }),
      receipt({ harness: CODEX, variant: 'optimized', attempts: 2, failedAttempts: 1 }),
    ),
  );

  assert.equal(result.benefit, 'non-positive');
  assert.equal(result.basis, 'failed-attempts');
});

test('runtime error count can prove transfer benefit in a common unit', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', errors: ['timeout'] }),
      receipt({ harness: CODEX, variant: 'optimized', errors: [] }),
    ),
  );

  assert.equal(result.benefit, 'proven-positive');
  assert.equal(result.basis, 'runtime-errors');
});

test('attempt count can prove transfer benefit when stronger evidence ties', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', attempts: 2 }),
      receipt({ harness: CODEX, variant: 'optimized', attempts: 1 }),
    ),
  );

  assert.equal(result.benefit, 'proven-positive');
  assert.equal(result.basis, 'attempts');
});

test('handoff above its configured budget is non-positive before outcome evidence', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', quality: 'failed' }),
      receipt({ harness: CODEX, variant: 'optimized', quality: 'passed' }),
      3000,
      2048,
    ),
  );

  assert.equal(result.benefit, 'non-positive');
  assert.equal(result.basis, 'handoff-budget');
});

test('mismatched task identity or same-harness runs remain unknown', () => {
  const mismatched = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline', benchmarkId: 'a' }),
      receipt({ harness: CODEX, variant: 'optimized', benchmarkId: 'b' }),
    ),
  );
  assert.equal(mismatched.benefit, 'unknown');
  assert.equal(mismatched.basis, 'identity');

  const sameHarness = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({ harness: CLAUDE, variant: 'baseline' }),
      receipt({ harness: CLAUDE, variant: 'optimized' }),
    ),
  );
  assert.equal(sameHarness.benefit, 'unknown');
  assert.equal(sameHarness.basis, 'identity');
});

test('equal common-unit outcomes stay unknown even when quota percentages and local tokens differ', () => {
  const result = assessCrossHarnessTransferBenefit(
    experiment(
      receipt({
        harness: CLAUDE,
        variant: 'baseline',
        localTokens: 9000,
        beforePercent: 10,
        afterPercent: 60,
      }),
      receipt({
        harness: CODEX,
        variant: 'optimized',
        localTokens: 100,
        beforePercent: 10,
        afterPercent: 11,
      }),
    ),
  );

  assert.equal(result.benefit, 'unknown');
  assert.equal(result.basis, 'none');
  assert.match(result.reasons.join(' '), /quota percentages and local token counts are intentionally not compared/);
});
