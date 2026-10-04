import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import {
  harnessId,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeProcessRunner } from '@token-harness/platform';

import {
  attributeRtkHookResponse,
  runAttributedRtkCommand,
  runRtkHookProxy,
} from '../src/commands/rtk-hook-proxy.js';

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
  it('starts the pinned program with a PATH containing Node alone, preserving shell-sensitive paths', async () => {
    const sandbox = await mkdtemp(join(resolve(tmpdir()), 'th-rtk-bootstrap-'));
    try {
      const entryScript = join(sandbox, "O'Connor $` à.mjs");
      const rtkExecutable = join(sandbox, "O'Connor $` à rtk.exe");
      await writeFile(entryScript, 'console.log(JSON.stringify(process.argv.slice(1)));');
      const command = JSON.parse(
        attributeRtkHookResponse(
          codexResponse('rtk git status --short'),
          '{}',
          'db',
          codex,
          'windows',
          {
            entryScript,
            rtkExecutable,
          },
        ),
      ).hookSpecificOutput.updatedInput.command as string;
      const script = /^node\.exe --eval "([^"]+)" -- git status --short$/.exec(command)?.[1];
      assert.ok(script);
      const windows = process.platform === 'win32';
      const shell = join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const runner = new NodeProcessRunner({
        facts: {
          os: windows ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
          osDisplayName: 'test',
          arch: 'x64',
          nodeVersion: process.versions.node,
          isWsl: false,
        },
        env: {
          PATH: dirname(process.execPath),
          PATHEXT: '.EXE',
          SystemRoot: process.env['SystemRoot'],
        },
        resolve: (name) => ({
          requested: name,
          path: windows ? shell : process.execPath,
          kind: 'native',
        }),
      });
      const result = await runner.run({
        executable: windows ? 'powershell' : 'node',
        args: windows
          ? ['-NoProfile', '-NonInteractive', '-Command', command]
          : ['--eval', script, '--', 'git', 'status', '--short'],
        cwd: sandbox,
      });
      assert.equal(result.failure, null);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.trim(), JSON.stringify(result));
      assert.deepEqual(JSON.parse(result.stdout), [
        entryScript,
        '__internal-rtk-run',
        'codex',
        '--rtk-executable',
        rtkExecutable,
        'git',
        'status',
        '--short',
      ]);
    } finally {
      assert.equal(
        dirname(sandbox),
        resolve(tmpdir()),
        'cleanup stays in the allocated temp directory',
      );
      await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  it('uses a shell-independent Windows launcher when Codex labels PowerShell as Bash', async () => {
    const result = attributeRtkHookResponse(
      codexResponse('rtk git status --short'),
      JSON.stringify({ tool_name: 'Bash' }),
      "C:\\Users\\O'Connor\\Token Harness\\rtk-codex.db",
      codex,
      'windows',
      {
        entryScript: "C:\\Users\\O'Connor $`\\Token Harness\\token-harness.mjs",
        rtkExecutable: "C:\\Users\\O'Connor $`\\RTK\\rtk.exe",
      },
    );
    const command = JSON.parse(result).hookSpecificOutput.updatedInput.command as string;
    assert.match(command, /^node\.exe --eval "[^"$`]+" -- git status --short$/);
    const encoded = /Buffer.from\('([^']+)'/.exec(command)?.[1];
    assert.ok(encoded);
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), {
      entryScript: "C:\\Users\\O'Connor $`\\Token Harness\\token-harness.mjs",
      rtkExecutable: "C:\\Users\\O'Connor $`\\RTK\\rtk.exe",
    });
    let seen!: ProcessRequest;
    await runAttributedRtkCommand({
      runner: {
        run: async (request) => {
          seen = request;
          return outcome('actual output');
        },
      },
      cwd: 'C:\\work',
      databasePath: "C:\\Users\\O'Connor\\Token Harness\\rtk-codex.db",
      args: ['git', 'status', '--short'],
      executable: 'C:\\RTK\\rtk.exe',
    });
    assert.equal(seen.executable, 'C:\\RTK\\rtk.exe');
    assert.deepEqual(seen.args, ['git', 'status', '--short']);
    assert.equal(seen.env?.['RTK_DB_PATH'], "C:\\Users\\O'Connor\\Token Harness\\rtk-codex.db");
    assert.equal(seen.timeoutMs, 0, 'the wrapper must not shorten the native tool timeout');
  });
  it('retains POSIX/WSL assignments and leaves unknown Windows rewrites unchanged', () => {
    assert.match(
      attributeRtkHookResponse(
        codexResponse('rtk git status'),
        '{}',
        '/data/rtk.db',
        codex,
        'linux',
      ),
      /RTK_DB_PATH=/,
    );
    const unrelated = codexResponse('other-tool git status');
    assert.equal(
      attributeRtkHookResponse(unrelated, '{}', 'C:\\data\\rtk.db', codex, 'windows'),
      unrelated,
    );
  });
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
