import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { runApply } from '../src/commands/apply.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable,
    interpreter: 'direct',
    executablePath: `/usr/bin/${request.executable}`,
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

function context(candidate: 'mcptoon' | 'headroom' = 'mcptoon'): CommandContext {
  let writes = 0;
  const ctx: CommandContext = {
    platform: PLATFORM,
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
    harness: harnessId('codex'),
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: null,
    benchmarkVariant: null,
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    optimizationCandidate: candidate,
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    tasksRemaining: null,
    nativePolicy: false,
    agentSkill: false,
    since: null,
    until: null,
    planId: null,
    transactionId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-13T19:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidatePath, parent) => candidatePath.startsWith(parent),
        stat: async (): Promise<FileStat | null> => null,
        readFile: async () => new Uint8Array(),
        writeFile: async () => {
          writes += 1;
        },
        appendFile: async () => {
          writes += 1;
        },
        createDirectory: async () => {
          writes += 1;
        },
        remove: async () => {
          writes += 1;
        },
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
          if (request.executable === 'codex') return outcome(request, 'codex-cli 0.153.0');
          if (request.executable === 'pipx') return outcome(request, '1.4.3');
          if (request.executable === 'mcptoon') {
            return {
              ...outcome(request, ''),
              executablePath: null,
              exitCode: null,
              failure: { reason: 'executable-not-found', message: 'mcptoon not installed' },
            };
          }
          throw new Error(`unexpected executable ${request.executable}`);
        },
      },
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/state',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  };
  Object.defineProperty(ctx, '__writes', { get: () => writes });
  return ctx;
}

describe('managed candidate lifecycle', () => {
  it('plans mcptoon installation and activation without mutating before confirmation', async () => {
    const ctx = context();
    const result = await runApply(ctx);
    assert.equal(result.exitCode, 8);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'confirmation-required'),
      true,
    );
    assert.equal((ctx as CommandContext & { __writes: number }).__writes, 0);
  });

  it('fails closed instead of treating an unreviewed candidate as a production provider', async () => {
    const result = await runApply(context('headroom'));
    assert.equal(result.exitCode, 2);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-managed-lifecycle-unavailable'),
      true,
    );
  });
});
