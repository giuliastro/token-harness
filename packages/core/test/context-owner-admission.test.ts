import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessContextOwnerAdmission,
  harnessId,
  type TaskBenchmarkContextSnapshot,
  type TaskBenchmarkMatrixPair,
  type TaskBenchmarkReceipt,
} from '../src/index.js';

const CODEX = harnessId('codex');
const NOW = '2026-09-09T08:00:00.000Z';

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
  id: string,
  variant: 'baseline' | 'optimized',
  tools: number,
  overrides: Partial<TaskBenchmarkReceipt['outcome']> = {},
): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: id,
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
    contextAtStart: context(tools),
    contextAtFinish: context(tools),
    localUsage: null,
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
      ...overrides,
    },
  };
}

function pair(id: string, optimizedTools = 5): TaskBenchmarkMatrixPair {
  return {
    baseline: receipt(id, 'baseline', 62),
    optimized: receipt(id, 'optimized', optimizedTools),
  };
}

test('admits a context owner after three repeated quality-safe context reductions', () => {
  const decision = assessContextOwnerAdmission([pair('a'), pair('b'), pair('c')], { now: NOW });
  assert.equal(decision.state, 'admitted');
  assert.equal(decision.qualifyingPairs, 3);
  assert.equal(decision.harnessId, CODEX);
  assert.equal(decision.taskClass, 'standard');
});

test('two successful pairs remain insufficient evidence', () => {
  const decision = assessContextOwnerAdmission([pair('a'), pair('b')], { now: NOW });
  assert.equal(decision.state, 'insufficient-evidence');
  assert.equal(decision.qualifyingPairs, 2);
});

test('known retry regression rejects the candidate despite context reduction', () => {
  const bad: TaskBenchmarkMatrixPair = {
    baseline: receipt('bad', 'baseline', 62),
    optimized: receipt('bad', 'optimized', 5, { attempts: 2, failedAttempts: 1 }),
  };
  const decision = assessContextOwnerAdmission([pair('a'), pair('b'), bad], { now: NOW });
  assert.equal(decision.state, 'rejected');
  assert.match(decision.reasons.join(' '), /retries|attempts/);
});

test('same context does not count toward admission', () => {
  const decision = assessContextOwnerAdmission([pair('a'), pair('b'), pair('c', 62)], {
    now: NOW,
  });
  assert.equal(decision.state, 'insufficient-evidence');
  assert.equal(decision.qualifyingPairs, 2);
});

test('stale pairs do not count toward admission', () => {
  const stale = pair('old');
  stale.baseline.completedAt = '2026-08-01T07:05:00.000Z';
  stale.optimized.completedAt = '2026-08-01T07:05:00.000Z';
  const decision = assessContextOwnerAdmission([pair('a'), pair('b'), stale], { now: NOW });
  assert.equal(decision.state, 'insufficient-evidence');
  assert.equal(decision.consideredPairs, 2);
});
