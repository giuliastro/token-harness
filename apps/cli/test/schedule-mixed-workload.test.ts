import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type BudgetReport,
  type TaskBenchmarkReceipt,
  type TaskClass,
  type UsageWindowSnapshot,
} from '@token-harness/core';

import { scheduleDispatchMain } from '../src/schedule-dispatch-main.js';
import { parseMixedWorkloadSpec } from '../src/schedule-mixed-workload.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const NOW = '2026-09-08T10:00:00.000Z';
const FIVE_RESET = '2026-09-08T12:00:00.000Z';
const WEEKLY_RESET = '2026-09-12T10:00:00.000Z';

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
    resetsAt: scope === 'five-hour' ? FIVE_RESET : WEEKLY_RESET,
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
        windows: [window(CLAUDE, 'five-hour', 68), window(CLAUDE, 'weekly', 68)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
      {
        harnessId: CODEX,
        state: 'observed',
        windows: [window(CODEX, 'five-hour', 68), window(CODEX, 'weekly', 68)],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      },
    ],
  };
}

function receipt(input: {
  id: string;
  harness: typeof CLAUDE | typeof CODEX;
  taskClass: TaskClass;
  fiveHourCost: number;
  weeklyCost: number;
}): TaskBenchmarkReceipt {
  const startedAt = '2026-09-08T09:10:00.000Z';
  const completedAt = '2026-09-08T09:30:00.000Z';
  return {
    schemaVersion: 1,
    benchmarkId: input.id,
    variant: 'optimized',
    taskClass: input.taskClass,
    harnessId: input.harness,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt,
    completedAt,
    usageBefore: [
      window(input.harness, 'five-hour', 20, startedAt),
      window(input.harness, 'weekly', 30, startedAt),
    ],
    usageAfter: [
      window(input.harness, 'five-hour', 20 + input.fiveHourCost, completedAt),
      window(input.harness, 'weekly', 30 + input.weeklyCost, completedAt),
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
  const rows: TaskBenchmarkReceipt[] = [];
  for (const suffix of ['a', 'b', 'c']) {
    rows.push(
      receipt({
        id: `claude-mechanical-${suffix}`,
        harness: CLAUDE,
        taskClass: 'mechanical',
        fiveHourCost: 4,
        weeklyCost: 4,
      }),
      receipt({
        id: `claude-hard-${suffix}`,
        harness: CLAUDE,
        taskClass: 'hard',
        fiveHourCost: 8,
        weeklyCost: 8,
      }),
      receipt({
        id: `codex-mechanical-${suffix}`,
        harness: CODEX,
        taskClass: 'mechanical',
        fiveHourCost: 3,
        weeklyCost: 3,
      }),
      receipt({
        id: `codex-hard-${suffix}`,
        harness: CODEX,
        taskClass: 'hard',
        fiveHourCost: 7,
        weeklyCost: 7,
      }),
    );
  }
  return rows;
}

describe('mixed workload schedule mode', () => {
  it('parses a compact class=count workload', () => {
    assert.deepEqual(parseMixedWorkloadSpec('mechanical=2,standard=3,hard=1'), [
      { taskClass: 'mechanical', count: 2 },
      { taskClass: 'standard', count: 3 },
      { taskClass: 'hard', count: 1 },
    ]);
    assert.equal(parseMixedWorkloadSpec('standard=1,standard=2'), null);
    assert.equal(parseMixedWorkloadSpec('critical=0'), null);
  });

  it('allocates one shared five-hour/weekly backlog across Claude and Codex', async () => {
    const output = capture();
    const exitCode = await scheduleDispatchMain(
      [
        '--current',
        'claude',
        '--candidate',
        'codex',
        '--workload',
        'mechanical=2,hard=2',
        '--json',
      ],
      output.streams,
      {
        observeBudget: async () => budget(),
        observeQualityReceipts: async () => receipts(),
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      data: {
        mode: string;
        decision: string;
        requestedTasks: number;
        allocatedTasks: number;
        allocations: Array<{
          taskClass: string;
          current: number;
          candidate: number;
          unallocated: number;
        }>;
        evidence: {
          budget: string;
          receipts: string;
          candidateQuality: Record<string, { state: string; samples: number }>;
        };
      };
    };
    assert.equal(envelope.data.mode, 'mixed-workload');
    assert.equal(envelope.data.decision, 'split');
    assert.equal(envelope.data.requestedTasks, 4);
    assert.equal(envelope.data.allocatedTasks, 4);
    assert.equal(envelope.data.allocations.reduce((sum, row) => sum + row.unallocated, 0), 0);
    assert.equal(envelope.data.evidence.budget, 'observed');
    assert.equal(envelope.data.evidence.receipts, 'observed');
    assert.equal(envelope.data.evidence.candidateQuality['hard']?.state, 'passed');
    assert.equal(envelope.data.evidence.candidateQuality['hard']?.samples, 3);
  });

  it('rejects single-task and handoff evidence flags in mixed mode', async () => {
    const output = capture();
    const exitCode = await scheduleDispatchMain(
      [
        '--current',
        'claude',
        '--candidate',
        'codex',
        '--workload',
        'standard=2',
        '--task-class',
        'standard',
        '--tasks-left',
        '2',
      ],
      output.streams,
    );

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /mixed-workload-conflicting-flag/);
  });

  it('leaves work unallocated when live budget or benchmark evidence is unavailable', async () => {
    const output = capture();
    const exitCode = await scheduleDispatchMain(
      ['--current', 'claude', '--candidate', 'codex', '--workload', 'hard=2', '--json'],
      output.streams,
      {
        observeBudget: async () => null,
        observeQualityReceipts: async () => null,
      },
    );

    assert.equal(exitCode, 0);
    const envelope = JSON.parse(output.stdout()) as {
      data: {
        decision: string;
        allocatedTasks: number;
        allocations: Array<{ unallocated: number }>;
      };
    };
    assert.equal(envelope.data.decision, 'insufficient-evidence');
    assert.equal(envelope.data.allocatedTasks, 0);
    assert.equal(envelope.data.allocations[0]?.unallocated, 2);
  });
});
