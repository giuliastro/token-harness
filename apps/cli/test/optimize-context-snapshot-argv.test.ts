import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandResult, type PlatformFacts } from '@token-harness/core';

import { DEFAULT_COMMANDS, run } from '../src/run.js';
import type { CommandContext } from '../src/commands/context.js';

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '24.13.0',
  isWsl: false,
};

describe('optimize context snapshot CLI flow', () => {
  it('passes --context-snapshot through argument parsing and dispatch', async () => {
    const receivedContexts: CommandContext[] = [];
    let stdout = '';
    let stderr = '';

    const exitCode = await run({
      argv: ['optimize', '--context-snapshot', './governor.json', '--json'],
      platform: LINUX,
      cwd: '/tmp/token-harness-project',
      home: '/tmp/token-harness-home',
      stateRoot: '/tmp/token-harness-home/.local/state/token-harness',
      streams: {
        out: (text) => {
          stdout += text;
        },
        err: (text) => {
          stderr += text;
        },
      },
      commands: {
        ...DEFAULT_COMMANDS,
        optimize: async (context) => {
          receivedContexts.push(context);
          return commandResult({ command: 'optimize', exitCode: 0 });
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(receivedContexts[0]?.contextSnapshotPath, './governor.json');
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).command, 'optimize');
  });
});
