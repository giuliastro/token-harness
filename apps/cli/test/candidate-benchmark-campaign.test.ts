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
  type TaskClass,
} from '@token-harness/core';

import {
  candidateBenchmarkCampaignBenchmarkId,
  planCandidateBenchmarkCampaign,
  runCandidateBenchmarkMatrix,
} from '../src/commands/candidate-benchmark.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};
const CODEX = harnessId('codex');
const STATE = '/state';
const ROOT = `${STATE}/benchmarks`;

function capture(
  benchmarkId: string,
  variant: 'baseline' | 'optimized',
  taskClass: TaskClass,
): TaskBenchmarkCapture {
  return {
    schemaVersion: 1,
    benchmarkId,
    variant,
    taskClass,
    harnessId: CODEX,
    projectId: 'p_test',
    model: 'gpt-test',
    reasoningEffort: 'medium',
    verbosity: 'low',
    startedAt: variant === 'baseline' ? '2026-09-11T10:00:00.000Z' : '2026-09-11T11:00:00.000Z',
    usageBefore: [],
    localSessionsBefore: null,
  };
}

function receipt(
  benchmarkId: string,
  variant: 'baseline' | 'optimized',
  taskClass: TaskClass,
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
    startedAt: variant === 'baseline' ? '2026-09-11T10:00:00.000Z' : '2026-09-11T11:00:00.000Z',
    completedAt:
      variant === 'baseline' ? '2026-09-11T10:20:00.000Z' : '2026-09-11T11:15:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: {
      inputTokens: variant === 'baseline' ? 1000 : 650,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: variant === 'baseline' ? 500 : 350,
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

function fixture() {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const children = new Map<string, string[]>();
  const encoded = new TextEncoder();

  function ensureBenchmark(benchmarkId: string): string {
    directories.add(ROOT);
    const dir = `${ROOT}/${benchmarkId}`;
    directories.add(dir);
    const rootChildren = children.get(ROOT) ?? [];
    if (!rootChildren.includes(benchmarkId)) children.set(ROOT, [...rootChildren, benchmarkId]);
    return dir;
  }

  function attribute(benchmarkId: string, candidateId = 'gitnexus'): void {
    const dir = ensureBenchmark(benchmarkId);
    files.set(
      `${dir}/candidate.json`,
      JSON.stringify({ schemaVersion: 1, benchmarkId, candidateId, projectId: 'p_test' }),
    );
  }

  function addBaseline(benchmarkId: string, taskClass: TaskClass, candidateId = 'gitnexus'): void {
    const dir = ensureBenchmark(benchmarkId);
    files.set(`${dir}/baseline.capture.json`, JSON.stringify(capture(benchmarkId, 'baseline', taskClass)));
    files.set(`${dir}/baseline.json`, JSON.stringify(receipt(benchmarkId, 'baseline', taskClass)));
    attribute(benchmarkId, candidateId);
  }

  function addOptimized(benchmarkId: string, taskClass: TaskClass): void {
    const dir = ensureBenchmark(benchmarkId);
    files.set(
      `${dir}/optimized.capture.json`,
      JSON.stringify(capture(benchmarkId, 'optimized', taskClass)),
    );
    files.set(`${dir}/optimized.json`, JSON.stringify(receipt(benchmarkId, 'optimized', taskClass)));
  }

  const context = (): CommandContext => ({
    platform: PLATFORM,
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: STATE,
    harness: CODEX,
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: 'gitnexus-eval',
    benchmarkVariant: null,
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    optimizationCandidate: 'gitnexus',
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
    now: () => '2026-09-11T12:00:00.000Z',
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
        state: STATE,
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  });

  return { addBaseline, addOptimized, attribute, context };
}

describe('candidate benchmark campaign', () => {
  it('plans two deterministic pairs per task class without writing campaign state', () => {
    const slots = planCandidateBenchmarkCampaign('gitnexus-eval');
    assert.ok(slots);
    assert.equal(slots.length, 8);
    assert.deepEqual(
      slots.map((slot) => slot.benchmarkId),
      [
        'gitnexus-eval-m-1',
        'gitnexus-eval-m-2',
        'gitnexus-eval-s-1',
        'gitnexus-eval-s-2',
        'gitnexus-eval-h-1',
        'gitnexus-eval-h-2',
        'gitnexus-eval-c-1',
        'gitnexus-eval-c-2',
      ],
    );
    assert.equal(candidateBenchmarkCampaignBenchmarkId('x'.repeat(61), 'mechanical', 1), null);
  });

  it('starts an empty campaign at the first mechanical baseline', async () => {
    const world = fixture();
    const result = await runCandidateBenchmarkMatrix(world.context());
    assert.equal(result.exitCode, 0);
    assert.ok(result.data?.campaign);
    assert.equal(result.data.campaign.totalPairs, 8);
    assert.equal(result.data.campaign.completedPairs, 0);
    assert.equal(result.data.campaign.invalidPairs, 0);
    assert.equal(result.data.campaign.slots[0]?.state, 'baseline-not-started');
    assert.match(result.data.campaign.nextCommand ?? '', /gitnexus-eval-m-1/);
    assert.match(result.data.campaign.nextCommand ?? '', /--variant baseline/);
    assert.match(result.data.campaign.nextCommand ?? '', /--candidate gitnexus/);
  });

  it('resumes after a completed baseline and requires external activation before optimized', async () => {
    const world = fixture();
    world.addBaseline('gitnexus-eval-m-1', 'mechanical');

    const result = await runCandidateBenchmarkMatrix(world.context());
    assert.equal(result.exitCode, 0);
    assert.ok(result.data?.campaign);
    assert.equal(result.data.campaign.slots[0]?.state, 'optimized-not-started');
    assert.match(result.data.campaign.nextCommand ?? '', /--variant optimized/);
    assert.match(result.data.campaign.nextInstruction, /Enable gitnexus/);
  });

  it('aggregates only completed campaign pairs and advances to the next slot', async () => {
    const world = fixture();
    world.addBaseline('gitnexus-eval-m-1', 'mechanical');
    world.addOptimized('gitnexus-eval-m-1', 'mechanical');

    const result = await runCandidateBenchmarkMatrix(world.context());
    assert.equal(result.exitCode, 0);
    assert.ok(result.data?.campaign);
    assert.equal(result.data.campaign.completedPairs, 1);
    assert.equal(result.data.campaign.evidence.pairs, 1);
    assert.equal(result.data.campaign.evidence.optimizedBetter, 1);
    assert.equal(result.data.campaign.evidence.localTokenSavingPercent, 33.3);
    assert.equal(result.data.campaign.evidence.wallClockSavingPercent, 25);
    assert.match(result.data.campaign.nextCommand ?? '', /gitnexus-eval-m-2/);
  });

  it('fails closed when a planned slot belongs to a different candidate', async () => {
    const world = fixture();
    world.addBaseline('gitnexus-eval-m-1', 'mechanical', 'headroom');

    const result = await runCandidateBenchmarkMatrix(world.context());
    assert.equal(result.exitCode, 0);
    assert.ok(result.data?.campaign);
    assert.equal(result.data.campaign.invalidPairs, 1);
    assert.equal(result.data.campaign.slots[0]?.state, 'invalid');
    assert.equal(result.data.campaign.nextCommand, null);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-benchmark-campaign-state-invalid'),
      true,
    );
  });
});
