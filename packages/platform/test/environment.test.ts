/**
 * Child-process environment policy — RFC 0004 §Credentials.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import { minimalChildEnvironment } from '../src/index.js';

function facts(os: PlatformFacts['os'], isWsl = false): PlatformFacts {
  return { os, osDisplayName: os, arch: 'x64', nodeVersion: '22.13.0', isWsl };
}

describe('minimal child environment', () => {
  it('is an allowlist, so a variable nobody thought about is not inherited', () => {
    const env = minimalChildEnvironment({
      facts: facts('linux'),
      ambient: {
        PATH: '/usr/bin',
        HOME: '/home/dev',
        SOME_FUTURE_CREDENTIAL_FORMAT: 'value',
        GITHUB_TOKEN: 'ghp_x',
      },
    });
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'NO_COLOR', 'PATH']);
  });

  it('matches names case-insensitively on Windows, where Path is the usual spelling', () => {
    const env = minimalChildEnvironment({
      facts: facts('windows'),
      ambient: {
        Path: 'C:\\Windows',
        SystemRoot: 'C:\\Windows',
        ProgramFiles: 'C:\\Program Files',
      },
    });
    assert.equal(env['Path'], 'C:\\Windows');
    assert.equal(env['SystemRoot'], 'C:\\Windows');
  });

  it('matches exactly on POSIX, where the environment is case-sensitive', () => {
    const env = minimalChildEnvironment({
      facts: facts('linux'),
      ambient: { Path: '/wrong', PATH: '/usr/bin' },
    });
    assert.equal(env['PATH'], '/usr/bin');
    assert.equal(env['Path'], undefined);
  });

  it('applies the POSIX allowlist under WSL', () => {
    const env = minimalChildEnvironment({
      facts: facts('linux', true),
      ambient: {
        PATH: '/usr/bin',
        HOME: '/home/dev',
        LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
      },
    });
    assert.equal(env['LOCALAPPDATA'], undefined);
    assert.equal(env['HOME'], '/home/dev');
  });

  it('sets NO_COLOR, because a child that colours its output breaks every importer', () => {
    const env = minimalChildEnvironment({ facts: facts('linux'), ambient: {} });
    assert.equal(env['NO_COLOR'], '1');
  });

  it('lets a caller add what a specific command needs', () => {
    const env = minimalChildEnvironment({
      facts: facts('linux'),
      ambient: { PATH: '/usr/bin' },
      additions: { RTK_CONFIG: '/tmp/config', NO_COLOR: '0' },
    });
    assert.equal(env['RTK_CONFIG'], '/tmp/config');
    // An explicit addition wins over the default, because the caller knows more.
    assert.equal(env['NO_COLOR'], '0');
  });

  it('drops unset variables rather than passing them as undefined', () => {
    const env = minimalChildEnvironment({
      facts: facts('linux'),
      ambient: { PATH: undefined, HOME: '/home/dev' },
    });
    assert.equal(Object.hasOwn(env, 'PATH'), false);
  });
});
