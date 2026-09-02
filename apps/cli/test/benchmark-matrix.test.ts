import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import { runBenchmarkMatrix } from '../src/commands/benchmark-matrix.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};
const CODEX = harnessId('codex');
const ROOT = '/home/dev/.local/state/token-harness/benchmarks';

function receipt(
  benchmarkId: string,
  variant: 'baseline' | 'optimized',
  taskClass: 'mechanical' | 'standard' | 'hard' = 'mechanical',
): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    variant,
    taskClass,
    harnessId: CODEX,
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'low',
    startedAt: '2026-09-02T10:00:00.000Z',
    completedAt: '2026-09-02T10:20:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: {
      inputTokens: variant === 'baseline' ? 1000 : 700,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: variant === 'baseline' ? 500 : 300,
      totalTokens: variant === 'baseline' ? 1500 : 1000,
    },
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
  };
}

function capture(
  benchmarkId: string,
  variant: 'baseline' | 'optimized',
  projectId: string,
  taskClass: 'mechanical' | 'standard' | 'hard' = 'mechanical',
): TaskBenchmarkCapture {
  return {
    schemaVersion: 1,
    benchmarkId,
    variant,
    taskClass,
    harnessId: CODEX,
    projectId,
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'low',
    startedAt: '2026-09-02T10:00:00.000Z',
    usageBefore: [],
    localSessionsBefore: null,
  };
}

function fixture() {
  const files = new Map<string, string>();
  const directories = new Set<string>([ROOT]);
  const children = new Map<string, string[]>([[ROOT, []]]);

  function addPair(
    benchmarkId: string,
    projectId: string,
    taskClass: 'mechanical' | 'standard' | 'hard' = 'mechanical',
  ): void {
    const dir = `${ROOT}/${benchmarkId}`;
    directories.add(dir);
    children.set(ROOT, [...(children.get(ROOT) ?? []), benchmarkId]);
    files.set(`${dir}/baseline.json`, JSON.stringify(receipt(benchmarkId, 'baseline', taskClass)));
    files.set(
      `${dir}/optimized.json`,
      JSON.stringify(receipt(benchmarkId, 'optimized', taskClass)),
    );
    files.set(
      `${dir}/baseline.capture.json`,
      JSON.stringify(capture(benchmarkId, 'baseline', projectId, taskClass)),
    );
    files.set(
      `${dir}/optimized.capture.json`,
      JSON.stringify(capture(benchmarkId, 'optimized', projectId, taskClass)),
    );
  }

  function addIncomplete(benchmarkId: string): void {
    const dir = `${ROOT}/${benchmarkId}`;
    directories.add(dir);
    children.set(ROOT, [...(children.get(ROOT) ?? []), benchmarkId]);
    files.set(`${dir}/baseline.json`, JSON.stringify(receipt(benchmarkId, 'baseline')));
  }

  const encoded = new TextEncoder();
  const context = (): CommandContext => ({
    platform: PLATFORM,
    projectRoot: '/home/dev/project',
    home: '/home/dev',
    stateRoot: '/home/dev/.local/state/token-harness',
    harness: null,
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: null,
    benchmarkVariant: null,
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    nativePolicy: false,
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
        stat: async (path): Promise<FileStat | null> => {
          if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
          const text = files.get(path);
          return text === undefined
            ? null
            : { kind: 'file', byteLength: encoded.encode(text).byteLength, mode: null };
        },
        readFile: async (path) => {
          const text = files.get(path);
          if (text === undefined) throw new Error('missing');
          return encoded.encode(text);
        },
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
        readDirectory: async (path) => children.get(path) ?? [],
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
  });

  return { addPair, addIncomplete, context };
}

describe('benchmark-matrix command', () => {
  it('aggregates only complete pairs bound to the current project', async () => {
    const world = fixture();
    world.addPair('mechanical-real-1', 'p_test');
    world.addPair('hard-real-1', 'p_other', 'hard');
    world.addIncomplete('standard-incomplete-1');

    const result = await runBenchmarkMatrix(world.context());
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.entries.length, 1);
    assert.equal(result.data.entries[0]?.benchmarkId, 'mechanical-real-1');
    assert.equal(result.data.entries[0]?.verdict, 'optimized-better');
    assert.equal(result.data.entries[0]?.evidenceLevel, 'local-evidence');
    assert.deepEqual(result.data.selection, {
      scanned: 3,
      completePairs: 1,
      incomplete: 1,
      invalid: 0,
      otherProject: 1,
      filteredOut: 0,
    });
  });

  it('honours the existing --task filter without changing stored evidence', async () => {
    const world = fixture();
    world.addPair('mechanical-real-1', 'p_test');
    world.addPair('hard-real-1', 'p_test', 'hard');
    const context = world.context();
    context.taskClass = 'hard';

    const result = await runBenchmarkMatrix(context);
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.deepEqual(
      result.data.entries.map((entry) => entry.benchmarkId),
      ['hard-real-1'],
    );
    assert.equal(result.data.selection.filteredOut, 1);
  });

  it('returns an empty read-only report when no benchmark state exists', async () => {
    const world = fixture();
    const context = world.context();
    context.stateRoot = '/home/dev/.local/state/token-harness-empty';

    const result = await runBenchmarkMatrix(context);
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.entries.length, 0);
    assert.equal(result.diagnostics[0]?.code, 'benchmark-matrix-empty');
  });
});
