import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';

import { attributeRtkHookResponse, runRtkHookProxy } from '../src/commands/rtk-hook-proxy.js';

const codex = harnessId('codex');

function outcome(stdout: string, exitCode = 0): ProcessOutcome {
  return {
    displayCommand: 'rtk hook codex',
    interpreter: 'direct',
    executablePath: '/usr/bin/rtk',
    exitCode,
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

function codexResponse(command: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { command },
    },
  });
}

describe('RTK hook attribution', () => {
  it('adds the harness-specific database path to a Bash rewrite', () => {
    const result = attributeRtkHookResponse(
      codexResponse('rtk git status'),
      JSON.stringify({ tool_name: 'Bash' }),
      '/home/giulio/data/rtk-codex.db',
      codex,
    );

    assert.equal(
      JSON.parse(result).hookSpecificOutput.updatedInput.command,
      "RTK_DB_PATH='/home/giulio/data/rtk-codex.db' rtk git status",
    );
  });

  it('shell-quotes a Bash database path containing an apostrophe', () => {
    const result = attributeRtkHookResponse(
      codexResponse('rtk git status'),
      JSON.stringify({ tool_name: 'Bash' }),
      "/home/giulio/data O'Connor/rtk-codex.db",
      codex,
    );

    assert.equal(
      JSON.parse(result).hookSpecificOutput.updatedInput.command,
      "RTK_DB_PATH='/home/giulio/data O" + "'\"'\"'" + "Connor/rtk-codex.db' rtk git status",
    );
  });

  it('uses PowerShell quoting for Claude Code PowerShell tools', () => {
    const result = attributeRtkHookResponse(
      codexResponse('rtk git status'),
      JSON.stringify({ tool_name: 'PowerShell' }),
      "C:\\Users\\O'Connor\\Token Harness\\rtk-claude.db",
      harnessId('claude'),
    );

    assert.equal(
      JSON.parse(result).hookSpecificOutput.updatedInput.command,
      "$env:RTK_DB_PATH = 'C:\\Users\\O''Connor\\Token Harness\\rtk-claude.db'; rtk git status",
    );
  });

  it('leaves non-rewrites and unrecognised tool families unchanged', () => {
    assert.equal(attributeRtkHookResponse('', '{}', '/tmp/rtk.db', codex), '');
    assert.equal(
      attributeRtkHookResponse(
        codexResponse('rtk git status'),
        JSON.stringify({ tool_name: 'Browser' }),
        '/tmp/rtk.db',
        codex,
      ),
      codexResponse('rtk git status'),
    );
    assert.equal(
      attributeRtkHookResponse(
        codexResponse('git status'),
        JSON.stringify({ tool_name: 'Bash' }),
        '/tmp/rtk.db',
        codex,
      ),
      codexResponse('git status'),
    );
  });

  it('sets RTK_DB_PATH for the native hook and passes the hook protocol through', async () => {
    let seenRequest: ProcessRequest | undefined;
    const runner: ProcessRunner = {
      run: async (value) => {
        seenRequest = value;
        return outcome(codexResponse('rtk git status'));
      },
    };
    const result = await runRtkHookProxy({
      runner,
      cwd: '/workspace',
      harness: codex,
      databasePath: '/private/token-harness/rtk-codex.db',
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }),
    });

    assert.ok(seenRequest);
    assert.equal(seenRequest.executable, 'rtk');
    assert.deepEqual(seenRequest.args, ['hook', 'codex']);
    assert.equal(seenRequest.cwd, '/workspace');
    assert.deepEqual(seenRequest.env, { RTK_DB_PATH: '/private/token-harness/rtk-codex.db' });
    assert.match(
      result.stdout,
      /RTK_DB_PATH='\/private\/token-harness\/rtk-codex\.db' rtk git status/,
    );
  });

  it('fails open when the RTK process is unavailable', async () => {
    const runner: ProcessRunner = {
      run: async () => ({
        ...outcome('', 127),
        failure: { reason: 'executable-not-found', message: 'missing' },
      }),
    };
    const result = await runRtkHookProxy({
      runner,
      cwd: '/workspace',
      harness: codex,
      databasePath: '/private/token-harness/rtk-codex.db',
      stdin: '{}',
    });

    assert.equal(result.stdout, '');
    assert.match(result.stderr, /RTK's codex hook did not run/);
  });
});
