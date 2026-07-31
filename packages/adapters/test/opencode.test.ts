import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileStat,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { opencodeAdapter, type HarnessContext } from '../src/index.js';

const HOME = '/home/dev';
const PROJECT = `${HOME}/project`;
const USER_CONFIG = `${HOME}/.config/opencode/opencode.jsonc`;
const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  isWsl: false,
  nodeVersion: '22.14.0',
};

function context(
  files: Record<string, string> = {},
  version: string | null = '1.0.0',
): HarnessContext {
  const encoder = new TextEncoder();
  return {
    fs: {
      join: (...parts) => parts.join('/').replaceAll('//', '/'),
      dirname: (path) => path.split('/').slice(0, -1).join('/'),
      basename: (path) => path.split('/').at(-1) ?? path,
      isInside: (candidate, parent) => candidate.startsWith(parent),
      stat: async (path): Promise<FileStat | null> =>
        Object.hasOwn(files, path)
          ? { kind: 'file', byteLength: files[path]?.length ?? 0, mode: null }
          : null,
      readFile: async (path) => encoder.encode(files[path] ?? ''),
      writeFile: async () => {
        throw new Error('read-only test port');
      },
      appendFile: async () => {
        throw new Error('read-only test port');
      },
      createDirectory: async () => {
        throw new Error('read-only test port');
      },
      remove: async () => {
        throw new Error('read-only test port');
      },
      readDirectory: async () => [],
    },
    runner: {
      run: async (request: ProcessRequest): Promise<ProcessOutcome> => ({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: version === null ? null : '/usr/local/bin/opencode',
        exitCode: version === null ? null : 0,
        signal: null,
        stdout: version ?? '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: version === null ? { reason: 'executable-not-found', message: 'missing' } : null,
      }),
    } satisfies ProcessRunner,
    facts: LINUX,
    paths: {
      home: HOME,
      config: `${HOME}/.config/token-harness`,
      data: `${HOME}/.local/share/token-harness`,
      state: `${HOME}/.local/state/token-harness`,
      cache: `${HOME}/.cache/token-harness`,
    },
    projectRoot: PROJECT,
  };
}

describe('OpenCode adapter', () => {
  const configured = `{
  // OpenCode permits this comment and a trailing comma.
  "plugin": ["./.opencode/plugin/harnesstrim.ts",],
}\n`;

  it('detects an adopted JSONC plugin configuration without requiring strict JSON', async () => {
    const result = await opencodeAdapter.detect(context({ [USER_CONFIG]: configured }));
    assert.equal(result.state, 'configured');
    assert.equal(result.configPath, USER_CONFIG);
  });

  it('exposes plugin paths through the harness/provider seam without interpreting them', async () => {
    const result = await opencodeAdapter.inspect(context({ [USER_CONFIG]: configured }));
    assert.deepEqual(result.summaries[0]?.commands, ['./.opencode/plugin/harnesstrim.ts']);
    assert.deepEqual(result.summaries[0]?.interceptionPoints, ['tool-execute-after']);
  });

  it('states the config-only tier and never claims a receipt for an adopted wrapper', async () => {
    const result = await opencodeAdapter.verify(context({ [USER_CONFIG]: configured }));
    assert.equal(result.declaredTier, 'config-only');
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
  });

  it('reports malformed JSONC as broken', async () => {
    const result = await opencodeAdapter.detect(context({ [USER_CONFIG]: '{ plugin: }' }));
    assert.equal(result.state, 'broken');
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ['harness-config-unreadable'],
    );
  });
});
