/**
 * Project attribution — RFC 0005 §Privacy, "a local stable hash with a machine-local salt".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveProjectId,
  isUsableSalt,
  normalizeProjectPath,
  PROJECT_SALT_BYTES,
} from '../src/index.js';

const SALT = 'a'.repeat(64);
const OTHER_SALT = 'b'.repeat(64);

describe('normalizeProjectPath', () => {
  const cases: ReadonlyArray<readonly [string, string, boolean, string]> = [
    // The one that comes from a real machine: RTK records this spelling.
    [
      'strips the extended-length prefix',
      '\\\\?\\C:\\Software\\TokenHarness',
      true,
      'c:/software/tokenharness',
    ],
    ['strips it from a UNC path', '\\\\?\\UNC\\server\\share\\work', true, '//server/share/work'],
    ['keeps a plain UNC root', '\\\\server\\share\\work', true, '//server/share/work'],
    ['normalizes separators', 'C:\\Software/TokenHarness', true, 'c:/software/tokenharness'],
    [
      'drops a trailing separator',
      'C:\\Software\\TokenHarness\\',
      true,
      'c:/software/tokenharness',
    ],
    ['collapses repeated separators', 'C:\\\\Software\\\\Harness', true, 'c:/software/harness'],
    ['keeps a bare root', 'C:\\', true, 'c:/'],
    ['trims surrounding space', '  C:\\Software  ', true, 'c:/software'],
    // POSIX paths are case-sensitive, and folding them would merge two real directories.
    ['preserves case on posix', '/home/dev/Work', false, '/home/dev/Work'],
    ['folds case on windows', 'C:\\Software', true, 'c:/software'],
  ];

  for (const [name, input, caseInsensitive, expected] of cases) {
    it(name, () => {
      assert.equal(normalizeProjectPath(input, caseInsensitive), expected);
    });
  }
});

describe('deriveProjectId', () => {
  it('is stable for the same path and salt', () => {
    assert.equal(
      deriveProjectId('C:\\Software\\Harness', SALT, true),
      deriveProjectId('C:\\Software\\Harness', SALT, true),
    );
  });

  it('gives the extended-length and plain spellings the same identifier', () => {
    // Without normalization one project hashes as two, and every report grouped by project
    // splits in half on a Windows machine where RTK supplied the path.
    assert.equal(
      deriveProjectId('\\\\?\\C:\\Software\\TokenHarness', SALT, true),
      deriveProjectId('C:\\Software\\TokenHarness', SALT, true),
    );
  });

  it('differs across salts, which is what machine-local means', () => {
    assert.notEqual(
      deriveProjectId('C:\\Software\\Harness', SALT, true),
      deriveProjectId('C:\\Software\\Harness', OTHER_SALT, true),
    );
  });

  it('differs across projects', () => {
    assert.notEqual(
      deriveProjectId('C:\\Software\\A', SALT, true),
      deriveProjectId('C:\\Software\\B', SALT, true),
    );
  });

  it('cannot be confused by moving the boundary between salt and path', () => {
    // The separator is a NUL, which cannot occur in either operand, so no pair of
    // (salt, path) values can hash the same input as a different pair.
    assert.notEqual(deriveProjectId('b', 'a', false), deriveProjectId('', 'ab', false));
  });

  it('is prefixed so it is never mistaken for a path or a digest', () => {
    assert.match(deriveProjectId('/home/dev/work', SALT, false), /^p_[0-9a-f]{12}$/);
  });
});

describe('isUsableSalt', () => {
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ['a generated salt', 'a'.repeat(PROJECT_SALT_BYTES * 2), true],
    ['the shortest acceptable salt', 'f'.repeat(32), true],
    ['tolerates a trailing newline', `${'a'.repeat(64)}\n`, true],
    // Worse than no salt, because it looks like one.
    ['a truncated file', '', false],
    ['too short to salt anything', 'abc', false],
    ['not hex', 'z'.repeat(64), false],
  ];

  for (const [name, value, expected] of cases) {
    it(name, () => {
      assert.equal(isUsableSalt(value), expected);
    });
  }
});
