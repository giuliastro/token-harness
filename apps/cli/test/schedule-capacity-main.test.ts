import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type BudgetReport,
  type TaskBenchmarkReceipt,
  type UsageWindowSnapshot,
} from '@token-harness/core';

import { scheduleCapacityMain } from '../src/schedule-capacity-main.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const NOW = '2026-09-07T09:30:00.000Z';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function window(
  id: typeof CLAUDE | typeof CODEX,
  scope: 'five-hour' | 'weekly',
  usedPercent: number,
  observedAt = NOW,
): UsageWindowSnapshot {
  return {
    harnessId: id,
    bucketId: `${id}-${scope}`,
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

function budget(): BudgetReport {
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
        harnessId: CLAUDE,
        state: 'observed',
        windows: [window(CLAUDE, 'five-hour', 75), window(CLAUDE, 'weekly', 30)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
      {
        harnessId: CODEX,
        state: 'observed',
        windows: [window(CODEX, 'five-hour', 20), window(CODEX, 'weekly', 20)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
    ],
  };
}

function receipt(
  id: string,
  harness: typeof CLAUDE | typeof CODEX,
  fiveHourCost: number,
  weeklyCost: number,
): TaskBenchmarkReceipt {
  const startedAt = '2026-09-07T08:40:00.000Z';
  const completedAt = '2026-09-07T09:00:00.000Z';
  return {
    schemaVersion: 1,
    benchmarkId: id,
    variant: 'optimized',
    taskClass: 'hard',
    harnessId: harness,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt,
    completedAt,
    usageBefore: [
      window(harness, 'five-hour', 20, startedAt),
      window(harness, 'weekly', 30, startedAt),
    ],
    usageAfter: [
      window(harness, 'five-hour', 20 + fiveHourCost, completedAt),
      window(harness, 'weekly', 30 + weeklyCost, completedAt),
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

function receipts(): TaskBenchmarkReceipt[] {
  return [
    receipt('claude-a', CLAUDE, 6, 5),
    receipt('claude-b', CLAUDE, 6, 6),
    receipt('claude-c', CLAUDE, 5, 4),
    receipt('codex-a', CODEX, 4, 5),
    receipt('codex-b', CODEX, 4, 6),
    receipt('codex-c', CODEX, 3, 4),
  ];
}

const args = [
  '--current',
  'claude',
  '--candidate',
  'codex',
  '--task-class',
  'hard',
  '--handoff-bytes',
  '500',
  '--transfer-benefit',
  'proven-positive',
] as const;

describe('capacity-aware installed schedule flow', () => {
  it('switches when safe remaining Claude allowance is below one accepted hard-task equivalent', async () => {
    const output = capture();
    const exitCode = await scheduleCapacityMain(args, output.streams, {
      observeBudget: async () => budget(),
      observeQualityReceipts: async () => receipts(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /recommendation: switch/);
    assert.match(output.stdout(), /Accepted-task capacity:/);
    assert.match(output.stdout(), /current: 0 accepted task\(s\)/);
    assert.match(output.stdout(), /candidate: 10 accepted task\(s\)/);
    assert.match(output.stdout(), /current-capacity-below-one/);
    assert.match(output.stdout(), /candidate-capacity-sufficient/);
  });

  it('keeps the estimator and decision evidence machine-readable', async () => {
    const output = capture();
    const exitCode = await scheduleCapacityMain([...args, '--json'], output.streams, {
      observeBudget: async () => budget(),
      observeQualityReceipts: async () => receipts(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      data: {
        decision: string;
        evidence: {
          current: { acceptedTasksRemaining: number | null };
          candidate: { acceptedTasksRemaining: number | null };
        };
        capacityEvidence: {
          current: { status: string; fiveHour: { p75UsedPercentPerAcceptedTask: number } };
          candidate: { status: string; acceptedTasksRemaining: number };
        };
      };
    };
    assert.equal(envelope.data.decision, 'switch');
    assert.equal(envelope.data.evidence.current.acceptedTasksRemaining, 0);
    assert.equal(envelope.data.capacityEvidence.current.status, 'estimated');
    assert.equal(envelope.data.capacityEvidence.current.fiveHour.p75UsedPercentPerAcceptedTask, 6);
    assert.equal(envelope.data.capacityEvidence.candidate.acceptedTasksRemaining, 10);
  });

  it('does not perform hidden capacity observations when explicit evidence skipped them', async () => {
    const output = capture();
    let budgetReads = 0;
    let qualityReads = 0;
    const exitCode = await scheduleCapacityMain(
      [
        ...args,
        '--current-five-hour',
        'over-pace',
        '--current-weekly',
        'on-pace',
        '--candidate-five-hour',
        'under-pace',
        '--candidate-weekly',
        'on-pace',
        '--candidate-quality',
        'passed',
        '--candidate-quality-task',
        'hard',
        '--candidate-quality-samples',
        '3',
      ],
      output.streams,
      {
        observeBudget: async () => {
          budgetReads += 1;
          return budget();
        },
        observeQualityReceipts: async () => {
          qualityReads += 1;
          return receipts();
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(budgetReads, 0);
    assert.equal(qualityReads, 0);
    assert.match(output.stdout(), /current: unknown/);
    assert.match(output.stdout(), /candidate: unknown/);
  });
});
