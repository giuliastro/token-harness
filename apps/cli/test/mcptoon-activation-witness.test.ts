import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, PlatformFacts, ProcessOutcome, ProcessRequest } from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import {
  evaluateMcptoonActivation,
  readMcptoonUsageObservation,
  type McptoonActivationCapture,
  type McptoonUsageObservation,
} from '../src/commands/mcptoon-activation-witness.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function activationCapture(totalCalls = 5): McptoonActivationCapture {
  return {
    schemaVersion: 1,
    benchmarkId: 'mcptoon-eval-s-1',
    projectId: 'p_test',
    variant: 'optimized',
    startedAt: '2026-09-13T10:00:00.000Z',
    version: '0.7.10',
    observationState: 'observed',
    totalCalls,
  };
}

function observation(
  totalCalls: number,
  calls: Array<{ ok: boolean; ts: number }>,
): McptoonUsageObservation {
  return {
    state: 'observed',
    version: '0.7.10',
    totalCalls,
    calls,
    reason: 'test',
  };
}

function contextWithUsage(rawUsage: string | null): CommandContext {
  const usagePath = '/home/dev/.cache/mcptoon/usage.json';
  const encoded = new TextEncoder();
  return {
    platform: PLATFORM,
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
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
    nativePolicy: false,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-13T10:10:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (path): Promise<FileStat | null> => {
          if (path !== usagePath || rawUsage === null) return null;
          return { kind: 'file', byteLength: encoded.encode(rawUsage).byteLength, mode: null };
        },
        readFile: async (path) => {
          if (path !== usagePath || rawUsage === null) throw new Error('missing');
          return encoded.encode(rawUsage);
        },
        writeFile: async () => undefined,
        appendFile: async () => undefined,
        createDirectory: async () => undefined,
        remove: async () => undefined,
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => ({
          displayCommand: request.executable,
          interpreter: 'direct',
          executablePath: '/usr/bin/mcptoon',
          exitCode: 0,
          signal: null,
          stdout: 'mcptoon 0.7.10\n',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        }),
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
}

describe('mcptoon activation witness', () => {
  it('reads only bounded usage facts and drops server/tool identities immediately', async () => {
    const raw = JSON.stringify({
      total: 9,
      calls: [
        {
          server: 'private-server-name',
          tool: 'secret_tool_name',
          ok: true,
          tokens: 0,
          ts: 1789293900,
        },
      ],
    });
    const result = await readMcptoonUsageObservation(contextWithUsage(raw));

    assert.equal(result.state, 'observed');
    assert.equal(result.totalCalls, 9);
    assert.deepEqual(result.calls, [{ ok: true, ts: 1789293900 }]);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-server-name|secret_tool_name/);
  });

  it('treats an absent usage file as a valid zero-call boundary', async () => {
    const result = await readMcptoonUsageObservation(contextWithUsage(null));
    assert.equal(result.state, 'observed');
    assert.equal(result.totalCalls, 0);
    assert.deepEqual(result.calls, []);
  });

  it('verifies exact-version successful activity inside the optimized task window', () => {
    const result = evaluateMcptoonActivation(
      activationCapture(5),
      observation(7, [
        { ok: true, ts: Date.parse('2026-09-13T10:04:00.000Z') / 1000 },
        { ok: false, ts: Date.parse('2026-09-13T10:06:00.000Z') / 1000 },
      ]),
      '2026-09-13T10:10:00.000Z',
    );

    assert.equal(result?.state, 'verified');
    assert.equal(result?.callDelta, 2);
    assert.equal(result?.callsDuringWindow, 2);
    assert.equal(result?.successfulCallsDuringWindow, 1);
  });

  it('blocks when the optimized task records no mcptoon calls', () => {
    const result = evaluateMcptoonActivation(
      activationCapture(5),
      observation(5, []),
      '2026-09-13T10:10:00.000Z',
    );
    assert.equal(result?.state, 'blocked');
    assert.equal(result?.callDelta, 0);
  });

  it('fails closed when usage grew but the bounded call buffer cannot place activity in-window', () => {
    const result = evaluateMcptoonActivation(
      activationCapture(5),
      observation(6, [{ ok: true, ts: Date.parse('2026-09-13T09:55:00.000Z') / 1000 }]),
      '2026-09-13T10:10:00.000Z',
    );
    assert.equal(result?.state, 'unknown');
  });

  it('fails closed when the monotonic counter moves backwards', () => {
    const result = evaluateMcptoonActivation(
      activationCapture(5),
      observation(4, [{ ok: true, ts: Date.parse('2026-09-13T10:05:00.000Z') / 1000 }]),
      '2026-09-13T10:10:00.000Z',
    );
    assert.equal(result?.state, 'unknown');
    assert.equal(result?.callDelta, null);
  });

  it('blocks activity that was invoked but never succeeded', () => {
    const result = evaluateMcptoonActivation(
      activationCapture(5),
      observation(6, [{ ok: false, ts: Date.parse('2026-09-13T10:05:00.000Z') / 1000 }]),
      '2026-09-13T10:10:00.000Z',
    );
    assert.equal(result?.state, 'blocked');
    assert.equal(result?.successfulCallsDuringWindow, 0);
  });
});
