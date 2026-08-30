import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { runContext } from '../src/commands/context-cost.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

describe('context-cost command', () => {
  it('mirrors Codex project-doc discovery and respects its byte cap', async () => {
    const files = new Map<string, FileStat>([
      ['/home/dev/project/.git', { kind: 'directory', byteLength: 0, mode: null }],
      ['/home/dev/project/AGENTS.md', { kind: 'file', byteLength: 20, mode: null }],
      ['/home/dev/project/sub/AGENTS.override.md', { kind: 'file', byteLength: 30, mode: null }],
    ]);

    const context: CommandContext = {
      platform: PLATFORM,
      projectRoot: '/home/dev/project/sub',
      home: '/home/dev',
      stateRoot: '/home/dev/.local/state/token-harness',
      harness: harnessId('codex'),
      provider: null,
      since: null,
      until: null,
      planId: null,
      confirmed: false,
      metrics: null,
      compatibilityRows: null,
      now: () => '2026-08-30T15:00:00.000Z',
      adapters: {
        fs: {
          join: (...parts) => parts.join('/').replaceAll('//', '/'),
          dirname: (path) => {
            if (path === '/') return '/';
            const parts = path.split('/').filter((part) => part !== '');
            if (parts.length <= 1) return '/';
            return '/' + parts.slice(0, -1).join('/');
          },
          basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
          isInside: (candidate, parent) => candidate.startsWith(parent),
          stat: async (path) => files.get(path) ?? null,
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
            const stdout =
              request.args[0] === '--version'
                ? 'codex-cli 0.146.0'
                : [
                    JSON.stringify({ id: 1, result: {} }),
                    JSON.stringify({
                      id: 2,
                      result: {
                        config: {
                          model: 'gpt-5.6-codex',
                          project_doc_max_bytes: 25,
                          project_root_markers: ['.git'],
                          project_doc_fallback_filenames: [],
                        },
                        origins: {},
                        layers: [],
                      },
                    }),
                    JSON.stringify({
                      id: 3,
                      result: { data: [], nextCursor: null },
                    }),
                    JSON.stringify({
                      id: 4,
                      result: { data: [], nextCursor: null },
                    }),
                  ].join('\n');
            return {
              displayCommand: 'codex ' + request.args.join(' '),
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

    const result = await runContext(context);
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    assert.equal(result.data.knownLoadedInstructionBytes, 25);
    assert.equal(result.data.discoveredInstructionBytes, 50);
    assert.equal(result.data.instructionHierarchy.length, 1);
    assert.equal(result.data.instructionHierarchy[0]?.nestedProjectHierarchy, true);
    assert.equal(result.data.instructionHierarchy[0]?.monolithicProjectInstructions, false);
    assert.equal(result.data.instructionHierarchy[0]?.distinctProjectDirectories, 2);
    assert.deepEqual(
      result.data.instructions.map((item) => ({
        path: item.path,
        bytes: item.byteLength,
        loaded: item.loadedBytes,
        truncated: item.truncated,
      })),
      [
        {
          path: '/home/dev/project/AGENTS.md',
          bytes: 20,
          loaded: 20,
          truncated: false,
        },
        {
          path: '/home/dev/project/sub/AGENTS.override.md',
          bytes: 30,
          loaded: 5,
          truncated: true,
        },
      ],
    );
  });
});
