import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateAcceptedTaskCapacity,
  harnessId,
  type BudgetReport,
  type TaskBenchmarkReceipt,
  type UsageWindowSnapshot,
} from '../src/index.js';

const CODEX = harnessId('codex');
const CLAUDE = harnessId('claude');
const NOW = '2026-09-07T08:00:00.000Z';

function window(
  harness: typeof CODEX | typeof CLAUDE,
  scope: 'five-hour' | 'weekly',
  usedPercent: number,
  observedAt: string,
): UsageWindowSnapshot {
  return {
    harnessId: harness,
    bucketId: `${harness}-${scope}`,
    bucketName: scope,
    window: 'primary',
    scope,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMinutes: scope === 'five-hour' ? 300 : 10_080,
    resetsAt: scope === 'five-hour' ? '2026-09-07T10:00:00.000Z' : '2026-09-11T10:00:00.000Z',
    observedAt,
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

function report(fiveHourUsed = 70, weeklyUsed = 50): BudgetReport {
  return {
    platform: {
      os: 'linux',
      osDisplayName: 'Linux',
      arch: 'x64',
      nodeVersion: '22.13.0',
      isWsl: false,
    },
    observedAt: NOW,
    harnesses: [
      {
        harnessId: CODEX,
        state: 'observed',
        windows: [
          window(CODEX, 'five-hour', fiveHourUsed, NOW),
          window(CODEX, 'weekly', weeklyUsed, NOW),
        ],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
    ],
  };
}

function receipt(id: string, fiveHourCost: number, weeklyCost: number): TaskBenchmarkReceipt {
  const startedAt = '2026-09-07T07:00:00.000Z';
  const completedAt = '2026-09-07T07:20:00.000Z';
  return {
    schemaVersion: 1,
    benchmarkId: id,
    variant: 'optimized',
    taskClass: 'hard',
    harnessId: CODEX,
    model: 'gpt-5.6',
    reasoningEffort: 'high',
    verbosity: 'low',
    startedAt,
    completedAt,
    usageBefore: [
      window(CODEX, 'five-hour', 20, startedAt),
      window(CODEX, 'weekly', 30, startedAt),
    ],
    usageAfter: [
      window(CODEX, 'five-hour', 20 + fiveHourCost, completedAt),
      window(CODEX, 'weekly', 30 + weeklyCost, completedAt),
    ],
    localUsage: null,
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
  };
}

describe('accepted-task capacity', () => {
  it('normalizes each allowance by conservative project-local accepted-task cost', () => {
    const estimate = estimateAcceptedTaskCapacity({
      report: report(),
      receipts: [receipt('hard-a', 2, 5), receipt('hard-b', 4, 6), receipt('hard-c', 3, 4)],
      harnessId: CODEX,
      taskClass: 'hard',
    });

    assert.equal(estimate.status, 'estimated');
    assert.equal(estimate.fiveHour.sampleCount, 3);
    assert.equal(estimate.fiveHour.p75UsedPercentPerAcceptedTask, 4);
    assert.equal(estimate.fiveHour.spendableRemainingPercent, 10);
    assert.equal(estimate.fiveHour.taskEquivalents, 2.5);
    assert.equal(estimate.weekly.p75UsedPercentPerAcceptedTask, 6);
    assert.equal(estimate.weekly.spendableRemainingPercent, 30);
    assert.equal(estimate.weekly.taskEquivalents, 5);
    assert.equal(estimate.acceptedTasksRemaining, 2);
  });

  it('reports zero whole-task capacity when the configured reserve consumes remaining allowance', () => {
    const estimate = estimateAcceptedTaskCapacity({
      report: report(85, 50),
      receipts: [receipt('hard-a', 2, 5), receipt('hard-b', 4, 6), receipt('hard-c', 3, 4)],
      harnessId: CODEX,
      taskClass: 'hard',
    });

    assert.equal(estimate.status, 'estimated');
    assert.equal(estimate.fiveHour.spendableRemainingPercent, 0);
    assert.equal(estimate.acceptedTasksRemaining, 0);
  });

  it('requires three positive comparable quota samples in both included windows', () => {
    const estimate = estimateAcceptedTaskCapacity({
      report: report(),
      receipts: [receipt('hard-a', 2, 5), receipt('hard-b', 4, 6)],
      harnessId: CODEX,
      taskClass: 'hard',
    });

    assert.equal(estimate.status, 'insufficient-evidence');
    assert.equal(estimate.acceptedTasksRemaining, null);
    assert.match(estimate.reasons.join('\n'), /3 required/);
  });

  it('does not turn zero backend movement or local token counts into free quota', () => {
    const zero = receipt('hard-zero', 0, 0);
    zero.localUsage = {
      inputTokens: 20_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 10_000,
      totalTokens: 30_000,
    };
    const estimate = estimateAcceptedTaskCapacity({
      report: report(),
      receipts: [zero, zero, zero],
      harnessId: CODEX,
      taskClass: 'hard',
    });

    assert.equal(estimate.status, 'insufficient-evidence');
    assert.equal(estimate.fiveHour.sampleCount, 0);
    assert.equal(estimate.weekly.sampleCount, 0);
  });

  it('ignores failed, stale and other-harness task receipts', () => {
    const failed = receipt('hard-failed', 10, 10);
    failed.outcome = { ...failed.outcome, qualityGate: 'failed' };
    const otherHarness = receipt('hard-claude', 10, 10);
    otherHarness.harnessId = CLAUDE;
    otherHarness.usageBefore = otherHarness.usageBefore.map((row) => ({ ...row, harnessId: CLAUDE }));
    otherHarness.usageAfter = otherHarness.usageAfter.map((row) => ({ ...row, harnessId: CLAUDE }));
    const stale = receipt('hard-stale', 10, 10);
    stale.startedAt = '2026-08-01T07:00:00.000Z';
    stale.completedAt = '2026-08-01T07:20:00.000Z';

    const estimate = estimateAcceptedTaskCapacity({
      report: report(),
      receipts: [
        receipt('hard-a', 2, 5),
        receipt('hard-b', 4, 6),
        receipt('hard-c', 3, 4),
        failed,
        otherHarness,
        stale,
      ],
      harnessId: CODEX,
      taskClass: 'hard',
    });

    assert.equal(estimate.status, 'estimated');
    assert.equal(estimate.eligibleReceipts, 3);
    assert.equal(estimate.acceptedTasksRemaining, 2);
  });
});
