import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addContextToTaskBenchmarkCompareReport,
  compareTaskBenchmarkReceipts,
  harnessId,
  type TaskBenchmarkContextSnapshot,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import { renderBenchmarkReport } from '../src/render/benchmark.js';

const CODEX = harnessId('codex');

function snapshot(tools: number): TaskBenchmarkContextSnapshot {
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

function receipt(variant: 'baseline' | 'optimized', tools: number): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: 'context-render-fixture',
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
    contextAtStart: snapshot(tools),
    contextAtFinish: snapshot(tools),
    localUsage: null,
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
  };
}

test('human benchmark report shows context reduction without calling it subscription quota', () => {
  const baseline = receipt('baseline', 62);
  const optimized = receipt('optimized', 5);
  const report = addContextToTaskBenchmarkCompareReport({
    baseline,
    optimized,
    comparison: compareTaskBenchmarkReceipts(baseline, optimized),
  });

  const rendered = renderBenchmarkReport(report, {
    toolVersion: 'test',
    home: null,
    decorate: false,
  });

  assert.match(rendered, /Context: reduced/);
  assert.match(rendered, /static MCP tools 62.*5/);
  assert.match(rendered, /not subscription quota/i);
});
