import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXIT_CODES,
  EXIT_CODE_TABLE,
  PROBLEMS_FOUND_COMMANDS,
  exitCodeName,
  isCriticalExitCode,
  isExitCode,
} from '../src/index.js';

describe('exit code table', () => {
  it('matches RFC 0006 exactly', () => {
    assert.deepEqual(
      EXIT_CODE_TABLE.map((entry) => [entry.code, entry.name]),
      [
        [0, 'ok'],
        [1, 'internal-error'],
        [2, 'usage-error'],
        [3, 'problems-found'],
        [4, 'blocked-by-conflict'],
        [5, 'precondition-drift'],
        [6, 'apply-failed-rolled-back'],
        [7, 'apply-failed-dirty'],
        [8, 'confirmation-required'],
        [9, 'unsupported-environment'],
      ],
    );
  });

  it('has unique codes and unique names', () => {
    assert.equal(new Set(EXIT_CODE_TABLE.map((e) => e.code)).size, EXIT_CODE_TABLE.length);
    assert.equal(new Set(EXIT_CODE_TABLE.map((e) => e.name)).size, EXIT_CODE_TABLE.length);
  });

  it('maps names and codes both ways', () => {
    for (const entry of EXIT_CODE_TABLE) {
      assert.equal(EXIT_CODES[entry.name], entry.code);
      assert.equal(exitCodeName(entry.code), entry.name);
      assert.equal(isExitCode(entry.code), true);
    }
    assert.equal(exitCodeName(42), null);
    assert.equal(isExitCode(42), false);
  });

  it('treats 7 as the only critical code', () => {
    for (const entry of EXIT_CODE_TABLE) {
      assert.equal(isCriticalExitCode(entry.code), entry.code === 7, `code ${entry.code}`);
    }
  });

  it('reserves 3 for the read-only commands named by the RFC', () => {
    assert.deepEqual([...PROBLEMS_FOUND_COMMANDS], ['doctor', 'status', 'verify']);
  });
});
