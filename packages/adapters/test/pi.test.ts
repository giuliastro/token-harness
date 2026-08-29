import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, PlatformFacts, ProcessOutcome, ProcessRequest } from '@token-harness/core';
import { piAdapter } from '../src/index.js';
import type { HarnessContext } from '../src/harnesses/contract.js';

const HOME = '/home/test';
const PROJECT = '/tmp/project';
const USER_EXTENSION = `${HOME}/.pi/agent/extensions/harnesstrim/index.ts`;
const PROJECT_EXTENSION = `${PROJECT}/.pi/extensions/harnesstrim/index.ts`;

/** The module's own header, enough for the harnesstrim marker check. */
const EXTENSION = `// HarnessTrim Pi extension — slims noisy tool output via the \`tool_result\` hook.\n`;

function context(extensions: Record<string, string> = {}): HarnessContext {
  const files: Record<string, string> = { ...extensions };
  const run = (request: ProcessRequest): Promise<ProcessOutcome> => {
    return Promise.resolve({
      displayCommand: `${request.executable} ${request.args.join(' ')}`,
      interpreter: 'direct',
      executablePath: '/usr/bin/pi',
      exitCode: 0,
      signal: null,
      stdout: '0.83.0\n',
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

describe('Pi harness adapter', () => {
  it('detects an installed HarnessTrim extension on Linux', async () => {
    const result = await piAdapter.detect(context({ [USER_EXTENSION]: EXTENSION }));
    assert.equal(result.harnessId, 'pi');
    assert.equal(result.state, 'configured');
    assert.equal(result.version, '0.83.0');
    assert.equal(result.versionVerdict, 'in-range');
    assert.equal(result.configPath, USER_EXTENSION);
  });

  it('detects the project-scope extension and still reports configured', async () => {
    const result = await piAdapter.detect(context({ [PROJECT_EXTENSION]: EXTENSION }));
    assert.equal(result.state, 'configured');
    assert.equal(result.configPath, PROJECT_EXTENSION);
  });

  it('reports absent when Pi cannot be run and no extension is installed', async () => {
    const runner = {
      run: (request: ProcessRequest): Promise<ProcessOutcome> =>
        Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: null,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: 'pi: command not found',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: { reason: 'executable-not-found', message: 'pi: command not found' },
        }),
    };
    const result = await piAdapter.detect({ ...context(), runner });
    assert.equal(result.state, 'absent');
    assert.equal(result.version, null);
  });

  it('verifies the extension without claiming a receipt or an observable mode', async () => {
    const result = await piAdapter.verify(context({ [USER_EXTENSION]: EXTENSION }));
    assert.equal(result.achievedTier, 'config-only');
    assert.equal(result.checks.find((check) => check.id === 'module-installed')?.status, 'pass');
    assert.equal(
      result.checks.find((check) => check.id === 'canary-intercepted')?.status,
      'not-exercised',
    );
    assert.equal(result.checks.find((check) => check.id === 'mode-unreadable')?.status, 'info');
  });
});
