import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  FileStat,
  PlatformFacts,
  ProcessOutcome,
  ProcessRequest,
  ProcessRunner,
} from '@token-harness/core';

import { codexAdapter, type HarnessContext } from '../src/index.js';

const HOME = '/home/dev';
const PROJECT = `${HOME}/project`;
const HOOKS = `${HOME}/.codex/hooks.json`;
const CONFIG = `${HOME}/.codex/config.toml`;
const FACTS: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function context(
  files: Record<string, string> = {},
  version: string | null = '0.146.0',
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
        executablePath: version === null ? null : '/usr/local/bin/codex',
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
    facts: FACTS,
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

const DECLARED = JSON.stringify({
  hooks: {
    PostToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'rtk hook codex' }] }],
  },
});

describe('Codex adapter', () => {
  it('detects a declared hook only with executable corroboration', async () => {
    assert.equal(
      (await codexAdapter.detect(context({ [HOOKS]: DECLARED, [CONFIG]: '[projects]\n' }))).state,
      'configured',
    );
    assert.equal(
      (await codexAdapter.detect(context({ [HOOKS]: DECLARED }, null))).state,
      'detected',
    );
  });

  it('reads the separate hooks file and exposes its command without interpreting ownership', async () => {
    const inspection = await codexAdapter.inspect(context({ [HOOKS]: DECLARED }));
    assert.deepEqual(inspection.summaries[0]?.commands, ['rtk hook codex']);
    assert.equal(inspection.enabled, null);
  });

  it('does not convert a declared hook into an enabled hook', async () => {
    const result = await codexAdapter.verify(context({ [HOOKS]: DECLARED }));
    assert.equal(result.declaredTier, 'config-only');
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(result.checks.find((check) => check.id === 'hook-enablement')?.status, 'info');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
  });

  it('reports unreadable hooks as broken rather than guessing', async () => {
    const result = await codexAdapter.detect(context({ [HOOKS]: '{ hooks: }' }));
    assert.equal(result.state, 'broken');
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ['harness-config-unreadable'],
    );
  });
});
