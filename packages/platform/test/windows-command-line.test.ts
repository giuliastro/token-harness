/**
 * Windows command-interpreter quoting — the resolution of the `.cmd`-shim versus
 * no-shell-interpolation conflict between RFC 0004 §Process policy and RFC 0002
 * §Process abstraction.
 *
 * The argument quoting is the dangerous part, so it gets a table. Every case runs
 * on every platform, because the function is pure string work.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCommandInterpreterCommandLine,
  quoteForCommandInterpreter,
  resolveCommandInterpreter,
} from '../src/index.js';

describe('argument quoting', () => {
  const accepted: ReadonlyArray<readonly [string, string, string]> = [
    ['a plain word', 'install', '"install"'],
    ['a flag', '--frozen-lockfile', '"--frozen-lockfile"'],
    ['a path with spaces', 'C:\\Program Files\\rtk', '"C:\\Program Files\\rtk"'],
    ['an empty argument', '', '""'],
    ['a command separator, made inert by the quotes', 'a&b', '"a&b"'],
    ['a pipe', 'a|b', '"a|b"'],
    ['a redirection', 'a>b', '"a>b"'],
    ['a caret', 'a^b', '"a^b"'],
    ['parentheses', '(a)', '"(a)"'],
    ['a package specifier', 'rtk@1.4.2', '"rtk@1.4.2"'],
    // A trailing backslash before the closing quote would escape it, and the
    // argument would swallow the rest of the command line.
    ['a trailing separator', 'C:\\dir\\', '"C:\\dir\\\\"'],
    ['two trailing separators', 'C:\\dir\\\\', '"C:\\dir\\\\\\\\"'],
    ['an interior separator run', 'C:\\a\\\\b', '"C:\\a\\\\b"'],
  ];

  for (const [name, input, expected] of accepted) {
    it(`quotes ${name}`, () => {
      const result = quoteForCommandInterpreter(input);
      assert.ok(result.ok, `expected ${JSON.stringify(input)} to be quotable`);
      assert.equal(result.text, expected);
    });
  }

  const refused: ReadonlyArray<readonly [string, string]> = [
    ['a percent sign, expanded before any escaping applies', '%PATH%'],
    ['a bare percent sign', '50%'],
    ['an exclamation mark, expanded under delayed expansion', 'hello!'],
    ['a double quote, re-parsed by the batch file itself', 'say "hi"'],
    ['a line break', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['a NUL byte', 'a\0b'],
  ];

  for (const [name, input] of refused) {
    it(`refuses ${name} rather than pretending to escape it`, () => {
      const result = quoteForCommandInterpreter(input);
      assert.equal(result.ok, false, `expected ${JSON.stringify(input)} to be refused`);
      if (result.ok) return;
      assert.match(result.reason, /contains /);
    });
  }
});

describe('the full invocation', () => {
  it('wraps the line in the extra quote pair that /s strips', () => {
    const built = buildCommandInterpreterCommandLine(
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd',
      ['add', '--global', 'rtk@1.4.2'],
    );
    assert.ok(built.ok);
    assert.deepEqual(built.invocation.args, [
      '/d',
      '/s',
      '/v:off',
      '/c',
      '""C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd" "add" "--global" "rtk@1.4.2""',
    ]);
  });

  it('passes /d, so the AutoRun registry command does not execute first', () => {
    const built = buildCommandInterpreterCommandLine('cmd.exe', 'x.cmd', []);
    assert.ok(built.ok);
    assert.equal(built.invocation.args[0], '/d');
  });

  it('names the offending argument when one cannot be delivered', () => {
    const built = buildCommandInterpreterCommandLine('cmd.exe', 'pnpm.cmd', [
      'add',
      'pkg@%VERSION%',
    ]);
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.argument, 'pkg@%VERSION%');
    assert.match(built.reason, /percent sign/);
  });

  it('refuses an executable path that cannot be quoted, not only an argument', () => {
    const built = buildCommandInterpreterCommandLine('cmd.exe', 'C:\\100%\\pnpm.cmd', []);
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.argument, 'C:\\100%\\pnpm.cmd');
  });
});

describe('locating the interpreter', () => {
  const join = (...segments: string[]): string => segments.join('\\');

  it('prefers %SystemRoot% over %COMSPEC%', () => {
    assert.equal(
      resolveCommandInterpreter(
        { SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\hostile\\cmd.exe' },
        join,
      ),
      'C:\\Windows\\System32\\cmd.exe',
    );
  });

  it('accepts %windir% as the same fact under another name', () => {
    assert.equal(
      resolveCommandInterpreter({ windir: 'D:\\Windows' }, join),
      'D:\\Windows\\System32\\cmd.exe',
    );
  });

  it('falls back to %COMSPEC% only when there is no system root at all', () => {
    assert.equal(
      resolveCommandInterpreter({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, join),
      'C:\\Windows\\System32\\cmd.exe',
    );
  });

  it('reports that it found nothing rather than guessing a path', () => {
    assert.equal(resolveCommandInterpreter({}, join), null);
    assert.equal(resolveCommandInterpreter({ SystemRoot: '  ' }, join), null);
  });
});
