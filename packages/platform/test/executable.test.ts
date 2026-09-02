/**
 * Executable resolution — PLAN §2.1, "executable resolution, including Windows
 * shims and `PATHEXT`".
 *
 * The probe is a fixture map, so a Windows `PATHEXT` search is asserted on Linux
 * and a POSIX execute-bit rule is asserted on Windows. Nothing here touches a real
 * filesystem.
 */

import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import {
  DEFAULT_PATHEXT,
  WINDOWS_SYSTEM_UTILITIES,
  nodeExecutableProbe,
  resolveExecutable,
  resolveExecutables,
  type ExecutableProbe,
} from '../src/index.js';

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

  /**
   * The regression test for the ordering bug, taken from a real machine.
   *
   * npm and pnpm install a global `bin` entry as a triple: an extensionless Unix
   * shell script, a `.cmd`, and a `.ps1`. Trying the bare name first resolved
   * `opencode`, `pnpm`, and `harnesstrim` to the shell script, which Windows cannot
   * launch — so every npm-installed provider and every package manager came back
   * `windows-unsupported-extension` on a stock Windows development machine.
   */
  it('resolves an npm shim triple to the .cmd, not to the extensionless shell script', () => {
    const resolved = resolveExecutable({
      name: 'opencode',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode': {},
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.cmd': {},
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.ps1': {},
      }),
    });
    assert.equal(resolved?.path, 'C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.cmd');
    assert.equal(resolved?.kind, 'windows-batch-shim');
  });

  it('reports an extensionless file when there is nothing launchable beside it', () => {
    // Found, but not startable. More use than reporting nothing, and
    // `isStartableExecutable` is what callers gate on.
    const resolved = resolveExecutable({
      name: 'opencode',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\tools\\opencode': {} }),
    });
    assert.equal(resolved?.path, 'C:\\tools\\opencode');
    assert.equal(resolved?.kind, 'windows-unsupported-extension');
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

/**
 * RFC 0004 §State directory permissions runs `icacls` and `whoami` through the
 * process runner, and both must be the Windows ones.
 *
 * The first case is not hypothetical: Git for Windows puts `usr/bin` on `PATH` on a
 * large share of Windows development machines, and its coreutils `whoami` exits 1 on
 * `/user /fo csv`. The ACL check then cannot obtain the current user's SID and Token
 * Harness refuses to run — safely, and for everyone.
 */
describe('Windows system utilities', () => {
  const SYSTEM32 = 'C:\\Windows\\System32';
  const env = {
    PATH: 'C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\System32',
    PATHEXT: DEFAULT_PATHEXT,
    SystemRoot: 'C:\\Windows',
  };

  function probeWithDecoy(): ExecutableProbe {
    return fakeProbe({
      // Git's coreutils build, earlier on PATH than System32.
      'C:\\Program Files\\Git\\usr\\bin\\whoami.exe': {},
      [`${SYSTEM32}\\whoami.exe`]: {},
      [`${SYSTEM32}\\icacls.exe`]: {},
      [`${SYSTEM32}\\taskkill.exe`]: {},
      // Also in System32, and deliberately not on the allowlist.
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe': {},
      [`${SYSTEM32}\\bash.exe`]: {},
    });
  }

  for (const name of ['whoami', 'icacls', 'taskkill']) {
    it(`resolves ${name} from System32, whatever PATH says`, () => {
      const resolved = resolveExecutable({
        name,
        facts: WINDOWS,
        env,
        cwd: 'C:\\work',
        probe: probeWithDecoy(),
      });
      assert.equal(resolved?.path, `${SYSTEM32}\\${name}.exe`);
      assert.equal(resolved?.kind, 'native');
    });
  }

  it('applies the rule to the name with its extension spelled out', () => {
    const resolved = resolveExecutable({
      name: 'whoami.exe',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: probeWithDecoy(),
    });
    assert.equal(resolved?.path, `${SYSTEM32}\\whoami.exe`);
  });

  it('does not shadow a name that merely happens to exist in System32', () => {
    // System32 also holds curl, tar, find, and bash. An allowlist, not a preference.
    const resolved = resolveExecutable({
      name: 'bash',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: probeWithDecoy(),
    });
    assert.equal(resolved?.path, 'C:\\Program Files\\Git\\usr\\bin\\bash.exe');
  });

  it('falls back to PATH when System32 does not hold the utility', () => {
    const resolved = resolveExecutable({
      name: 'whoami',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({ 'C:\\Program Files\\Git\\usr\\bin\\whoami.exe': {} }),
    });
    assert.equal(resolved?.path, 'C:\\Program Files\\Git\\usr\\bin\\whoami.exe');
  });

  it('falls back to PATH when there is no system root to resolve against', () => {
    const resolved = resolveExecutable({
      name: 'whoami',
      facts: WINDOWS,
      env: { PATH: 'C:\\Windows\\System32', PATHEXT: DEFAULT_PATHEXT },
      cwd: 'C:\\work',
      probe: probeWithDecoy(),
    });
    assert.equal(resolved?.path, `${SYSTEM32}\\whoami.exe`);
  });

  it('does not redirect a path-qualified name', () => {
    const resolved = resolveExecutable({
      name: '.\\vendor\\whoami',
      facts: WINDOWS,
      env,
      cwd: 'C:\\work',
      probe: fakeProbe({
        'C:\\work\\vendor\\whoami.exe': {},
        [`${SYSTEM32}\\whoami.exe`]: {},
      }),
    });
    assert.equal(resolved?.path, 'C:\\work\\vendor\\whoami.exe');
  });

  it('leaves POSIX resolution alone', () => {
    const resolved = resolveExecutable({
      name: 'whoami',
      facts: LINUX,
      env: { PATH: '/usr/bin', SystemRoot: 'C:\\Windows' },
      cwd: '/work',
      probe: fakeProbe({ '/usr/bin/whoami': { magic: ELF } }),
    });
    assert.equal(resolved?.path, '/usr/bin/whoami');
  });

  it('names exactly the utilities Token Harness invokes', () => {
    // Adding one is a deliberate act, so the list is asserted rather than sampled.
    assert.deepEqual([...WINDOWS_SYSTEM_UTILITIES], ['icacls', 'whoami', 'taskkill']);
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

/**
 * The real probe, against a real filesystem — the one thing the fixture map above cannot cover.
 *
 * `nodeExecutableProbe` is where a Windows App Execution Alias was being lost.
 * `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` is a reparse point that `CreateProcess`
 * executes and `stat` cannot open: measured on the machine this was fixed on, `statSync` raises
 * `EACCES` while `lstatSync` reports `isFile=false, isSymlink=true, size=99`. The probe caught the
 * `stat` failure and answered `absent`, so the resolver rejected `winget` and every winget install
 * and query failed with `executable-not-found` — a path that had never actually been run, because
 * the install argv was verified by reading `--help` and the resolution in front of it was not.
 *
 * A dangling symlink reproduces exactly that pair of answers without needing the Store, and it does
 * so on all three platforms.
 */
describe('the real probe and an entry stat cannot follow', () => {
  it('reports a dangling symlink as a file rather than as absent', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'th-probe-'));
    const link = join(root, 'winget.exe');
    try {
      try {
        symlinkSync(join(root, 'nothing-here.exe'), link, 'file');
      } catch {
        // Creating a symlink on Windows needs Developer Mode or elevation. Skipped rather than
        // weakened: the property is verified on the other two platforms in CI, and on Windows it
        // was verified against the actual alias.
        t.skip('this platform does not permit creating a symlink unprivileged');
        return;
      }

      // The premise, asserted rather than assumed — without it this test could pass against an
      // entry `stat` handles fine, and would be checking nothing.
      assert.throws(() => statSync(link));
      assert.equal(lstatSync(link).isSymbolicLink(), true);

      assert.equal(nodeExecutableProbe().entryKind(link), 'file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still reports a path that is genuinely not there as absent', () => {
    // The control: the fallback must not turn every missing path into a file.
    const root = mkdtempSync(join(tmpdir(), 'th-probe-'));
    try {
      assert.equal(nodeExecutableProbe().entryKind(join(root, 'absent.exe')), 'absent');
      assert.equal(nodeExecutableProbe().entryKind(root), 'directory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


describe('executable enumeration for shadow diagnostics', () => {
  it('preserves POSIX PATH order and deduplicates a repeated directory', () => {
    const resolved = resolveExecutables({
      name: 'harnesstrim',
      facts: LINUX,
      env: { PATH: '/old/bin:/new/bin:/old/bin' },
      cwd: '/work',
      probe: fakeProbe({
        '/old/bin/harnesstrim': { magic: SHEBANG, executable: true },
        '/new/bin/harnesstrim': { magic: SHEBANG, executable: true },
      }),
    });

    assert.deepEqual(
      resolved.map((entry) => entry.path),
      ['/old/bin/harnesstrim', '/new/bin/harnesstrim'],
    );
  });

  it('treats a Windows npm shim triple as one install per PATH directory', () => {
    const resolved = resolveExecutables({
      name: 'harnesstrim',
      facts: WINDOWS,
      env: {
        PATH: 'C:\\old\\npm;C:\\new\\npm',
        PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1',
      },
      cwd: 'C:\\work',
      probe: fakeProbe({
        'C:\\old\\npm\\harnesstrim': {},
        'C:\\old\\npm\\harnesstrim.cmd': {},
        'C:\\old\\npm\\harnesstrim.ps1': {},
        'C:\\new\\npm\\harnesstrim.cmd': {},
        'C:\\new\\npm\\harnesstrim.ps1': {},
      }),
    });

    assert.deepEqual(
      resolved.map((entry) => [entry.path, entry.kind]),
      [
        ['C:\\old\\npm\\harnesstrim.cmd', 'windows-batch-shim'],
        ['C:\\new\\npm\\harnesstrim.cmd', 'windows-batch-shim'],
      ],
    );
  });
});
