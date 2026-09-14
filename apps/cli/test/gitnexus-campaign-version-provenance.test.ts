import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GITNEXUS_REVIEWED_BENCHMARK_VERSION } from '@token-harness/adapters';
import {
  harnessId,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import {
  parseCandidateBenchmarkAttribution,
  readCandidateBenchmarkAttribution,
  writeCandidateBenchmarkAttribution,
} from '../src/commands/candidate-benchmark-attribution.js';
import { validateCandidateCampaignRuntimeSurface } from '../src/commands/candidate-campaign-surface.js';
import type { CommandContext } from '../src/commands/context.js';

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};
const BENCHMARK_ID = 'gitnexus-standard-1';
const ATTRIBUTION_PATH = `/state/benchmarks/${BENCHMARK_ID}/candidate.json`;

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable,
    interpreter: 'direct',
    executablePath: request.executable,
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: null,
  };
}

function fixture(version = GITNEXUS_REVIEWED_BENCHMARK_VERSION) {
  const files = new Map<string, Uint8Array>();
  const probes: string[] = [];
  const context: CommandContext = {
    platform: LINUX,
    projectRoot: '/repo',
    home: '/home/test',
    stateRoot: '/state',
    harness: harnessId('codex'),
    provider: null,
    benchmarkId: BENCHMARK_ID,
    benchmarkVariant: 'baseline',
    optimizationCandidate: 'gitnexus',
    taskClass: 'standard',
    budgetProfile: null,
    reservePercent: null,
    nativePolicy: false,
    agentSkill: false,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-14T14:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts: string[]) => parts.join('/').replaceAll('//', '/'),
        stat: async (path: string) => {
          const bytes = files.get(path);
          return bytes === undefined
            ? null
            : { kind: 'file' as const, byteLength: bytes.byteLength, mode: null };
        },
        readFile: async (path: string) => {
          const bytes = files.get(path);
          if (bytes === undefined) throw new Error('missing');
          return bytes;
        },
        writeFile: async (path: string, bytes: Uint8Array) => {
          files.set(path, new Uint8Array(bytes));
        },
      },
      runner: {
        run: async (request: ProcessRequest) => {
          probes.push(`${request.executable} ${request.args.join(' ')}`);
          if (request.executable !== 'gitnexus' || request.args.join(' ') !== '--version') {
            throw new Error(`unexpected probe ${request.executable} ${request.args.join(' ')}`);
          }
          return outcome(request, `gitnexus ${version}`);
        },
      },
      projectIdFor: () => 'p_test',
    } as unknown as CommandContext['adapters'],
  };
  return { context, files, probes };
}

function attribution() {
  return {
    schemaVersion: 1 as const,
    benchmarkId: BENCHMARK_ID,
    candidateId: 'gitnexus' as const,
    projectId: 'p_test',
  };
}

describe('GitNexus benchmark version provenance', () => {
  it('keeps a legacy sidecar parseable but refuses it as candidate evidence', async () => {
    const world = fixture();
    const legacy = attribution();
    assert.deepEqual(parseCandidateBenchmarkAttribution(legacy), legacy);
    world.files.set(ATTRIBUTION_PATH, new TextEncoder().encode(JSON.stringify(legacy)));

    assert.equal(await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID), 'invalid');
    assert.deepEqual(world.probes, []);
  });

  it('persists and accepts the exact reviewed GitNexus build', async () => {
    const world = fixture();
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), true);

    const persisted = JSON.parse(new TextDecoder().decode(world.files.get(ATTRIBUTION_PATH))) as {
      candidateVersion?: string;
    };
    assert.equal(persisted.candidateVersion, GITNEXUS_REVIEWED_BENCHMARK_VERSION);

    const read = await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID);
    assert.notEqual(read, 'invalid');
    assert.notEqual(read, 'absent');
    if (typeof read !== 'string') {
      assert.equal(read.candidateVersion, GITNEXUS_REVIEWED_BENCHMARK_VERSION);
    }
    assert.deepEqual(world.probes, ['gitnexus --version']);
  });

  it('does not write candidate attribution for an unreviewed GitNexus build', async () => {
    const world = fixture('1.6.13-rc.1');
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), false);
    assert.equal(world.files.has(ATTRIBUTION_PATH), false);
    assert.deepEqual(world.probes, ['gitnexus --version']);
  });

  it('requires the exact reviewed build before baseline or optimized starts', async () => {
    for (const variant of ['baseline', 'optimized'] as const) {
      const world = fixture();
      world.context.benchmarkVariant = variant;
      const diagnostic = await validateCandidateCampaignRuntimeSurface(
        world.context,
        variant === 'optimized',
      );
      assert.equal(diagnostic, null);
      assert.deepEqual(world.probes, ['gitnexus --version']);
    }
  });

  it('fails closed on a different build and keeps matrix reads passive', async () => {
    const mismatched = fixture('1.6.13-rc.1');
    const diagnostic = await validateCandidateCampaignRuntimeSurface(mismatched.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-provider-version-unreviewed');
    assert.equal(diagnostic?.subject, 'gitnexus');
    assert.deepEqual(mismatched.probes, ['gitnexus --version']);

    const matrix = fixture('1.6.13-rc.1');
    matrix.context.benchmarkVariant = null;
    assert.equal(await validateCandidateCampaignRuntimeSurface(matrix.context, false), null);
    assert.deepEqual(matrix.probes, []);
  });
});
