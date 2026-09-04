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

describe('Phase 18.7 launcher routing', () => {
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

  it('routes token-harness schedule without guessing missing evidence', () => {
    const child = run([
      'schedule',
      '--current',
      'claude',
      '--candidate',
      'codex',
      '--task-class',
      'hard',
    ]);

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /recommendation: insufficient-evidence/);
  });

  it('keeps the existing launcher path unchanged for other commands', () => {
    const child = run(['--version']);

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /^0\.1\.5\n$/);
  });

  it('surfaces both read-only Phase 18.7 commands from human root help only', () => {
    const root = run(['--help']);
    assert.equal(root.status, 0, root.stderr);
    assert.equal(root.stderr, '');
    assert.match(root.stdout, /Additional read-only commands/);
    assert.match(root.stdout, /handoff\s+Build a bounded compact handoff/);
    assert.match(root.stdout, /schedule\s+Evaluate a Claude Code/);

    const commandHelp = run(['doctor', '--help']);
    assert.equal(commandHelp.status, 0, commandHelp.stderr);
    assert.doesNotMatch(commandHelp.stdout, /Additional read-only commands/);
  });

  it('keeps read-only command help/version on dedicated paths with RFC 0006 precedence', () => {
    const handoffHelp = run(['handoff', '--bad-flag', '--help']);
    assert.equal(handoffHelp.status, 0, handoffHelp.stderr);
    assert.equal(handoffHelp.stderr, '');
    assert.match(handoffHelp.stdout, /token-harness handoff/);

    const scheduleHelp = run(['schedule', '--bad-flag', '--help']);
    assert.equal(scheduleHelp.status, 0, scheduleHelp.stderr);
    assert.equal(scheduleHelp.stderr, '');
    assert.match(scheduleHelp.stdout, /token-harness schedule/);

    const version = run(['schedule', '--bad-flag', '--version']);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stderr, '');
    assert.match(version.stdout, /^0\.1\.5\n$/);
  });

  it('does not append human discoverability text to JSON root help', () => {
    const child = run(['--help', '--json']);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    const envelope = JSON.parse(child.stdout) as { command: string; status: string };
    assert.equal(envelope.command, 'help');
    assert.equal(envelope.status, 'ok');
  });
});
