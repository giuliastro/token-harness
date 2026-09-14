import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GITNEXUS_REVIEWED_BENCHMARK_VERSION } from '@token-harness/adapters';
import {
  harnessId,
  providerId,
  type CompatibilityRow,
  type GitNexusMcpRuntimeState,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type TaskBenchmarkCapture,
  type TaskBenchmarkContextSnapshot,
  type TaskBenchmarkReceipt,
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
const TEST_HARNESS_VERSION = '9.9.9';
const TEST_GITNEXUS_ROW: CompatibilityRow = {
  harness: harnessId('codex'),
  harnessVersion: { minimum: TEST_HARNESS_VERSION, maximum: TEST_HARNESS_VERSION },
  provider: providerId('gitnexus'),
  providerVersion: GITNEXUS_REVIEWED_BENCHMARK_VERSION,
  platform: { os: 'linux', wsl: false, supported: true, limitation: null },
  configSchema: 'test-only-gitnexus-campaign-row',
  fixture: 'test-only/gitnexus-campaign-row',
  verificationTier: 'config-only',
};
const BENCHMARK_ID = 'gitnexus-standard-1';
const BENCHMARK_ROOT = `/state/benchmarks/${BENCHMARK_ID}`;
const ATTRIBUTION_PATH = `${BENCHMARK_ROOT}/candidate.json`;
const BASELINE_CAPTURE_PATH = `${BENCHMARK_ROOT}/baseline.capture.json`;
const BASELINE_RECEIPT_PATH = `${BENCHMARK_ROOT}/baseline.json`;

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

function contextSnapshot(state: GitNexusMcpRuntimeState): TaskBenchmarkContextSnapshot {
  return {
    observationState: 'observed',
    rawMcpServerCount: state === 'absent' ? 0 : 1,
    rawKnownMcpToolCount: state === 'absent' ? 0 : 1,
    unknownMcpToolServerCount: 0,
    mcpInventoryTruncated: false,
    effectiveStaticMcpServerCount: state === 'absent' ? 0 : 1,
    effectiveStaticMcpToolCount: state === 'absent' ? 0 : 1,
    toolDeferralState: null,
    toolDeferralMechanism: null,
    gitNexusMcpRuntimeState: state,
  };
}

function baselineCapture(state: GitNexusMcpRuntimeState = 'absent'): TaskBenchmarkCapture {
  return {
    schemaVersion: 1,
    benchmarkId: BENCHMARK_ID,
    variant: 'baseline',
    taskClass: 'standard',
    harnessId: harnessId('codex'),
    projectId: 'p_test',
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-14T14:00:00.000Z',
    usageBefore: [],
    contextAtStart: contextSnapshot(state),
    localSessionsBefore: null,
  };
}

function baselineReceipt(
  start: GitNexusMcpRuntimeState = 'absent',
  finish: GitNexusMcpRuntimeState = 'absent',
): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: BENCHMARK_ID,
    variant: 'baseline',
    taskClass: 'standard',
    harnessId: harnessId('codex'),
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-14T14:00:00.000Z',
    completedAt: '2026-09-14T14:10:00.000Z',
    usageBefore: [],
    usageAfter: [],
    contextAtStart: contextSnapshot(start),
    contextAtFinish: contextSnapshot(finish),
    localUsage: null,
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
  };
}

function fixture(
  version = GITNEXUS_REVIEWED_BENCHMARK_VERSION,
  harnessVersion = TEST_HARNESS_VERSION,
  compatibilityRows: readonly CompatibilityRow[] | null = [TEST_GITNEXUS_ROW],
) {
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
    compatibilityRows,
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
          if (request.args.join(' ') !== '--version') {
            throw new Error(`unexpected probe ${request.executable} ${request.args.join(' ')}`);
          }
          if (request.executable === 'gitnexus') return outcome(request, `gitnexus ${version}`);
          if (request.executable === 'codex') return outcome(request, `codex ${harnessVersion}`);
          throw new Error(`unexpected executable ${request.executable}`);
        },
      },
      projectIdFor: () => 'p_test',
    } as unknown as CommandContext['adapters'],
  };

  const put = (path: string, value: unknown) => {
    files.set(path, new TextEncoder().encode(JSON.stringify(value)));
  };

  return { context, files, probes, put };
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
    world.put(ATTRIBUTION_PATH, legacy);

    assert.equal(await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID), 'invalid');
    assert.deepEqual(world.probes, []);
  });

  it('persists and accepts the exact reviewed build only for a clean baseline capture', async () => {
    const world = fixture();
    world.put(BASELINE_CAPTURE_PATH, baselineCapture());
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

  it('does not write candidate attribution when GitNexus is present at baseline start', async () => {
    const world = fixture();
    world.put(BASELINE_CAPTURE_PATH, baselineCapture('usable'));

    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), false);
    assert.equal(world.files.has(ATTRIBUTION_PATH), false);
    assert.deepEqual(world.probes, ['gitnexus --version']);
  });

  it('invalidates candidate evidence if GitNexus appears before the baseline finishes', async () => {
    const world = fixture();
    world.put(BASELINE_CAPTURE_PATH, baselineCapture());
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), true);

    world.put(BASELINE_RECEIPT_PATH, baselineReceipt('absent', 'usable'));
    assert.equal(await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID), 'invalid');
    assert.deepEqual(world.probes, ['gitnexus --version']);
  });

  it('keeps completed baseline evidence only when GitNexus is absent at both boundaries', async () => {
    const world = fixture();
    world.put(BASELINE_CAPTURE_PATH, baselineCapture());
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), true);

    world.put(BASELINE_RECEIPT_PATH, baselineReceipt());
    const read = await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID);
    assert.notEqual(read, 'invalid');
    assert.notEqual(read, 'absent');
  });

  it('treats sentinel-like corrupt receipt JSON as invalid instead of falling back to capture', async () => {
    const world = fixture();
    world.put(BASELINE_CAPTURE_PATH, baselineCapture());
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), true);

    world.put(BASELINE_RECEIPT_PATH, 'absent');
    assert.equal(await readCandidateBenchmarkAttribution(world.context, BENCHMARK_ID), 'invalid');
  });

  it('does not write candidate attribution for an unreviewed GitNexus build', async () => {
    const world = fixture('1.6.13-rc.1');
    world.put(BASELINE_CAPTURE_PATH, baselineCapture());
    assert.equal(await writeCandidateBenchmarkAttribution(world.context, attribution()), false);
    assert.equal(world.files.has(ATTRIBUTION_PATH), false);
    assert.deepEqual(world.probes, ['gitnexus --version']);
  });

  it('requires an exact reviewed campaign row before probing the GitNexus build', async () => {
    const world = fixture(GITNEXUS_REVIEWED_BENCHMARK_VERSION, TEST_HARNESS_VERSION, []);
    const diagnostic = await validateCandidateCampaignRuntimeSurface(world.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
    assert.equal(diagnostic?.subject, 'gitnexus');
    assert.deepEqual(world.probes, ['codex --version']);
  });

  it('fails closed when the installed harness version is outside the injected reviewed row', async () => {
    const world = fixture(GITNEXUS_REVIEWED_BENCHMARK_VERSION, '9.9.10');
    const diagnostic = await validateCandidateCampaignRuntimeSurface(world.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
    assert.deepEqual(world.probes, ['codex --version']);
  });

  it('requires the exact reviewed build before baseline or optimized starts on an admitted row', async () => {
    for (const variant of ['baseline', 'optimized'] as const) {
      const world = fixture();
      world.context.benchmarkVariant = variant;
      const diagnostic = await validateCandidateCampaignRuntimeSurface(
        world.context,
        variant === 'optimized',
      );
      assert.equal(diagnostic, null);
      assert.deepEqual(world.probes, ['codex --version', 'gitnexus --version']);
    }
  });

  it('fails closed on a different build and keeps matrix reads passive', async () => {
    const mismatched = fixture('1.6.13-rc.1');
    const diagnostic = await validateCandidateCampaignRuntimeSurface(mismatched.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-provider-version-unreviewed');
    assert.equal(diagnostic?.subject, 'gitnexus');
    assert.deepEqual(mismatched.probes, ['codex --version', 'gitnexus --version']);

    const matrix = fixture('1.6.13-rc.1', TEST_HARNESS_VERSION, []);
    matrix.context.benchmarkVariant = null;
    assert.equal(await validateCandidateCampaignRuntimeSurface(matrix.context, false), null);
    assert.deepEqual(matrix.probes, []);
  });
});
