import assert from 'node:assert/strict';
import { it } from 'node:test';
import { commandResult } from '@token-harness/core';
import { run, DEFAULT_COMMANDS, type RunOptions } from '../src/run.js';

it('refuses a contending mutation before dispatch and preserves a single JSON envelope', async () => {
  let mutations = 0,
    guards = 0,
    stdout = '',
    stderr = '';
  const options: RunOptions = {
    platform: {
      os: 'linux',
      osDisplayName: 'fixture',
      arch: 'x64',
      nodeVersion: '22.13.0',
      isWsl: false,
    },
    cwd: '/project',
    home: '/home',
    stateRoot: '/state',
    argv: ['apply', '--yes', '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
    mutationGuard: {
      async run() {
        guards++;
        return { acquired: false, exitCode: 5, diagnostics: [] };
      },
    },
    commands: {
      ...DEFAULT_COMMANDS,
      apply: async () => {
        mutations++;
        return commandResult({ command: 'apply', exitCode: 0, data: null });
      },
      verify: async () => commandResult({ command: 'verify', exitCode: 0, data: null }),
    },
  };
  assert.equal(await run(options), 5);
  assert.equal(mutations, 0);
  assert.equal(guards, 1);
  assert.equal(JSON.parse(stdout).exitCode, 5);
  assert.equal(stderr, '');
  stdout = '';
  options.argv = ['verify', '--json'];
  assert.equal(await run(options), 0);
  assert.equal(guards, 1);
  assert.equal(JSON.parse(stdout).command, 'verify');
});
