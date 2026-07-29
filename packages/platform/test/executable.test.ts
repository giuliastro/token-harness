/**
 * Executable resolution — PLAN §2.1, "executable resolution, including Windows
 * shims and `PATHEXT`".
 *
 * The probe is a fixture map, so a Windows `PATHEXT` search is asserted on Linux
 * and a POSIX execute-bit rule is asserted on Windows. Nothing here touches a real
 * filesystem.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import { DEFAULT_PATHEXT, resolveExecutable, type ExecutableProbe } from '../src/index.js';

const WINDOWS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

interface FakeFile {
  /** Absent means the file has no magic bytes to read. */
  magic?: readonly number[];
  executable?: boolean;
}

function fakeProbe(
  files: Readonly<Record<string, FakeFile>>,
  directories: readonly string[] = [],
): ExecutableProbe {
  const dirs = new Set(directories);
  return {
    entryKind(path) {
      if (dirs.has(path)) return 'directory';
      return Object.hasOwn(files, path) ? 'file' : 'absent';
    },
    isExecutable(path) {
      return files[path]?.executable ?? true;
    },
    readMagic(path) {
      const magic = files[path]?.magic;
      return magic === undefined ? null : new Uint8Array(magic);
    },
  };
}

const ELF = [0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01];
const SHEBANG = [...Buffer.from('#!/usr/bin/env node\n')];
const PLAIN_TEXT = [...Buffer.from('echo hello\n')];

describe('Windows resolution', () => {
  const env = { PATH: 'C:\\tools;C:\\Users\\dev\\AppData\\Roaming\\npm', PATHEXT: DEFAULT_PATHEXT };

  it('finds a .cmd shim and classifies it as one', () => {
    const resolved = resolveExecutable({
      name: 'pnpm',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd': {} }),
    });
    assert.equal(resolved?.path, 'C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd');
    assert.equal(resolved?.kind, 'windows-batch-shim');
    assert.equal(resolved?.requested, 'pnpm');
  });

  it('prefers the PATHEXT order the machine declares', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: WINDOWS,
      env: { ...env, PATHEXT: '.CMD;.EXE' },
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\rtk.cmd': {}, 'C:\\tools\\rtk.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\tools\\rtk.cmd');
  });

  it('classifies .exe as directly startable', () => {
    const resolved = resolveExecutable({
      name: 'icacls',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\icacls.exe': {} }),
    });
    assert.equal(resolved?.kind, 'native');
  });

  it('reports a PATHEXT entry it will not launch instead of pretending it can', () => {
    const resolved = resolveExecutable({
      name: 'weird',
      facts: WINDOWS,
      env: { ...env, PATHEXT: '.PS1' },
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\weird.ps1': {} }),
    });
    assert.equal(resolved?.kind, 'windows-unsupported-extension');
  });

  it('uses an explicit extension verbatim', () => {
    const resolved = resolveExecutable({
      name: 'rtk.exe',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\rtk.exe': {}, 'C:\\tools\\rtk.exe.cmd': {} }),
    });
    assert.equal(resolved?.path, 'C:\\tools\\rtk.exe');
  });

  it('falls back to the stock PATHEXT when the variable is unset', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: WINDOWS,
      env: { PATH: 'C:\\tools' },
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\rtk.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\tools\\rtk.exe');
  });

  it('accepts the Path spelling, which is the one Windows writes', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: WINDOWS,
      env: { Path: 'C:\\tools' },
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\rtk.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\tools\\rtk.exe');
  });

  it('unquotes a quoted PATH entry', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: WINDOWS,
      env: { PATH: '"C:\\Program Files\\rtk"' },
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\Program Files\\rtk\\rtk.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\Program Files\\rtk\\rtk.exe');
  });

  it('never searches the working directory, however convenient that would be', () => {
    // RFC 0004 §Repository trust: project-local content is untrusted, and Token
    // Harness runs with the user's repository as the working directory.
    const resolved = resolveExecutable({
      name: 'pnpm',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work\\hostile-repo',
      probe: fakeProbe({ 'C:\\work\\hostile-repo\\pnpm.exe': {} }),
    });
    assert.equal(resolved, null);
  });

  it('resolves a name containing a separator against the working directory instead of PATH', () => {
    const resolved = resolveExecutable({
      name: '.\\tools\\rtk',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\work\\tools\\rtk.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\work\\tools\\rtk.exe');
  });

  it('skips a directory that shares the name', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({}, ['C:\\tools\\rtk.exe']),
    });
    assert.equal(resolved, null);
  });
});

describe('POSIX resolution', () => {
  const env = { PATH: '/usr/local/bin:/usr/bin' };

  it('requires the execute bit', () => {
    const probe = fakeProbe({
      '/usr/local/bin/rtk': { magic: ELF, executable: false },
      '/usr/bin/rtk': { magic: ELF, executable: true },
    });
    const resolved = resolveExecutable({ name: 'rtk', facts: LINUX, env, cwd: '/work', probe });
    assert.equal(resolved?.path, '/usr/bin/rtk');
    assert.equal(resolved?.kind, 'native');
  });

  it('classifies a shebang script as startable', () => {
    const resolved = resolveExecutable({
      name: 'harnesstrim',
      facts: LINUX,
      env,
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/harnesstrim': { magic: SHEBANG } }),
    });
    assert.equal(resolved?.kind, 'posix-script');
  });

  /**
   * A text file with the execute bit and no `#!` line fails with `ENOEXEC` deep
   * inside whichever adapter tried to run it. Naming it here is what turns that
   * into a diagnostic a user can act on.
   */
  it('names a text file with no shebang rather than letting execve report it', () => {
    const resolved = resolveExecutable({
      name: 'broken',
      facts: LINUX,
      env,
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/broken': { magic: PLAIN_TEXT } }),
    });
    assert.equal(resolved?.kind, 'posix-script-without-shebang');
  });

  it('classification fails open for a binary format it does not recognise', () => {
    const resolved = resolveExecutable({
      name: 'exotic',
      facts: LINUX,
      env,
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/exotic': { magic: [0x00, 0x01, 0x02, 0x03] } }),
    });
    assert.equal(resolved?.kind, 'native');
  });

  it('does not apply PATHEXT on POSIX', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: LINUX,
      env: { ...env, PATHEXT: '.EXE' },
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/rtk.exe': { magic: ELF } }),
    });
    assert.equal(resolved, null);
  });

  it('returns null for an empty name rather than resolving the working directory', () => {
    const resolved = resolveExecutable({
      name: '  ',
      facts: LINUX,
      env,
      cwd: '/work',
      probe: fakeProbe({}),
    });
    assert.equal(resolved, null);
  });

  it('returns null when PATH is unset', () => {
    const resolved = resolveExecutable({
      name: 'rtk',
      facts: LINUX,
      env: {},
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/rtk': { magic: ELF } }),
    });
    assert.equal(resolved, null);
  });
});
