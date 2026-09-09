import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addContextToTaskBenchmarkCompareReport,
  compareTaskBenchmarkReceiptContexts,
  compareTaskBenchmarkReceipts,
  harnessId,
  type TaskBenchmarkContextSnapshot,
  type TaskBenchmarkReceipt,
} from '../src/index.js';

const CODEX = harnessId('codex');

function context(tools: number): TaskBenchmarkContextSnapshot {
  return {
    observationState: 'observed',
    rawMcpServerCount: 1,
    rawKnownMcpToolCount: tools,
    unknownMcpToolServerCount: 0,
    mcpInventoryTruncated: false,
    effectiveStaticMcpServerCount: tools === 0 ? 0 : 1,
    effectiveStaticMcpToolCount: tools,
    toolDeferralState: null,
    toolDeferralMechanism: null,
  };
}

function receipt(
  variant: 'baseline' | 'optimized',
  start: TaskBenchmarkContextSnapshot | null,
  finish: TaskBenchmarkContextSnapshot | null,
  qualityGate: 'passed' | 'failed' = 'passed',
): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: 'context-report-fixture',
    variant,
    taskClass: 'standard',
    harnessId: CODEX,
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'medium',
    startedAt: '2026-09-09T07:00:00.000Z',
    completedAt: '2026-09-09T07:05:00.000Z',
    usageBefore: [],
    usageAfter: [],
    contextAtStart: start,
    contextAtFinish: finish,
    localUsage: null,
    outcome: { qualityGate, attempts: 1, failedAttempts: 0, errorCodes: [] },
  };
}

test('credits context reduction only when both quality-passed variants stay stable', () => {
  const baseline = receipt('baseline', context(62), context(62));
  const optimized = receipt('optimized', context(5), context(5));

  const comparison = compareTaskBenchmarkReceiptContexts(baseline, optimized);
  assert.equal(comparison.verdict, 'reduced');
  assert.equal(comparison.baseline?.effectiveStaticMcpToolCount, 62);
  assert.equal(comparison.optimized?.effectiveStaticMcpToolCount, 5);
});

test('mid-task context drift fails closed instead of attributing a saving', () => {
  const baseline = receipt('baseline', context(62), context(62));
  const optimized = receipt('optimized', context(5), context(4));

  const comparison = compareTaskBenchmarkReceiptContexts(baseline, optimized);
  assert.equal(comparison.verdict, 'unknown');
  assert.match(comparison.reason, /changed during the task/);
});

test('quality failure blocks context-saving credit', () => {
  const baseline = receipt('baseline', context(62), context(62));
  const optimized = receipt('optimized', context(5), context(5), 'failed');

  const comparison = compareTaskBenchmarkReceiptContexts(baseline, optimized);
  assert.equal(comparison.verdict, 'unknown');
  assert.match(comparison.reason, /pass quality/);
});

test('decorating a benchmark report leaves the historical verdict unchanged', () => {
  const baseline = receipt('baseline', context(62), context(62));
  const optimized = receipt('optimized', context(5), context(5));
  const historical = compareTaskBenchmarkReceipts(baseline, optimized);
  const decorated = addContextToTaskBenchmarkCompareReport({ baseline, optimized, comparison: historical });

  assert.deepEqual(decorated.comparison, historical);
  assert.equal(decorated.context.verdict, 'reduced');
});
