import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
  compareTaskBenchmarkContextSnapshots,
  completeTaskBenchmarkCapture,
  harnessId,
  parseTaskBenchmarkContextSnapshot,
  parseTaskBenchmarkReceipt,
  taskBenchmarkContextSnapshot,
  type HarnessContextObservation,
  type McpServerObservation,
  type TaskBenchmarkCapture,
} from '../src/index.js';

const CODEX = harnessId('codex');

function mcp(name: string, toolCount: number | null): McpServerObservation {
  return {
    harnessId: CODEX,
    name,
    toolCount,
    runtimeStatus: 'ready',
    authStatus: null,
    pluginId: null,
    source: 'native-rpc',
  };
}

function observation(
  servers: McpServerObservation[],
  deferral: HarnessContextObservation['toolDeferral'] = null,
): HarnessContextObservation {
  return {
    harnessId: CODEX,
    state: 'observed',
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'medium',
    projectDocMaxBytes: null,
    toolOutputTokenLimit: null,
    toolSearchEnabled: null,
    toolDeferral: deferral,
    projectRootMarkers: null,
    projectDocFallbackFilenames: [],
    configInstructionBytes: null,
    managedConfigTarget: null,
    managedConfigOriginsObserved: false,
    managedConfigFieldOrigins: [],
    availableModels: [],
    modelCatalogTruncated: false,
    mcpServers: servers,
    mcpInventoryTruncated: false,
    diagnostics: [],
  };
}

test('runtime-proven deferral reduces effective static exposure without erasing raw inventory', () => {
  const servers = [mcp('large', 40), mcp('medium', 22)];
  const baseline = taskBenchmarkContextSnapshot(observation(servers));
  const optimized = taskBenchmarkContextSnapshot(
    observation(servers, {
      harnessId: CODEX,
      mechanism: 'native-tool-search',
      state: 'active',
      scope: 'mcp-tools',
      evidenceSource: 'native-rpc',
      reason: 'fixture proves the live gate',
    }),
  );

  assert.equal(baseline?.rawKnownMcpToolCount, 62);
  assert.equal(baseline?.effectiveStaticMcpToolCount, 62);
  assert.equal(optimized?.rawKnownMcpToolCount, 62);
  assert.equal(optimized?.effectiveStaticMcpToolCount, 0);
  const comparison = compareTaskBenchmarkContextSnapshots(baseline, optimized);
  assert.equal(comparison.verdict, 'reduced');
  assert.match(comparison.reason, /not subscription quota/);
});

test('a smaller external meta-tool surface is recorded as context reduction, not quota evidence', () => {
  const baseline = taskBenchmarkContextSnapshot(observation([mcp('inventory', 62)]));
  const optimized = taskBenchmarkContextSnapshot(
    observation(
      [mcp('context-owner', 5)],
      {
        harnessId: CODEX,
        mechanism: 'external',
        state: 'inactive',
        scope: 'tool-catalog',
        evidenceSource: 'native-rpc',
        reason: 'fixture exposes five meta-tools eagerly',
      },
    ),
  );

  const comparison = compareTaskBenchmarkContextSnapshots(baseline, optimized);
  assert.equal(comparison.verdict, 'reduced');
  assert.equal(comparison.baseline?.effectiveStaticMcpToolCount, 62);
  assert.equal(comparison.optimized?.effectiveStaticMcpToolCount, 5);
});

test('context snapshot parser rejects impossible effective exposure', () => {
  assert.equal(
    parseTaskBenchmarkContextSnapshot({
      observationState: 'observed',
      rawMcpServerCount: 1,
      rawKnownMcpToolCount: 2,
      unknownMcpToolServerCount: 0,
      effectiveStaticMcpServerCount: 1,
      effectiveStaticMcpToolCount: 3,
      toolDeferralState: null,
      toolDeferralMechanism: null,
    }),
    undefined,
  );
});

test('legacy schema-1 receipts without context witnesses remain readable', () => {
  const parsed = parseTaskBenchmarkReceipt({
    schemaVersion: 1,
    benchmarkId: 'legacy-context',
    variant: 'baseline',
    taskClass: 'standard',
    harnessId: 'codex',
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-09T06:00:00.000Z',
    completedAt: '2026-09-09T06:01:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.contextAtStart, undefined);
  assert.equal(parsed.receipt.contextAtFinish, undefined);
});

test('completed receipts preserve start and finish context witnesses additively', () => {
  const start = taskBenchmarkContextSnapshot(observation([mcp('inventory', 62)]));
  const finish = taskBenchmarkContextSnapshot(observation([mcp('context-owner', 5)]));
  const capture: TaskBenchmarkCapture = {
    schemaVersion: TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
    benchmarkId: 'context-evidence',
    variant: 'optimized',
    taskClass: 'standard',
    harnessId: CODEX,
    projectId: 'p_fixture',
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'medium',
    startedAt: '2026-09-09T06:00:00.000Z',
    usageBefore: [],
    contextAtStart: start,
    localSessionsBefore: null,
  };

  const completed = completeTaskBenchmarkCapture(capture, {
    completedAt: '2026-09-09T06:01:00.000Z',
    usageAfter: [],
    qualityGate: 'passed',
    attempts: 1,
    failedAttempts: 0,
    contextAtFinish: finish,
  });

  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  assert.equal(completed.receipt.contextAtStart?.rawKnownMcpToolCount, 62);
  assert.equal(completed.receipt.contextAtFinish?.rawKnownMcpToolCount, 5);
});
