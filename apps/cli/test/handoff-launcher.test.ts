import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const launcher = join(process.cwd(), 'apps', 'cli', 'bin', 'token-harness.mjs');

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [launcher, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

describe('handoff launcher routing', () => {
  it('routes token-harness handoff through the dedicated command', () => {
    const child = run([
      'handoff',
      '--objective',
      'Transfer only explicit state',
      '--next-action',
      'Continue safely',
    ]);

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /^# Compact handoff\n/);
    assert.match(child.stdout, /Transfer only explicit state/);
  });

  it('keeps the existing launcher path unchanged for other commands', () => {
    const child = run(['--version']);

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /^0\.1\.5\n$/);
  });
});
