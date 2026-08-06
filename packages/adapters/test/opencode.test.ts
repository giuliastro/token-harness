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
    /**
     * Both points, because a plugin is a module and which hooks it returns is decided when it runs.
     * RTK takes `tool.execute.before` and HarnessTrim takes `tool.execute.after`, neither declares
     * it anywhere readable, and narrowing this to one would hide a real conflict whenever the guess
     * is wrong. Spike 9.1.
     */
    assert.deepEqual(result.summaries[0]?.interceptionPoints, [
      'tool-execute-before',
      'tool-execute-after',
    ]);
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

describe('the tested version range', () => {
  it('is the version that was actually observed', () => {
    /**
     * This read `1.0.0`–`1.0.0`, a round number nobody ran. The OpenCode on the machine this was
     * reviewed against is `1.18.9`, so every real user got `unknown-newer` — which `doctor` counts
     * as a problem — and every real machine exited 3.
     *
     * RFC 0006 §Exit codes: "A supported configuration must be able to exit 0. A declared
     * limitation is not a problem, and reporting it as one is the fastest way to teach users to
     * ignore the exit code."
     *
     * A range now rather than a point: spike 9.1 observed the CLI at `1.18.11` and Desktop at
     * `1.18.14`, both loading plugins from the same directories. Still only versions that were
     * actually run — the ends are two of the three observations, not a semver span.
     */
    assert.deepEqual(opencodeAdapter.manifest.testedVersions, {
      minimum: '1.18.9',
      maximum: '1.18.14',
    });
  });
});
