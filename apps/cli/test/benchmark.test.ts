import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import { runBenchmark } from '../src/commands/benchmark.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

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

function context(
  files: Record<string, string>,
  overrides: Partial<CommandContext> = {},
): CommandContext {
  const encoded = new TextEncoder();
  return {
    platform: PLATFORM,
    projectRoot: '/home/dev/project',
    home: '/home/dev',
    stateRoot: '/home/dev/.local/state/token-harness',
    harness: null,
    provider: null,
    baselineReceipt: 'receipts/baseline.json',
    optimizedReceipt: 'receipts/optimized.json',
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-02T10:30:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (path): Promise<FileStat | null> =>
          Object.hasOwn(files, path)
            ? { kind: 'file', byteLength: files[path]?.length ?? 0, mode: null }
            : null,
        readFile: async (path) => encoded.encode(files[path] ?? ''),
        writeFile: async () => {
          throw new Error('read-only');
        },
        appendFile: async () => {
          throw new Error('read-only');
        },
        createDirectory: async () => {
          throw new Error('read-only');
        },
        remove: async () => {
          throw new Error('read-only');
        },
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => ({
          displayCommand: request.executable,
          interpreter: 'direct',
          executablePath: null,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 0,
          timedOut: false,
          failure: { reason: 'executable-not-found', message: 'not used' },
        }),
      },
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/home/dev/.local/state/token-harness',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
    ...overrides,
  };
}

describe('benchmark command', () => {
  it('compares relative receipt paths against the project root', async () => {
    const result = await runBenchmark(
      context({
        '/home/dev/project/receipts/baseline.json': JSON.stringify(receipt('baseline')),
        '/home/dev/project/receipts/optimized.json': JSON.stringify(receipt('optimized')),
      }),
    );

    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.comparison.verdict, 'optimized-better');
    assert.equal(result.data.comparison.basis, 'backend-quota');
    assert.equal(result.data.comparison.evidenceLevel, 'quota-backed');
    assert.equal(result.data.comparison.quota?.baselineDeltaUsedPercent, 10);
    assert.equal(result.data.comparison.quota?.optimizedDeltaUsedPercent, 6);
  });

  it('requires both receipt flags', async () => {
    const result = await runBenchmark(
      context({}, { baselineReceipt: null, optimizedReceipt: null }),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'benchmark-receipts-required');
  });

  it('rejects invalid JSON instead of guessing a receipt', async () => {
    const result = await runBenchmark(
      context({
        '/home/dev/project/receipts/baseline.json': '{not json',
        '/home/dev/project/receipts/optimized.json': JSON.stringify(receipt('optimized')),
      }),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'benchmark-receipt-invalid-json');
  });

  it('rejects a receipt passed under the wrong role', async () => {
    const result = await runBenchmark(
      context({
        '/home/dev/project/receipts/baseline.json': JSON.stringify(receipt('optimized')),
        '/home/dev/project/receipts/optimized.json': JSON.stringify(receipt('optimized')),
      }),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'benchmark-receipt-role-mismatch');
  });

  it('reports a missing receipt as a usage error', async () => {
    const result = await runBenchmark(
      context({
        '/home/dev/project/receipts/optimized.json': JSON.stringify(receipt('optimized')),
      }),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'benchmark-receipt-not-found');
  });
});
