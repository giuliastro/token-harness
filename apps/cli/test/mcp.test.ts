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
import { runMcp } from '../src/commands/mcp.js';

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
    executablePath: '/usr/local/bin/codex',
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

describe('mcp command', () => {
  it('reports native Codex MCP server and tool inventory without a tool call', async () => {
    const requests: ProcessRequest[] = [];
    const context: CommandContext = {
      platform: PLATFORM,
      projectRoot: '/home/dev/project',
      home: '/home/dev',
      stateRoot: null,
      harness: harnessId('codex'),
      provider: null,
      since: null,
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
        runner: {
          run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
            requests.push(request);
            if (request.args[0] === '--version') return outcome(request, 'codex-cli 0.146.0');
            return outcome(
              request,
              [
                JSON.stringify({ id: 1, result: {} }),
                JSON.stringify({
                  id: 2,
                  result: {
                    config: {
                      model: 'gpt-5.6-codex',
                      project_root_markers: ['.git'],
                      project_doc_fallback_filenames: [],
                    },
                    origins: {},
                    layers: [],
                  },
                }),
                JSON.stringify({
                  id: 3,
                  result: {
                    data: [
                      {
                        name: 'github',
                        runtimeStatus: 'connected',
                        pluginId: null,
                        serverInfo: null,
                        tools: { search: {}, issue: {}, pull: {} },
                        resources: [],
                        resourceTemplates: [],
                        authStatus: 'oAuth',
                      },
                    ],
                    nextCursor: null,
                  },
                }),
                JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }),
              ].join('\n'),
            );
          },
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
    };

    const result = await runMcp(context);
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.harnesses.length, 1);
    assert.equal(result.data.harnesses[0]?.knownToolCount, 3);
    assert.equal(result.data.harnesses[0]?.unknownToolServerCount, 0);
    assert.equal(result.data.harnesses[0]?.servers[0]?.name, 'github');
    assert.equal(result.data.harnesses[0]?.servers[0]?.runtimeStatus, 'connected');

    const appServer = requests.find((request) => request.args[0] === 'app-server');
    assert.ok(appServer);
    assert.match(appServer.stdin ?? '', /mcpServerStatus\/list/);
    assert.doesNotMatch(appServer.stdin ?? '', /mcpServer\/tool\/call|config\/write/);
  });
});
