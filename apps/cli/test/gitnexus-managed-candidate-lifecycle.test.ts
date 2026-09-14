import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GITNEXUS_MCP_SERVER } from '@token-harness/adapters';
import {
  harnessId,
  jsonValueDigest,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { runApply } from '../src/commands/apply.js';
import type { CommandContext } from '../src/commands/context.js';
import { runUninstall } from '../src/commands/rollback.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};
const ACTIVATION_ACTION_ID = 'gitnexus:claude:mcp-server';
const REMOVAL_ACTION_ID = 'gitnexus:claude:mcp-server:remove';
const CONFIG_PATH = '/home/dev/.claude.json';
const OWNED = {
  kind: 'owned-json-entry' as const,
  path: CONFIG_PATH,
  pointer: 'mcpServers.gitnexus',
  placement: 'value' as const,
  valueDigest: jsonValueDigest(GITNEXUS_MCP_SERVER),
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
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

function fixture(claudeVersion = '2.1.269') {
  const files = new Map<string, string>();
  const directories = new Set([
    '/',
    '/home',
    '/home/dev',
    '/project',
    '/state',
    '/state/journals',
    '/state/backups',
  ]);
  const probes: string[] = [];
  let writes = 0;

  const immediateChildren = (path: string): string[] => {
    const prefix = path === '/' ? '/' : `${path}/`;
    const children = new Set<string>();
    for (const candidate of [...files.keys(), ...directories]) {
      if (!candidate.startsWith(prefix) || candidate === path) continue;
      const rest = candidate.slice(prefix.length);
      const child = rest.split('/')[0];
      if (child) children.add(child);
    }
    return [...children];
  };

  const context = (confirmed = false): CommandContext => ({
    platform: PLATFORM,
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
    harness: harnessId('claude'),
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: null,
    benchmarkVariant: null,
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    optimizationCandidate: 'gitnexus',
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
    confirmed,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-14T20:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}/`),
        stat: async (path): Promise<FileStat | null> => {
          if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
          const text = files.get(path);
          return text === undefined
            ? null
            : { kind: 'file', byteLength: new TextEncoder().encode(text).byteLength, mode: null };
        },
        readFile: async (path) => {
          const text = files.get(path);
          if (text === undefined) throw new Error(`missing ${path}`);
          return new TextEncoder().encode(text);
        },
        writeFile: async (path, bytes) => {
          writes += 1;
          files.set(path, new TextDecoder().decode(bytes));
        },
        appendFile: async (path, bytes) => {
          writes += 1;
          files.set(path, `${files.get(path) ?? ''}${new TextDecoder().decode(bytes)}`);
        },
        createDirectory: async (path) => {
          writes += 1;
          directories.add(path);
        },
        remove: async (path) => {
          writes += 1;
          files.delete(path);
          directories.delete(path);
        },
        readDirectory: async (path) => immediateChildren(path),
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
          const command = `${request.executable} ${request.args.join(' ')}`;
          probes.push(command);
          if (request.executable === 'claude' && request.args[0] === '--version') {
            return outcome(request, `claude-code ${claudeVersion}`);
          }
          if (request.executable === 'gitnexus' && request.args[0] === '--version') {
            return outcome(request, 'gitnexus 1.6.12');
          }
          if (request.executable === 'gitnexus' && request.args[0] === '--help') {
            return outcome(
              request,
              'Commands:\n  status\n  query [search]\n  context [name]\n  mcp Start MCP server',
            );
          }
          if (
            request.executable === 'gitnexus' &&
            request.args[0] === 'status' &&
            request.args[1] === '--help'
          ) {
            return outcome(request, 'Options:\n  --json machine readable');
          }
          throw new Error(`unexpected command ${command}`);
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
  });

  const setConfig = (gitnexus: unknown = GITNEXUS_MCP_SERVER) => {
    files.set(
      CONFIG_PATH,
      `${JSON.stringify({ keep: true, mcpServers: { gitnexus } }, null, 2)}\n`,
    );
  };

  const addJournal = (
    transactionId: string,
    actionId: string,
    startedAt: string,
    ownership = actionId === ACTIVATION_ACTION_ID ? [OWNED] : [],
  ) => {
    files.set(
      `/state/journals/${transactionId}.json`,
      `${JSON.stringify({
        schemaVersion: 1,
        transactionId,
        planId: null,
        projectId: 'p_test',
        projectRoot: '/project',
        startedAt,
        finishedAt: startedAt,
        outcome: 'committed',
        entries: [
          {
            actionId,
            kind: actionId === ACTIVATION_ACTION_ID ? 'merge-json' : 'remove-owned-change',
            status: 'applied',
            snapshots: [],
            ownership,
            diagnostics: [],
            packageInventory: null,
          },
        ],
        ownership,
        pinned: false,
        diagnostics: [],
      })}\n`,
    );
  };

  return {
    context,
    files,
    probes,
    setConfig,
    addJournal,
    writes: () => writes,
  };
}

describe('GitNexus managed candidate lifecycle', () => {
  it('routes exact reviewed apply through a reversible Claude MCP preview without writing first', async () => {
    const world = fixture();
    const result = await runApply(world.context(false));

    assert.equal(result.exitCode, 8);
    assert.equal(result.diagnostics.some((entry) => entry.code === 'confirmation-required'), true);
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, [
      'claude --version',
      'gitnexus --version',
      'gitnexus --version',
      'gitnexus --help',
      'gitnexus status --help',
    ]);
  });

  it('fails closed on an adjacent Claude version before probing GitNexus', async () => {
    const world = fixture('2.1.270');
    const result = await runApply(world.context(false));

    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-benchmark-campaign-row-unreviewed'),
      true,
    );
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, ['claude --version']);
  });

  it('does not retroactively claim a byte-identical user-owned MCP entry', async () => {
    const world = fixture();
    world.setConfig();

    const result = await runApply(world.context(false));
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-managed-guidance-not-owned'),
      true,
    );
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, ['claude --version', 'gitnexus --version']);
  });

  it('treats an absent MCP entry as already inactive without probing the GitNexus binary', async () => {
    const world = fixture();
    const result = await runUninstall(world.context(false));

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'nothing-to-do');
    assert.equal(result.data?.requestedStateVerified, true);
    assert.deepEqual(world.probes, []);
  });

  it('refuses to remove an exact but user-owned MCP entry without probing GitNexus', async () => {
    const world = fixture();
    world.setConfig();

    const result = await runUninstall(world.context(false));
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-managed-guidance-not-owned'),
      true,
    );
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, []);
  });

  it('offers surgical uninstall only when the latest lifecycle state has active ownership', async () => {
    const world = fixture();
    world.setConfig();
    world.addJournal('activate', ACTIVATION_ACTION_ID, '2026-09-14T19:00:00.000Z');

    const result = await runUninstall(world.context(false));
    assert.equal(result.exitCode, 8);
    assert.equal(result.diagnostics.some((entry) => entry.code === 'confirmation-required'), true);
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, []);
  });

  it('does not reuse an old activation receipt after a later committed removal', async () => {
    const world = fixture();
    world.setConfig();
    world.addJournal('activate', ACTIVATION_ACTION_ID, '2026-09-14T19:00:00.000Z');
    world.addJournal('remove', REMOVAL_ACTION_ID, '2026-09-14T19:30:00.000Z', []);

    const result = await runUninstall(world.context(false));
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'candidate-managed-guidance-not-owned'),
      true,
    );
    assert.equal(world.writes(), 0);
    assert.deepEqual(world.probes, []);
  });
});
