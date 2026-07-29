/**
 * Path resolution — RFC 0001 §Configuration and state, PLAN §2.1 acceptance.
 *
 * Table-driven across all three platforms from any one of them, and no case reads
 * or writes anything: resolution is pure. That is also what makes the
 * `%LOCALAPPDATA%`-unresolvable case testable at all — it is not a state a machine
 * can be put into for the duration of a test.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import {
  isInsideDirectory,
  normalizePath,
  pathsEqual,
  resolvePlatformPaths,
  type PathResolutionInput,
} from '../src/index.js';

const WINDOWS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const MACOS: PlatformFacts = {
  os: 'macos',
  osDisplayName: 'macOS 15',
  arch: 'arm64',
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

const WSL: PlatformFacts = { ...LINUX, isWsl: true };

const WINDOWS_ENV = {
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
  APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\dev',
};

function input(overrides: Partial<PathResolutionInput>): PathResolutionInput {
  return {
    facts: LINUX,
    env: {},
    home: '/home/dev',
    temporaryDirectory: '/tmp',
    ...overrides,
  };
}

describe('state root, per RFC 0001', () => {
  it('Windows uses %LOCALAPPDATA%\\TokenHarness', () => {
    const resolution = resolvePlatformPaths(
      input({
        facts: WINDOWS,
        env: WINDOWS_ENV,
        home: 'C:\\Users\\dev',
        temporaryDirectory: 'C:\\Users\\dev\\AppData\\Local\\Temp',
      }),
    );
    assert.ok(resolution.ok);
    assert.equal(resolution.paths.state, 'C:\\Users\\dev\\AppData\\Local\\TokenHarness');
    assert.equal(resolution.paths.config, 'C:\\Users\\dev\\AppData\\Roaming\\TokenHarness');
    assert.equal(resolution.paths.cache, 'C:\\Users\\dev\\AppData\\Local\\TokenHarness\\Cache');
  });

  it('macOS uses ~/Library/Application Support/TokenHarness', () => {
    const resolution = resolvePlatformPaths(
      input({ facts: MACOS, home: '/Users/dev', temporaryDirectory: '/var/folders/ab/T' }),
    );
    assert.ok(resolution.ok);
    assert.equal(resolution.paths.state, '/Users/dev/Library/Application Support/TokenHarness');
    assert.equal(resolution.paths.cache, '/Users/dev/Library/Caches/TokenHarness');
  });

  it('Linux uses ${XDG_STATE_HOME:-~/.local/state}/token-harness', () => {
    const fallback = resolvePlatformPaths(input({}));
    assert.ok(fallback.ok);
    assert.equal(fallback.paths.state, '/home/dev/.local/state/token-harness');
    assert.equal(fallback.paths.config, '/home/dev/.config/token-harness');
    assert.equal(fallback.paths.data, '/home/dev/.local/share/token-harness');
    assert.equal(fallback.paths.cache, '/home/dev/.cache/token-harness');

    const overridden = resolvePlatformPaths(input({ env: { XDG_STATE_HOME: '/home/dev/state' } }));
    assert.ok(overridden.ok);
    assert.equal(overridden.paths.state, '/home/dev/state/token-harness');
  });

  it('keeps the casing RFC 0001 specifies, which differs by platform on purpose', () => {
    const windows = resolvePlatformPaths(
      input({ facts: WINDOWS, env: WINDOWS_ENV, home: 'C:\\Users\\dev', temporaryDirectory: null }),
    );
    const linux = resolvePlatformPaths(input({}));
    assert.ok(windows.ok && linux.ok);
    assert.ok(windows.paths.state.endsWith('TokenHarness'), windows.paths.state);
    assert.ok(linux.paths.state.endsWith('token-harness'), linux.paths.state);
  });

  it('gives WSL Linux paths, not Windows ones', () => {
    const resolution = resolvePlatformPaths(
      input({ facts: WSL, env: { ...WINDOWS_ENV, HOME: '/home/dev' } }),
    );
    assert.ok(resolution.ok);
    // %LOCALAPPDATA% is visible inside WSL through WSLENV interop. Honouring it
    // would put the state root on a DrvFs mount that does not enforce POSIX modes.
    assert.equal(resolution.paths.state, '/home/dev/.local/state/token-harness');
  });
});

describe('resolution failure is never a fallback', () => {
  it('refuses to guess when %LOCALAPPDATA% is unset', () => {
    const resolution = resolvePlatformPaths(
      input({
        facts: WINDOWS,
        env: { USERPROFILE: 'C:\\Users\\dev', APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
        home: 'C:\\Users\\dev',
        temporaryDirectory: 'C:\\Temp',
      }),
    );
    assert.equal(resolution.ok, false);
    if (resolution.ok) return;
    assert.equal(resolution.diagnostics[0]?.code, 'state-path-unresolvable');
    assert.equal(resolution.diagnostics[0]?.severity, 'error');
  });

  for (const [label, value] of [
    ['empty', ''],
    ['whitespace', '   '],
    ['relative', 'AppData\\Local'],
  ] as const) {
    it(`treats a ${label} %LOCALAPPDATA% as unset rather than resolving it against the cwd`, () => {
      const resolution = resolvePlatformPaths(
        input({
          facts: WINDOWS,
          env: { ...WINDOWS_ENV, LOCALAPPDATA: value },
          home: 'C:\\Users\\dev',
          temporaryDirectory: 'C:\\Temp',
        }),
      );
      assert.equal(resolution.ok, false);
    });
  }

  it('ignores a relative XDG value, as the XDG specification requires', () => {
    const resolution = resolvePlatformPaths(input({ env: { XDG_STATE_HOME: 'relative/state' } }));
    assert.ok(resolution.ok);
    assert.equal(resolution.paths.state, '/home/dev/.local/state/token-harness');
  });

  it('fails when the home directory cannot be resolved', () => {
    const resolution = resolvePlatformPaths(input({ home: null, env: {} }));
    assert.equal(resolution.ok, false);
    if (resolution.ok) return;
    assert.equal(resolution.diagnostics[0]?.code, 'state-path-unresolvable');
  });

  it('falls back to %USERPROFILE% for the home directory but never for the state root', () => {
    const resolution = resolvePlatformPaths(
      input({ facts: WINDOWS, env: WINDOWS_ENV, home: null, temporaryDirectory: null }),
    );
    assert.ok(resolution.ok);
    assert.equal(resolution.paths.home, 'C:\\Users\\dev');
  });

  it('uses the local root for configuration when %APPDATA% is missing', () => {
    const resolution = resolvePlatformPaths(
      input({
        facts: WINDOWS,
        env: { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local', USERPROFILE: 'C:\\Users\\dev' },
        home: 'C:\\Users\\dev',
        temporaryDirectory: null,
      }),
    );
    assert.ok(resolution.ok);
    assert.equal(resolution.paths.config, 'C:\\Users\\dev\\AppData\\Local\\TokenHarness');
  });
});

describe('the state root is never world-writable', () => {
  it('rejects an XDG_STATE_HOME pointing into the system temporary directory', () => {
    const resolution = resolvePlatformPaths(
      input({ env: { XDG_STATE_HOME: '/tmp/state' }, temporaryDirectory: '/tmp' }),
    );
    assert.equal(resolution.ok, false);
    if (resolution.ok) return;
    assert.equal(resolution.diagnostics[0]?.code, 'state-path-world-writable');
    assert.equal(resolution.diagnostics[0]?.path, '/tmp/state/token-harness');
  });

  it('rejects a %LOCALAPPDATA% pointing into the temporary directory, case-insensitively', () => {
    const resolution = resolvePlatformPaths(
      input({
        facts: WINDOWS,
        env: { ...WINDOWS_ENV, LOCALAPPDATA: 'C:\\WINDOWS\\TEMP\\local' },
        home: 'C:\\Users\\dev',
        temporaryDirectory: 'C:\\Windows\\Temp',
      }),
    );
    assert.equal(resolution.ok, false);
  });

  it('does not confuse a sibling of the temporary directory for a child of it', () => {
    const resolution = resolvePlatformPaths(
      input({ env: { XDG_STATE_HOME: '/tmpfoo/state' }, temporaryDirectory: '/tmp' }),
    );
    assert.ok(resolution.ok, 'a path merely sharing a prefix with /tmp is not inside it');
  });
});

describe('path normalization keeps platform semantics', () => {
  it('collapses traversal without changing the separator', () => {
    assert.equal(normalizePath('C:\\Users\\dev\\..\\dev\\.\\x', WINDOWS), 'C:\\Users\\dev\\x');
    assert.equal(normalizePath('/home/dev/../dev/./x', LINUX), '/home/dev/x');
  });

  it('drops a trailing separator but never a root', () => {
    assert.equal(normalizePath('/home/dev/', LINUX), '/home/dev');
    assert.equal(normalizePath('/', LINUX), '/');
    assert.equal(normalizePath('C:\\', WINDOWS), 'C:\\');
  });

  it('does not lowercase, so a path stays the path the user has', () => {
    assert.equal(normalizePath('C:\\Users\\Dev', WINDOWS), 'C:\\Users\\Dev');
  });

  it('compares case-insensitively only where the filesystem does', () => {
    assert.equal(pathsEqual('C:\\Users\\Dev', 'c:\\users\\dev', WINDOWS), true);
    assert.equal(pathsEqual('/home/Dev', '/home/dev', LINUX), false);
    // WSL is Linux here: two paths differing in case are two files.
    assert.equal(pathsEqual('/home/Dev', '/home/dev', WSL), false);
  });

  it('containment is computed, not prefix-matched', () => {
    assert.equal(isInsideDirectory('/tmp/x', '/tmp', LINUX), true);
    assert.equal(isInsideDirectory('/tmp', '/tmp', LINUX), true);
    assert.equal(isInsideDirectory('/tmpfoo', '/tmp', LINUX), false);
    assert.equal(isInsideDirectory('/tmp/../etc', '/tmp', LINUX), false);
  });
});
