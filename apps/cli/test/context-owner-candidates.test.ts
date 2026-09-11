import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FileSystemPort,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { observeContextOptimizationCandidates } from '../src/commands/context-owner-candidates.js';
import type { CommandContext } from '../src/commands/context.js';

const FACTS: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const NO_FILESYSTEM: FileSystemPort = {
  join: (...segments) => segments.join('/'),
  dirname: (path) => path,
  basename: (path) => path,
  isInside: () => false,
  stat: () => Promise.reject(new Error('candidate observation must not read files when absent')),
  readFile: () =>
    Promise.reject(new Error('candidate observation must not read files when absent')),
  writeFile: () => Promise.reject(new Error('candidate observation must not write files')),
  appendFile: () => Promise.reject(new Error('candidate observation must not write files')),
  createDirectory: () => Promise.reject(new Error('candidate observation must not write files')),
  remove: () => Promise.reject(new Error('candidate observation must not write files')),
  readDirectory: () =>
    Promise.reject(new Error('candidate observation must not read files when absent')),
};

function missingOutcome(request: ProcessRequest): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: {
      reason: 'executable-not-found',
      message: `${request.executable} missing`,
    },
  };
}

const RUNNER: ProcessRunner = {
  run: (request) => Promise.resolve(missingOutcome(request)),
};

function context(): CommandContext {
  return {
    platform: FACTS,
    projectRoot: '/work/demo',
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
    optimizationCandidate: null,
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    tasksRemaining: null,
    nativePolicy: false,
    agentSkill: false,
    metricsAllProjects: false,
    since: null,
    until: null,
    planId: null,
    transactionId: null,
    confirmed: false,
    metrics: null,
    adapters: {
      fs: NO_FILESYSTEM,
      runner: RUNNER,
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/home/dev/.local/state/token-harness',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: (path) => `p_${path.length.toString(16)}`,
    },
    compatibilityRows: null,
    now: () => '2026-09-11T11:00:00.000Z',
  };
}

test(
  'projects all read-only optimization candidates into the shared context snapshot',
  async () => {
    const snapshot = await observeContextOptimizationCandidates(context());

    assert.deepEqual(
      snapshot.candidates.map((candidate) => candidate.id),
      ['headroom', 'mcptoon', 'gitnexus'],
    );
    const gitnexus = snapshot.candidates.find((candidate) => candidate.id === 'gitnexus');
    assert.equal(gitnexus?.state, 'absent');
    assert.equal(gitnexus?.category, 'context-minimization');
    assert.equal(gitnexus?.minimumBenchmarkVersion, 'capability-gated');
    assert.ok(
      snapshot.diagnostics.some(
        (item) => item.subject === 'gitnexus' && item.code === 'context-optimizer-gitnexus-absent',
      ),
    );
  },
);
