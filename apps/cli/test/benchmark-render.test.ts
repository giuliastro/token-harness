import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareTaskBenchmarkReceipts,
  harnessId,
  type TaskBenchmarkCompareReport,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import { renderBenchmarkReport } from '../src/render/benchmark.js';

function receipt(variant: 'baseline' | 'optimized'): TaskBenchmarkReceipt {
  const usedAfter = variant === 'baseline' ? 30 : 26;
  return {
    schemaVersion: 1,
    benchmarkId: 'mechanical-fixture-1',
    variant,
    taskClass: 'mechanical',
    harnessId: harnessId('codex'),
    model: 'gpt-test',
    reasoningEffort: 'low',
    verbosity: 'low',
    startedAt: '2026-09-02T10:00:00.000Z',
    completedAt: '2026-09-02T10:20:00.000Z',
    usageBefore: [
      {
        harnessId: harnessId('codex'),
        bucketId: 'codex-main',
        bucketName: 'Codex',
        window: 'primary',
        scope: 'five-hour',
        usedPercent: 20,
        remainingPercent: 80,
        windowDurationMinutes: 300,
        resetsAt: '2026-09-02T14:00:00.000Z',
        observedAt: '2026-09-02T10:00:00.000Z',
        source: 'native-rpc',
        confidence: 'authoritative',
      },
    ],
    usageAfter: [
      {
        harnessId: harnessId('codex'),
        bucketId: 'codex-main',
        bucketName: 'Codex',
        window: 'primary',
        scope: 'five-hour',
        usedPercent: usedAfter,
        remainingPercent: 100 - usedAfter,
        windowDurationMinutes: 300,
        resetsAt: '2026-09-02T14:00:00.000Z',
        observedAt: '2026-09-02T10:20:00.000Z',
        source: 'native-rpc',
        confidence: 'authoritative',
      },
    ],
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
  };
}

describe('benchmark rendering', () => {
  it('shows quality, local evidence, backend quota and verdict', () => {
    const baseline = receipt('baseline');
    const optimized = receipt('optimized');
    const report: TaskBenchmarkCompareReport = {
      baseline,
      optimized,
      comparison: compareTaskBenchmarkReceipts(baseline, optimized),
    };

    const rendered = renderBenchmarkReport(report, {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    assert.match(rendered, /^Benchmark — mechanical-fixture-1$/m);
    assert.match(rendered, /^mechanical on codex$/m);
    assert.match(rendered, /Baseline: quality passed/);
    assert.match(rendered, /Optimized: quality passed/);
    assert.match(rendered, /Backend quota (five-hour, authoritative)/);
    assert.match(rendered, /baseline +10% vs optimized +6%/);
    assert.match(rendered, /Verdict: optimized-better/);
    assert.match(rendered, /evidence quota-backed/);
  });

  it('keeps every human-output line within the terminal width contract', () => {
    const baseline = receipt('baseline');
    const optimized = receipt('optimized');
    const report: TaskBenchmarkCompareReport = {
      baseline,
      optimized,
      comparison: compareTaskBenchmarkReceipts(baseline, optimized),
    };

    const rendered = renderBenchmarkReport(report, {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    for (const line of rendered.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `line is ${String(line.length)} chars: ${line}`);
    }
  });
});
