import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareTaskBenchmarkReceipts,
  comparableQuotaDeltas,
  completeTaskBenchmarkCapture,
  deriveTaskLocalUsage,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  harnessId,
  type TaskBenchmarkCapture,
  type TaskBenchmarkLocalSessionSnapshot,
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

describe('task benchmark capture contract', () => {
  function capture(): TaskBenchmarkCapture {
    return {
      schemaVersion: 1,
      benchmarkId: 'mechanical-fixture-1',
      variant: 'baseline',
      taskClass: 'mechanical',
      harnessId: CODEX,
      projectId: 'p_test',
      model: 'gpt-5',
      reasoningEffort: 'low',
      verbosity: 'low',
      startedAt: '2026-09-02T12:00:00.000Z',
      usageBefore: [window()],
      localSessionsBefore: null,
    };
  }

  it('restricts capture ids to one safe path segment', () => {
    assert.equal(isTaskBenchmarkId('mechanical-1'), true);
    assert.equal(isTaskBenchmarkId('a.b_c-1'), true);
    assert.equal(isTaskBenchmarkId('../escape'), false);
    assert.equal(isTaskBenchmarkId('two/segments'), false);
    assert.equal(isTaskBenchmarkId('Uppercase'), false);
  });

  it('round-trips a schema-1 capture without a raw project path', () => {
    const source = capture();
    const parsed = parseTaskBenchmarkCapture(JSON.parse(JSON.stringify(source)));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.capture, source);
    assert.equal('projectRoot' in parsed.capture, false);
  });

  it('completes a capture into a normal receipt and reuses the receipt validator', () => {
    const completed = completeTaskBenchmarkCapture(capture(), {
      completedAt: '2026-09-02T12:20:00.000Z',
      usageAfter: [
        window({
          usedPercent: 26,
          remainingPercent: 74,
          observedAt: '2026-09-02T12:20:00.000Z',
        }),
      ],
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
    });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;
    assert.equal(completed.receipt.outcome.qualityGate, 'passed');
    assert.equal(completed.receipt.usageBefore[0]?.usedPercent, 20);
    assert.equal(completed.receipt.usageAfter[0]?.usedPercent, 26);
    assert.equal(completed.receipt.localUsage, null);
  });

  it('rejects an invalid completion instead of persisting a malformed receipt', () => {
    const invalidAttempts = completeTaskBenchmarkCapture(capture(), {
      completedAt: '2026-09-02T12:20:00.000Z',
      usageAfter: [],
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 2,
    });
    assert.equal(invalidAttempts.ok, false);

    const backwardsTime = completeTaskBenchmarkCapture(capture(), {
      completedAt: '2026-09-02T11:59:00.000Z',
      usageAfter: [],
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
    });
    assert.equal(backwardsTime.ok, false);
  });
});

describe('local benchmark usage attribution', () => {
  function session(
    sessionId: string,
    totalTokens: number,
    lastActivity: string,
    inputTokens = totalTokens,
  ): TaskBenchmarkLocalSessionSnapshot {
    return {
      sessionId,
      firstActivity: '2026-09-02T11:50:00.000Z',
      lastActivity,
      inputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: totalTokens - inputTokens,
      totalTokens,
    };
  }

  it('subtracts one changed ccusage session across the task boundary', () => {
    const usage = deriveTaskLocalUsage(
      [session('s1', 1000, '2026-09-02T11:59:00.000Z', 800)],
      [session('s1', 1400, '2026-09-02T12:10:00.000Z', 1100)],
      '2026-09-02T12:00:00.000Z',
      '2026-09-02T12:20:00.000Z',
    );
    assert.deepEqual(usage, {
      inputTokens: 300,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 100,
      totalTokens: 400,
    });
  });

  it('refuses local attribution when two sessions changed during the benchmark', () => {
    const usage = deriveTaskLocalUsage(
      [],
      [
        session('s1', 400, '2026-09-02T12:10:00.000Z'),
        session('s2', 500, '2026-09-02T12:12:00.000Z'),
      ],
      '2026-09-02T12:00:00.000Z',
      '2026-09-02T12:20:00.000Z',
    );
    assert.equal(usage, null);
  });

  it('ignores sessions whose latest activity is outside the benchmark boundary', () => {
    const usage = deriveTaskLocalUsage(
      [],
      [session('s1', 400, '2026-09-02T11:59:59.000Z')],
      '2026-09-02T12:00:00.000Z',
      '2026-09-02T12:20:00.000Z',
    );
    assert.equal(usage, null);
  });
});

describe('task benchmark receipt parser', () => {
  it('round-trips a valid schema-1 receipt', () => {
    const source = receipt('baseline');
    const parsed = parseTaskBenchmarkReceipt(JSON.parse(JSON.stringify(source)));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.receipt, source);
  });

  it('rejects a future schema explicitly', () => {
    const source = { ...receipt('baseline'), schemaVersion: 2 };
    const parsed = parseTaskBenchmarkReceipt(source);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reason, 'unsupported-schema');
  });

  it('rejects malformed attempts and invalid window timestamps', () => {
    const badAttempts = receipt('baseline', {
      outcome: {
        qualityGate: 'passed',
        attempts: 1,
        failedAttempts: 2,
        errorCodes: [],
      },
    });
    const parsedAttempts = parseTaskBenchmarkReceipt(badAttempts);
    assert.equal(parsedAttempts.ok, false);

    const badWindow = receipt('baseline', {
      usageBefore: [window({ observedAt: 'not-a-date' })],
    });
    const parsedWindow = parseTaskBenchmarkReceipt(badWindow);
    assert.equal(parsedWindow.ok, false);
  });
});

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

  it('can make a token-saving optimized run lose when it needs more failed attempts', () => {
    const estimatedBefore = window({ confidence: 'estimated', source: 'local-history' });
    const estimatedAfter = window({
      confidence: 'estimated',
      source: 'local-history',
      usedPercent: 30,
      observedAt: '2026-09-02T12:20:00.000Z',
    });
    const baseline = receipt('baseline', {
      usageBefore: [estimatedBefore],
      usageAfter: [estimatedAfter],
      localUsage: {
        inputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 500,
        outputTokens: 500,
        totalTokens: 2000,
      },
      outcome: {
        qualityGate: 'passed',
        attempts: 1,
        failedAttempts: 0,
        errorCodes: [],
      },
    });
    const optimized = receipt('optimized', {
      usageBefore: [{ ...estimatedBefore }],
      usageAfter: [{ ...estimatedAfter }],
      localUsage: {
        inputTokens: 300,
        cacheCreationTokens: 0,
        cacheReadTokens: 100,
        outputTokens: 100,
        totalTokens: 500,
      },
      outcome: {
        qualityGate: 'passed',
        attempts: 3,
        failedAttempts: 2,
        errorCodes: [],
      },
    });

    const result = compareTaskBenchmarkReceipts(baseline, optimized);
    assert.equal(result.verdict, 'baseline-better');
    assert.equal(result.basis, 'failed-attempts');
    assert.equal(result.evidenceLevel, 'local-evidence');
    assert.equal(result.quota, null);
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
