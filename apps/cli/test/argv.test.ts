import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectJsonMode, parseArgv } from '../src/argv.js';

describe('argv', () => {
  it('detects --json before any validation', () => {
    assert.equal(detectJsonMode(['--json']), true);
    assert.equal(detectJsonMode(['doctor', '--json']), true);
    assert.equal(detectJsonMode(['--json=true']), true);
    assert.equal(detectJsonMode(['doctor']), false);
  });

  it('lets --help win over an otherwise invalid command line', () => {
    const parsed = parseArgv(['--nonsense', '--help', 'garbage', '--harness']);
    assert.equal(parsed.kind, 'help');
  });

  it('lets --version win too, and --help win over --version', () => {
    assert.equal(parseArgv(['--version', '--bogus']).kind, 'version');
    assert.equal(parseArgv(['--version', '--help']).kind, 'help');
  });

  it('scopes help to a known subcommand', () => {
    const parsed = parseArgv(['plan', '--help']);
    assert.equal(parsed.kind, 'help');
    if (parsed.kind !== 'help') return;
    assert.equal(parsed.topic, 'plan');
  });

  it('parses a command with its flags in either spelling', () => {
    for (const argv of [
      ['plan', '--harness', 'claude', '--provider', 'rtk'],
      ['plan', '--harness=claude', '--provider=rtk'],
    ]) {
      const parsed = parseArgv(argv);
      assert.equal(parsed.kind, 'command');
      if (parsed.kind !== 'command') return;
      assert.equal(parsed.command, 'plan');
      assert.equal(parsed.options.harness, 'claude');
      assert.equal(parsed.options.provider, 'rtk');
    }
  });

  it('rejects an unknown flag', () => {
    const parsed = parseArgv(['doctor', '--verbose']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'unknown-flag');
  });

  it('rejects a value flag with no value', () => {
    const parsed = parseArgv(['doctor', '--harness']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'flag-missing-value');
  });

  it('does not consume the next flag as a value', () => {
    const parsed = parseArgv(['doctor', '--harness', '--json']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'flag-missing-value');
    assert.equal(parsed.json, true);
  });

  it('rejects an identifier that is not lowercase kebab-case', () => {
    const parsed = parseArgv(['doctor', '--harness', 'Claude Code']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'invalid-argument');
  });

  it('rejects a mutating-only flag with its own code', () => {
    for (const flag of ['--yes', '--plan']) {
      const parsed = parseArgv(['doctor', flag, 'x']);
      assert.equal(parsed.kind, 'usage-error');
      if (parsed.kind !== 'usage-error') continue;
      assert.equal(parsed.diagnostics[0]?.code, 'flag-not-applicable');
    }
  });

  it('rejects a second positional argument', () => {
    const parsed = parseArgv(['doctor', 'extra']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'unexpected-argument');
  });

  it('distinguishes a typo from a command that is declared but not built', () => {
    const typo = parseArgv(['doctr']);
    assert.equal(typo.kind, 'usage-error');
    if (typo.kind === 'usage-error') assert.equal(typo.diagnostics[0]?.code, 'unknown-command');

    const planned = parseArgv(['uninstall']);
    assert.equal(planned.kind, 'usage-error');
    if (planned.kind === 'usage-error') {
      assert.equal(planned.diagnostics[0]?.code, 'command-not-available');
    }
  });

  it('treats an empty command line as a usage error', () => {
    const parsed = parseArgv([]);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'no-command');
  });

  it('rejects --json with a value', () => {
    const parsed = parseArgv(['doctor', '--json=false']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'flag-takes-no-value');
    assert.equal(parsed.json, true);
  });
});
