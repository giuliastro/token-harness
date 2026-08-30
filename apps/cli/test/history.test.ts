import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import { runHistory } from '../src/commands/history.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: '/usr/local/bin/ccusage',
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

function absent(request: ProcessRequest): ProcessOutcome {
  return {
    ...outcome(request, ''),
    executablePath: null,
    exitCode: null,
    failure: {
      reason: 'executable-not-found',
      message: 'ccusage not found',
    },
  };
}

function context(
  run: (request: ProcessRequest) => Promise<ProcessOutcome>,
  harness: ReturnType<typeof harnessId> | null = null,
): CommandContext {
  return {
    platform: PLATFORM,
    projectRoot: '/home/dev/project',
    home: '/home/dev',
    stateRoot: '/home/dev/.local/state/token-harness',
    harness,
    provider: null,
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    since: '7d',
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-08-30T16:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (): Promise<FileStat | null> => null,
        readFile: async () => new Uint8Array(),
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
      runner: { run },
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
  };
}

describe('history command', () => {
  it('reads ccusage 20.x offline without costs and keeps Claude/Codex separate', async () => {
    const requests: ProcessRequest[] = [];
    const daily = [100, 100, 100, 200, 220, 240].map((tokens, index) => ({
      agent: 'all',
      period: '2026-08-' + String(24 + index).padStart(2, '0'),
      agents: [
        {
          agent: 'claude',
          inputTokens: tokens,
          cacheCreationTokens: 0,
          cacheReadTokens: 10,
          outputTokens: 20,
          totalTokens: tokens + 30,
          modelsUsed: ['claude-sonnet-test'],
        },
        {
          agent: 'codex',
          inputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 5,
          outputTokens: 10,
          totalTokens: 65,
          modelsUsed: ['gpt-test'],
        },
      ],
    }));
    const payload = {
      daily,
      session: [
        {
          agent: 'claude',
          period: 'claude-session',
          inputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 50,
          outputTokens: 100,
          totalTokens: 650,
          modelsUsed: ['claude-sonnet-test'],
          metadata: {
            firstActivity: '2026-08-30T13:00:00.000Z',
            lastActivity: '2026-08-30T14:00:00.000Z',
          },
        },
        {
          agent: 'codex',
          period: 'codex-session',
          inputTokens: 300,
          cacheCreationTokens: 0,
          cacheReadTokens: 30,
          outputTokens: 60,
          totalTokens: 390,
          modelsUsed: ['gpt-test'],
          metadata: {
            firstActivity: '2026-08-30T14:30:00.000Z',
            lastActivity: '2026-08-30T15:00:00.000Z',
          },
        },
      ],
    };

    const result = await runHistory(
      context(async (request) => {
        requests.push(request);
        if (request.args[0] === '--version') return outcome(request, 'ccusage 20.0.20');
        return outcome(request, JSON.stringify(payload));
      }),
    );

    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.source.state, 'available');
    assert.equal(result.data.source.version, '20.0.20');
    assert.equal(result.data.source.costsIncluded, false);
    assert.equal(result.data.daily.length, 12);
    assert.equal(result.data.sessions.length, 2);

    const claude = result.data.harnesses.find((item) => item.harnessId === harnessId('claude'));
    assert.ok(claude);
    assert.equal(claude.days, 6);
    assert.equal(claude.sessions, 1);
    assert.equal(claude.burnTrend.state, 'rising');
    assert.ok((claude.burnTrend.changePercent ?? 0) > 20);
    assert.equal(claude.recentSession.state, 'recent-small');
    assert.equal(claude.recentSession.candidateSessionId, 'claude-session');
    assert.equal(claude.recentSession.durationMinutes, 60);

    const historyRequest = requests.at(-1);
    assert.ok(historyRequest);
    assert.deepEqual(historyRequest.args.slice(0, 7), [
      'daily',
      '--sections',
      'daily,session',
      '--by-agent',
      '--json',
      '--offline',
      '--no-cost',
    ]);
    assert.ok(historyRequest.args.includes('--timezone'));
    assert.ok(historyRequest.args.includes('UTC'));
    assert.ok(historyRequest.args.includes('--since'));
    assert.ok(historyRequest.args.includes('2026-08-23'));
    assert.ok(historyRequest.args.includes('--until'));
    assert.ok(historyRequest.args.includes('2026-08-30'));
  });

  it('keeps missing ccusage as absent instead of reporting zero usage', async () => {
    const result = await runHistory(context(async (request) => absent(request)));
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.source.state, 'absent');
    assert.equal(result.data.daily.length, 0);
    assert.equal(result.data.harnesses.length, 0);
    assert.equal(result.diagnostics[0]?.code, 'ccusage-not-installed');
  });

  it('fails closed when a supported major omits documented JSON sections', async () => {
    let calls = 0;
    const result = await runHistory(
      context(async (request) => {
        calls += 1;
        if (request.args[0] === '--version') return outcome(request, 'ccusage 20.0.20');
        return outcome(request, JSON.stringify({ daily: [] }));
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.source.state, 'unavailable');
    assert.equal(result.data.daily.length, 0);
    assert.equal(calls, 2);
    assert.equal(result.diagnostics[0]?.code, 'ccusage-history-invalid-schema');
  });

  it('refuses to parse an unproven ccusage major', async () => {
    let calls = 0;
    const result = await runHistory(
      context(async (request) => {
        calls += 1;
        return outcome(request, 'ccusage 21.0.0');
      }, harnessId('codex')),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.source.state, 'incompatible');
    assert.equal(result.data.source.version, '21.0.0');
    assert.equal(calls, 1);
    assert.equal(result.diagnostics[0]?.code, 'ccusage-version-incompatible');
  });
});
