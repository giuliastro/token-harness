import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArgv } from '../src/argv.js';

describe('--tasks-left', () => {
  it('parses a positive whole-number workload target for optimize', () => {
    const parsed = parseArgv(['optimize', '--tasks-left', '7']);

    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.tasksLeft, 7);
  });

  it('supports the inline value spelling used by automation', () => {
    const parsed = parseArgv(['plan', '--tasks-left=3', '--native-policy']);

    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.tasksLeft, 3);
  });

  for (const value of ['0', '1.5', 'NaN']) {
    it(`rejects invalid workload target ${value}`, () => {
      const parsed = parseArgv(['optimize', '--tasks-left', value]);

      assert.equal(parsed.kind, 'usage-error');
      if (parsed.kind !== 'usage-error') return;
      assert.equal(parsed.diagnostics[0]?.code, 'invalid-tasks-left');
    });
  }

  it('rejects a negative inline workload target through workload validation', () => {
    const parsed = parseArgv(['optimize', '--tasks-left=-1']);

    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'invalid-tasks-left');
  });
});
