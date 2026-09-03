/**
 * The real process runner — RFC 0004 §Process policy, PLAN §2.2 acceptance.
 *
 * "Timeout and redaction tests pass on Windows and POSIX" and "provider unit tests
 * require no installed upstream executable."
 *
 * Every child here is the Node binary already running the test, driven with `-e`.
 * Nothing third-party is installed, and the same script runs on all three
 * platforms.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import type { ExecutableKind, PlatformFacts, ResolvedExecutable } from '@token-harness/core';

import { NodeProcessRunner } from '../src/index.js';

const NATIVE_WINDOWS = process.platform === 'win32';

const FACTS: PlatformFacts = {
  os: NATIVE_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const WINDOWS_FACTS: PlatformFacts = { ...FACTS, os: 'windows', isWsl: false };

let sandbox = '';

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-runner-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Resolves the single name `node` to the binary running this test. */
function nodeResolver(name: string): ResolvedExecutable | null {
  if (name !== 'node') return null;
  return { requested: name, path: process.execPath, kind: 'native' };
}

function fixedResolver(path: string, kind: ExecutableKind) {
  return (name: string): ResolvedExecutable | null => ({ requested: name, path, kind });
}

function runner(overrides: Partial<ConstructorParameters<typeof NodeProcessRunner>[0]> = {}) {
  return new NodeProcessRunner({
    facts: FACTS,
    env: process.env,
    resolve: nodeResolver,
    ...overrides,
  });
}

describe('invocation', () => {
  it('captures stdout and reports a clean exit', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write("hello")'],
      cwd: sandbox,
    });
    assert.equal(outcome.failure, null);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stdout, 'hello');
    assert.equal(outcome.interpreter, 'direct');
    assert.equal(outcome.executablePath, process.execPath);
  });

  it('treats a non-zero exit as data, not as a failure', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.exit(3)'],
      cwd: sandbox,
    });
    // `doctor` reads non-zero exits constantly. A runner that threw on them would
    // make every detection path an exception handler.
    assert.equal(outcome.failure, null);
    assert.equal(outcome.exitCode, 3);
  });

  it('keeps stdout and stderr separate', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write("out");process.stderr.write("err")'],
      cwd: sandbox,
    });
    assert.equal(outcome.stdout, 'out');
    assert.equal(outcome.stderr, 'err');
  });

  it('uses the working directory it was given', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: sandbox,
    });
    // macOS reports /private/var for /var, so compare the tail.
    assert.ok(outcome.stdout.endsWith(sandbox.split(/[\\/]/).pop() ?? ''), outcome.stdout);
  });

  it('reports an executable it could not resolve', async () => {
    const outcome = await runner().run({
      executable: 'definitely-not-installed',
      args: [],
      cwd: sandbox,
    });
    assert.equal(outcome.failure?.reason, 'executable-not-found');
    assert.equal(outcome.executablePath, null);
  });

  it('refuses a POSIX text file with no shebang instead of letting execve report it', async () => {
    const script = join(sandbox, 'no-shebang');
    writeFileSync(script, 'echo hello\n');
    const outcome = await runner({
      resolve: fixedResolver(script, 'posix-script-without-shebang'),
    }).run({ executable: 'broken', args: [], cwd: sandbox });
    assert.equal(outcome.failure?.reason, 'executable-not-startable');
    assert.match(outcome.failure?.message ?? '', /#!/);
  });

  it('refuses a PATHEXT extension it will not launch', async () => {
    const outcome = await runner({
      resolve: fixedResolver('C:\\tools\\thing.ps1', 'windows-unsupported-extension'),
    }).run({ executable: 'thing', args: [], cwd: sandbox });
    assert.equal(outcome.failure?.reason, 'executable-not-startable');
  });
});

describe('no shell, ever', () => {
  it('delivers shell metacharacters to the child as literal text', async () => {
    const hostile = ['a & b', '$(echo pwned)', '`echo pwned`', '%PATH%', 'x | y', '> out.txt'];
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(process.argv.slice(1).join("\\u0000"))', ...hostile],
      cwd: sandbox,
    });
    assert.equal(outcome.failure, null);
    assert.deepEqual(outcome.stdout.split('\u0000'), hostile);
  });

  it('refuses an argument that cannot survive the Windows command interpreter', async () => {
    // A batch shim is the one case that must go through cmd.exe. The refusal happens
    // before anything is spawned, so this asserts the safety property on every
    // platform rather than only on Windows.
    const outcome = await new NodeProcessRunner({
      facts: WINDOWS_FACTS,
      env: { SystemRoot: 'C:\\Windows', PATH: process.env['PATH'] },
      resolve: fixedResolver('C:\\npm\\pnpm.cmd', 'windows-batch-shim'),
    }).run({ executable: 'pnpm', args: ['add', 'pkg@%VERSION%'], cwd: sandbox });
    assert.equal(outcome.failure?.reason, 'unsafe-argument');
    assert.equal(outcome.interpreter, 'windows-command-interpreter');
    assert.match(outcome.failure?.message ?? '', /percent sign/);
  });
});

describe('bounded output', () => {
  it('truncates each stream at the byte cap and says so', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        'process.stdout.write("o".repeat(50000));process.stderr.write("e".repeat(50000))',
      ],
      cwd: sandbox,
      maxOutputBytes: 1024,
    });
    assert.equal(outcome.stdout.length, 1024);
    assert.equal(outcome.stderr.length, 1024);
    assert.equal(outcome.stdoutTruncated, true);
    assert.equal(outcome.stderrTruncated, true);
  });

  it('does not flag truncation when the output fits', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write("short")'],
      cwd: sandbox,
      maxOutputBytes: 1024,
    });
    assert.equal(outcome.stdoutTruncated, false);
  });

  it('keeps draining a stream past the cap, so a chatty child finishes instead of blocking', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        'for (let i = 0; i < 2000; i += 1) process.stdout.write("x".repeat(1000));process.exit(0)',
      ],
      cwd: sandbox,
      maxOutputBytes: 512,
      timeoutMs: 20_000,
    });
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stdout.length, 512);
  });
});

describe('timeouts', () => {
  it('terminates a child that overruns and reports the timeout', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      cwd: sandbox,
      timeoutMs: 500,
    });
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.failure?.reason, 'timed-out');
  });

  /**
   * The child holds no pipe of its own: a grandchild inherits stdout. Killing only
   * the child would leave that pipe open and the promise would never settle, so this
   * test resolving at all is the assertion that the whole tree was terminated.
   */
  it('terminates the process tree, not just the child', { timeout: 30_000 }, async () => {
    const grandchild =
      'require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:"inherit"});setTimeout(()=>{},60000)';
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', grandchild],
      cwd: sandbox,
      timeoutMs: 1_000,
    });
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.failure?.reason, 'timed-out');
  });

  it('keeps whatever the child produced before it was stopped', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write("partial");setTimeout(() => {}, 60000)'],
      cwd: sandbox,
      timeoutMs: 800,
    });
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.stdout, 'partial');
  });
});

describe('environment', () => {
  it('does not hand a secret-named variable to the child', async () => {
    const outcome = await new NodeProcessRunner({
      facts: FACTS,
      env: { ...process.env, GITHUB_TOKEN: 'ghp_deadbeefdeadbeef' },
      resolve: nodeResolver,
    }).run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(String(process.env.GITHUB_TOKEN))'],
      cwd: sandbox,
    });
    assert.equal(outcome.stdout, 'undefined');
  });

  it('passes the variables a child actually needs', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(process.env.PATH ? "has-path" : "no-path")'],
      cwd: sandbox,
    });
    assert.equal(outcome.stdout, 'has-path');
  });

  it('sets NO_COLOR so captured output stays parseable', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(String(process.env.NO_COLOR))'],
      cwd: sandbox,
    });
    assert.equal(outcome.stdout, '1');
  });

  it('delivers a requested addition', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(String(process.env.TH_MARKER))'],
      cwd: sandbox,
      env: { TH_MARKER: 'present' },
    });
    assert.equal(outcome.stdout, 'present');
  });
});

describe('stdin', () => {
  it('closes stdin so a child that prompts exits instead of hanging', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        'let d="";process.stdin.on("data",c=>{d+=c});process.stdin.on("end",()=>process.stdout.write(`[${d}]`))',
      ],
      cwd: sandbox,
      timeoutMs: 5_000,
    });
    assert.equal(outcome.stdout, '[]');
    assert.equal(outcome.timedOut, false);
  });

  it('delivers content when there is content to deliver', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        'let d="";process.stdin.on("data",c=>{d+=c});process.stdin.on("end",()=>process.stdout.write(d.toUpperCase()))',
      ],
      cwd: sandbox,
      stdin: 'payload',
    });
    assert.equal(outcome.stdout, 'PAYLOAD');
  });

  it('can hold stdin open until a complete stdout response line arrives', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        [
          'let input=""',
          'let replied=false',
          'process.stdin.on("data",chunk=>{',
          '  input+=chunk',
          '  if (!replied && input.includes("request")) {',
          '    replied=true',
          '    setTimeout(()=>process.stdout.write(JSON.stringify({id:"th-response"})+"\\n"),50)',
          '  }',
          '})',
          'process.stdin.on("end",()=>process.exit(0))',
        ].join(';'),
      ],
      cwd: sandbox,
      stdin: 'request\n',
      stdinCloseAfterStdoutLineIncludes: 'th-response',
      timeoutMs: 5_000,
    });
    assert.equal(outcome.failure, null);
    assert.equal(outcome.timedOut, false);
    assert.match(outcome.stdout, /"id":"th-response"/);
  });

  it('waits for every requested stdout marker before closing stdin', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: [
        '-e',
        [
          'let input=""',
          'let started=false',
          'process.stdin.on("data",chunk=>{',
          '  input+=chunk',
          '  if (!started && input.includes("request")) {',
          '    started=true',
          '    setTimeout(()=>process.stdout.write("second\\n"),10)',
          '    setTimeout(()=>process.stdout.write("first\\n"),30)',
          '    setTimeout(()=>process.stdout.write("third\\n"),50)',
          '  }',
          '})',
          'process.stdin.on("end",()=>process.exit(0))',
        ].join(';'),
      ],
      cwd: sandbox,
      stdin: 'request\n',
      stdinCloseAfterStdoutLineIncludesAll: ['first', 'second', 'third'],
      timeoutMs: 5_000,
    });
    assert.equal(outcome.failure, null);
    assert.equal(outcome.timedOut, false);
    assert.match(outcome.stdout, /first/);
    assert.match(outcome.stdout, /second/);
    assert.match(outcome.stdout, /third/);
  });
});

describe('redaction', () => {
  it('strips a declared secret from the displayed command and from both streams', async () => {
    const secret = 'ghp_deadbeefdeadbeef';
    const outcome = await runner().run({
      executable: 'node',
      // The secret is a positional argument rather than the value of a `--token`
      // flag: `node -e` rejects an unknown option before the script ever runs, and
      // flag-shaped redaction is covered by the unit tests in `core`.
      args: ['-e', `process.stdout.write("${secret}");process.stderr.write("${secret}")`, secret],
      cwd: sandbox,
      secretValues: [secret],
    });
    assert.ok(!outcome.displayCommand.includes(secret), outcome.displayCommand);
    assert.ok(!outcome.stdout.includes(secret), outcome.stdout);
    assert.ok(!outcome.stderr.includes(secret), outcome.stderr);
    assert.match(outcome.stdout, /\[redacted\]/);
  });

  it('strips the value of a secret-named variable the caller passed in', async () => {
    const outcome = await runner().run({
      executable: 'node',
      args: ['-e', 'process.stdout.write(String(process.env.NPM_TOKEN))'],
      cwd: sandbox,
      env: { NPM_TOKEN: 'npm_abcdefghijkl' },
    });
    // The child does receive it — it was requested — but nothing it echoes back
    // reaches a log or a diagnostic in the clear.
    assert.equal(outcome.stdout, '[redacted]');
  });

  it('writes only redacted lines to the log', async () => {
    const lines: string[] = [];
    const secret = 'ghp_deadbeefdeadbeef';
    await runner({ log: (line) => lines.push(line) }).run({
      executable: 'node',
      args: ['-e', 'process.exit(0)', secret],
      cwd: sandbox,
      secretValues: [secret],
    });
    assert.ok(lines.length > 0);
    assert.ok(
      lines.every((line) => !line.includes(secret)),
      lines.join('\n'),
    );
    assert.match(lines.join('\n'), /^run {3}/m);
    assert.match(lines.join('\n'), /exit 0 in \d+ms/);
  });
});

describe('Windows batch shims', () => {
  it(
    'runs a .cmd shim through the command interpreter and records that it did',
    { skip: NATIVE_WINDOWS ? false : 'native Windows only' },
    async () => {
      const shim = join(sandbox, 'shim.cmd');
      writeFileSync(shim, '@echo off\r\necho ARG=%1\r\n');
      const outcome = await runner({ resolve: fixedResolver(shim, 'windows-batch-shim') }).run({
        executable: 'shim',
        args: ['value with spaces'],
        cwd: sandbox,
      });
      assert.equal(outcome.failure, null, outcome.failure?.message);
      assert.equal(outcome.interpreter, 'windows-command-interpreter');
      assert.match(outcome.stdout, /ARG="value with spaces"/);
    },
  );

  /**
   * The end-to-end shape that matters: an npm-generated shim forwards `%*` to the
   * program behind it, which parses the command line with `CommandLineToArgvW`.
   * This asserts the round trip through both layers, including the trailing
   * backslash that would otherwise escape the closing quote and swallow the rest of
   * the command line.
   */
  it(
    'round-trips arguments through a shim to the program behind it',
    { skip: NATIVE_WINDOWS ? false : 'native Windows only' },
    async () => {
      const printer = join(sandbox, 'print-args.js');
      writeFileSync(printer, 'process.stdout.write(process.argv.slice(2).join("\\u0000"))\n');
      const shim = join(sandbox, 'forwarding.cmd');
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${printer}" %*\r\n`);

      const args = ['C:\\dir\\', 'value with spaces', 'a & b', 'plain'];
      const outcome = await runner({ resolve: fixedResolver(shim, 'windows-batch-shim') }).run({
        executable: 'forwarding',
        args,
        cwd: sandbox,
      });
      assert.equal(outcome.failure, null, outcome.failure?.message);
      assert.equal(outcome.interpreter, 'windows-command-interpreter');
      assert.deepEqual(outcome.stdout.split('\u0000'), args);
    },
  );
});
