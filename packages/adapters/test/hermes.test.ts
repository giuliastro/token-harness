import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, PlatformFacts, ProcessOutcome, ProcessRequest } from '@token-harness/core';
import { hermesAdapter } from '../src/index.js';
import type { HarnessContext } from '../src/harnesses/contract.js';

const HOME = '/home/test';
const PROJECT = '/tmp/project';
const PLUGIN = `${HOME}/.hermes/plugins/harnesstrim/plugin.yaml`;

function context(): HarnessContext {
  const files: Record<string, string> = { [PLUGIN]: 'name: harnesstrim\n' };
  const run = (request: ProcessRequest): Promise<ProcessOutcome> => {
    const plugins = request.args.includes('plugins');
    return Promise.resolve({
      displayCommand: `${request.executable} ${request.args.join(' ')}`,
      interpreter: 'direct',
      executablePath: '/usr/bin/hermes',
      exitCode: 0,
      signal: null,
      stdout: plugins ? 'harnesstrim enabled 0.1.0\n' : 'Hermes Agent 0.1.0\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 1,
      timedOut: false,
      failure: null,
    });
  };
  return {
    fs: {
      join: (...parts) => parts.join('/'),
      dirname: (path) => path.slice(0, path.lastIndexOf('/')),
      basename: (path) => path.slice(path.lastIndexOf('/') + 1),
      isInside: (candidate, parent) => candidate.startsWith(parent),
      stat: (path): Promise<FileStat | null> =>
        Promise.resolve(
          Object.hasOwn(files, path)
            ? { kind: 'file', byteLength: files[path]?.length ?? 0, mode: null }
            : null,
        ),
      readFile: (path) => Promise.resolve(new TextEncoder().encode(files[path] ?? '')),
      writeFile: () => Promise.reject(new Error('read-only test port')),
      appendFile: () => Promise.reject(new Error('read-only test port')),
      createDirectory: () => Promise.reject(new Error('read-only test port')),
      remove: () => Promise.reject(new Error('read-only test port')),
      readDirectory: () => Promise.resolve([]),
    },
    runner: { run },
    facts: {
      os: 'linux',
      osDisplayName: 'Linux',
      arch: 'x64',
      nodeVersion: '24.13.0',
      isWsl: false,
    } satisfies PlatformFacts,
    paths: {
      home: HOME,
      config: `${HOME}/.config`,
      data: `${HOME}/.local/share`,
      state: `${HOME}/.local/state`,
      cache: `${HOME}/.cache`,
    },
    projectRoot: PROJECT,
  };
}

describe('Hermes harness adapter', () => {
  it('detects an enabled HarnessTrim plugin on Linux', async () => {
    const result = await hermesAdapter.detect(context());
    assert.equal(result.harnessId, 'hermes');
    assert.equal(result.state, 'configured');
    assert.equal(result.version, '0.1.0');
    assert.equal(result.versionVerdict, 'in-range');
  });

  it('verifies plugin installation and enablement without claiming a canary', async () => {
    const result = await hermesAdapter.verify(context());
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(result.checks.find((check) => check.id === 'plugin-installed')?.status, 'pass');
    assert.equal(result.checks.find((check) => check.id === 'plugin-enabled')?.status, 'pass');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
  });
});
