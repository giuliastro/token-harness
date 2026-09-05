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

describe('ui launcher', () => {
  it('documents the loopback-only read-only dashboard without inspecting the host', () => {
    const child = run(['ui', '--read-only', '--help']);

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /127\.0\.0\.1/);
    assert.match(child.stdout, /does not send data anywhere and cannot change configuration/);
  });

  it('documents approval-based guided controls as the default, not a read-only facade', () => {
    const child = run(['ui', '--help']);
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /explicit browser approval/);
    assert.match(child.stdout, /token-harness savings/);
    assert.doesNotMatch(child.stdout, /cannot change configuration/);
  });

  it('rejects options that could imply a non-local listener', () => {
    const child = run(['ui', '--listen', '0.0.0.0']);

    assert.equal(child.status, 2);
    assert.match(child.stderr, /Unknown ui option/);
    assert.equal(child.stdout, '');
  });
});
