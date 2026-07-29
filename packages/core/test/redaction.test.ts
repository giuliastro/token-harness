/**
 * Redaction — RFC 0004 §Process policy and §Credentials.
 *
 * Table-driven, because the interesting content of a secret-name pattern is the
 * near misses: `PWD` is a working directory and `SESSIONNAME` is a terminal, and a
 * pattern that redacts either is a pattern that will be turned off.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MINIMUM_REDACTABLE_LENGTH,
  REDACTED,
  formatDisplayCommand,
  isSecretEnvName,
  redactArguments,
  redactEnvironmentForDisplay,
  redactText,
  redactionPolicy,
  secretValuesIn,
} from '../src/index.js';

const SECRET_NAMES: readonly string[] = [
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'SSH_KEY',
  'MY_PASSWORD',
  'PASSWD',
  'DB_PASSPHRASE',
  'AZURE_CREDENTIALS',
  'XDG_SESSION_ID',
  'HTTP_COOKIE',
  'AUTHORIZATION',
  'SERVICE_AUTH_TOKEN',
  'PRIVATE_KEY',
  'KEY',
];

const PUBLIC_NAMES: readonly string[] = [
  'PWD',
  'OLDPWD',
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'SESSIONNAME',
  'SSH_AUTH_SOCK',
  'KEYBOARD_LAYOUT',
  'MONKEY',
  'XDG_STATE_HOME',
  'SystemRoot',
  'NODE_ENV',
];

describe('secret-name patterns', () => {
  for (const name of SECRET_NAMES) {
    it(`redacts ${name}`, () => {
      assert.equal(isSecretEnvName(name), true);
    });
  }

  for (const name of PUBLIC_NAMES) {
    it(`does not redact ${name}`, () => {
      assert.equal(isSecretEnvName(name), false);
    });
  }

  it('keeps the key and drops the value, because the presence of a credential is itself diagnostic', () => {
    const display = redactEnvironmentForDisplay({
      GITHUB_TOKEN: 'ghp_deadbeefdeadbeef',
      PATH: '/usr/bin',
      UNSET: undefined,
    });
    assert.deepEqual(display, { GITHUB_TOKEN: REDACTED, PATH: '/usr/bin' });
  });

  it('collects secret values for the runner to strip from captured output', () => {
    assert.deepEqual(secretValuesIn({ NPM_TOKEN: 'npm_abcdefgh', PATH: '/usr/bin' }), [
      'npm_abcdefgh',
    ]);
  });

  it('ignores values too short to replace safely', () => {
    const short = 'a'.repeat(MINIMUM_REDACTABLE_LENGTH - 1);
    assert.deepEqual(secretValuesIn({ NPM_TOKEN: short }), []);
    assert.equal(
      redactText(`x${short}y`, redactionPolicy({ secretValues: [short] })),
      `x${short}y`,
    );
  });
});

describe('value redaction', () => {
  it('replaces a declared value wherever it appears', () => {
    const policy = redactionPolicy({ secretValues: ['s3cret-value'] });
    assert.equal(
      redactText('error: token s3cret-value rejected (s3cret-value)', policy),
      `error: token ${REDACTED} rejected (${REDACTED})`,
    );
  });

  it('treats a value as literal text, not as a pattern', () => {
    const policy = redactionPolicy({ secretValues: ['a.*b'] });
    assert.equal(redactText('axxxb and a.*b', policy), `axxxb and ${REDACTED}`);
  });

  it('redacts the longer value first when one contains the other', () => {
    const policy = redactionPolicy({ secretValues: ['abcd', 'abcdefgh'] });
    assert.equal(redactText('abcdefgh', policy), REDACTED);
  });
});

describe('argument redaction', () => {
  const policy = redactionPolicy({ secretValues: [] });

  it('redacts the value after a secret flag', () => {
    assert.deepEqual(redactArguments(['login', '--token', 'abc123'], policy), [
      'login',
      '--token',
      REDACTED,
    ]);
  });

  it('redacts the inline form too', () => {
    assert.deepEqual(redactArguments(['login', '--token=abc123'], policy), [
      'login',
      `--token=${REDACTED}`,
    ]);
  });

  it('leaves an ordinary value after an ordinary flag', () => {
    assert.deepEqual(redactArguments(['add', '--filter', 'core'], policy), [
      'add',
      '--filter',
      'core',
    ]);
  });

  it('matches a secret flag case-insensitively', () => {
    assert.deepEqual(redactArguments(['--Password', 'hunter2'], policy), ['--Password', REDACTED]);
  });
});

describe('display command', () => {
  it('quotes what a reader needs quoted and nothing else', () => {
    assert.equal(
      formatDisplayCommand(
        'C:\\Program Files\\rtk\\rtk.exe',
        ['gain', '--format', 'json'],
        redactionPolicy(),
      ),
      '"C:\\Program Files\\rtk\\rtk.exe" gain --format json',
    );
  });

  it('shows an empty argument rather than losing it', () => {
    assert.equal(formatDisplayCommand('rtk', [''], redactionPolicy()), 'rtk ""');
  });

  it('never leaks a secret into the displayed form', () => {
    const policy = redactionPolicy({ secretValues: ['ghp_deadbeef'] });
    const shown = formatDisplayCommand(
      'gh',
      ['auth', 'login', '--with-token', 'ghp_deadbeef'],
      policy,
    );
    assert.ok(!shown.includes('ghp_deadbeef'), shown);
    assert.ok(shown.includes(REDACTED), shown);
  });
});
