/**
 * Stream discipline — RFC 0006 §Streams.
 *
 * | Mode    | stdout                    | stderr                              |
 * | Human   | The report                | Diagnostics, progress, warnings     |
 * | --json  | Exactly one JSON document | Only a serialization failure        |
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXIT_CODES, commandResult, diagnostic } from '@token-harness/core';

import { captureRun, WINDOWS_FIXTURE_PLATFORM } from '../src/index.js';

const BASE = {
  platform: WINDOWS_FIXTURE_PLATFORM,
  cwd: 'C:\\work\\demo',
  home: 'C:\\Users\\dev',
  stateRoot: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
  env: {},
  stdoutIsTty: false,
  toolVersion: '0.1.0',
} as const;

const noisyCommands = {
  doctor: () =>
    Promise.resolve(
      commandResult({
        command: 'doctor',
        exitCode: EXIT_CODES.ok,
        data: {
          platform: WINDOWS_FIXTURE_PLATFORM,
          harnesses: [],
          providers: [],
          problemCount: 0,
        },
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'harness-version-untested',
            message: 'claude 9.9.9 is newer than any tested version',
            remediation: 'Upgrade Token Harness',
          }),
        ],
      }),
    ),
  plan: () => Promise.reject(new Error('unused')),
  status: () => Promise.reject(new Error('unused')),
};

describe('stream discipline', () => {
  it('--json writes exactly one JSON document on stdout and nothing else', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctor', '--json'] });
    assert.equal(result.stderr, '');
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    // One document: a single terminating newline and no second parse target.
    assert.equal(result.stdout.endsWith('}\n'), true);
    assert.equal(result.stdout.trimEnd().split('\n}\n').length, 1);
  });

  it('--json keeps diagnostics in the envelope and off stderr', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor', '--json'],
      commands: noisyCommands,
    });
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as { diagnostics: unknown[] };
    assert.equal(envelope.diagnostics.length, 1);
  });

  it('human mode puts diagnostics on stderr and only the report on stdout', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctor'], commands: noisyCommands });
    assert.match(result.stderr, /harness-version-untested/);
    assert.doesNotMatch(result.stdout, /harness-version-untested/);
    assert.match(result.stdout, /^Token Harness 0\.1\.0 /);
  });

  it('a usage error emits a valid envelope when --json was given', async () => {
    const result = await captureRun({ ...BASE, argv: ['nope', '--json'] });
    assert.equal(result.exitCode, EXIT_CODES['usage-error']);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      exitCode: number;
      data: unknown;
      diagnostics: Array<{ code: string }>;
    };
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.exitCode, 2);
    assert.equal(envelope.data, null);
    assert.equal(envelope.diagnostics[0]?.code, 'unknown-command');
  });

  it('a usage error without --json writes plain text to stderr and nothing to stdout', async () => {
    const result = await captureRun({ ...BASE, argv: ['nope'] });
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unknown-command/);
    assert.throws(() => JSON.parse(result.stderr));
  });

  it('--help and --version write to stdout and exit 0 with an invalid command line', async () => {
    const help = await captureRun({ ...BASE, argv: ['--nonsense', '--help', 'garbage'] });
    assert.equal(help.exitCode, EXIT_CODES.ok);
    assert.equal(help.stderr, '');
    assert.match(help.stdout, /Usage/);

    const version = await captureRun({ ...BASE, argv: ['--nonsense', '--version'] });
    assert.equal(version.exitCode, EXIT_CODES.ok);
    assert.equal(version.stderr, '');
    assert.equal(version.stdout, '0.1.0\n');
  });

  it('--version --json emits an envelope rather than bare text', async () => {
    const result = await captureRun({ ...BASE, argv: ['--version', '--json'] });
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as { command: string; data: { version: string } };
    assert.equal(envelope.command, 'version');
    assert.equal(envelope.data.version, '0.1.0');
  });

  it('decoration is suppressed off a TTY, under NO_COLOR, and under --json', async () => {
    for (const argv of [['doctor'], ['doctor', '--json']]) {
      const result = await captureRun({ ...BASE, argv, env: { NO_COLOR: '1' }, stdoutIsTty: true });
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(result.stdout, /\u001b\[/);
    }
  });
});
