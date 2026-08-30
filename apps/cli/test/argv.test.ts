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

  it('accepts --yes and --plan now that a mutating command exists', () => {
    // These were rejected as `flag-not-applicable` while `apply` was absent. It is here, so the
    // flags are real: `--yes` is the confirmation RFC 0006 requires, and `--plan` selects a
    // stored plan.
    const parsed = parseArgv(['apply', '--yes', '--plan', 'deadbeef']);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.yes, true);
    assert.equal(parsed.options.plan, 'deadbeef');
  });

  it('rejects a --plan value that cannot be a plan id', () => {
    const parsed = parseArgv(['apply', '--plan', 'not-an-id']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    // A usage error rather than a later "no such plan": the value could never have named a file.
    assert.equal(parsed.diagnostics[0]?.code, 'invalid-argument');
  });

  it('rejects a value attached to --yes', () => {
    const parsed = parseArgv(['apply', '--yes=please']);
    assert.equal(parsed.kind, 'usage-error');
    if (parsed.kind !== 'usage-error') return;
    assert.equal(parsed.diagnostics[0]?.code, 'flag-takes-no-value');
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

    /**
     * The planned list is supplied here rather than read from the module, because it is now empty:
     * `update` was the last command RFC 0001 declares that this build did not carry, and before it
     * `uninstall` stood in this test. Every declared command is implemented.
     *
     * The mechanism still matters — it is what keeps the next declared command from reading as a
     * misspelling — so it is tested against a supplied list rather than deleted along with its last
     * real subject. `migrate` is a name nothing declares, which is exactly what makes it usable as
     * a stand-in: the branch under test is the list membership, not the name.
     */
    const planned = parseArgv(['migrate'], ['migrate']);
    assert.equal(planned.kind, 'usage-error');
    if (planned.kind === 'usage-error') {
      assert.equal(planned.diagnostics[0]?.code, 'command-not-available');
    }

    // And the same name off the list is a typo again, so the assertion above is about membership.
    const unlisted = parseArgv(['migrate'], []);
    assert.equal(unlisted.kind, 'usage-error');
    if (unlisted.kind === 'usage-error') {
      assert.equal(unlisted.diagnostics[0]?.code, 'unknown-command');
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

  it('parses optimizer task profile and reserve inputs', () => {
    const parsed = parseArgv([
      'optimize',
      '--task',
      'hard',
      '--profile=quality',
      '--reserve',
      '15',
    ]);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.command, 'optimize');
    assert.equal(parsed.options.task, 'hard');
    assert.equal(parsed.options.profile, 'quality');
    assert.equal(parsed.options.reservePercent, 15);
  });

  it('rejects invalid optimizer policy values', () => {
    for (const argv of [
      ['optimize', '--task', 'impossible'],
      ['optimize', '--profile', 'turbo'],
      ['optimize', '--reserve', '101'],
    ]) {
      const parsed = parseArgv(argv);
      assert.equal(parsed.kind, 'usage-error');
    }
  });

});
