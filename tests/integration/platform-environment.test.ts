/**
 * The platform layer as the CLI sees it — PLAN §2.1 acceptance.
 *
 * "An unresolvable `%LOCALAPPDATA%` fails with the unsupported-environment code
 * instead of falling back to a world-writable location", and RFC 0006 §Global flags
 * requires `--help` and `--version` to keep exiting 0.
 *
 * The last describe block asserts the property on the *real* machine this test is
 * running on, for all three CI platforms. It performs no filesystem access: path
 * resolution is pure, so the assertion is about the environment rather than about a
 * directory the test would have to create.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { describe, it } from 'node:test';

import { EXIT_CODES, diagnostic, type PlatformFacts } from '@token-harness/core';
import { detectPlatform, resolvePlatformPaths, type SystemProbe } from '@token-harness/platform';

import { captureRun, WINDOWS_FIXTURE_PLATFORM } from '../src/index.js';

const BASE = {
  cwd: 'C:\\work\\demo',
  home: 'C:\\Users\\dev',
  env: {},
  stdoutIsTty: false,
  toolVersion: '0.1.0',
} as const;

const UNRESOLVABLE = [
  diagnostic({
    severity: 'error',
    code: 'state-path-unresolvable',
    message:
      '%LOCALAPPDATA% is not set to an absolute path, so the Token Harness state directory cannot be located',
    remediation: 'Set %LOCALAPPDATA% to your per-user application data directory',
  }),
];

describe('an unresolvable state directory', () => {
  for (const command of ['doctor', 'plan', 'status']) {
    it(`makes \`${command}\` exit 9 rather than falling back to a writable directory`, async () => {
      const result = await captureRun({
        ...BASE,
        argv: [command],
        platform: WINDOWS_FIXTURE_PLATFORM,
        stateRoot: null,
        environmentDiagnostics: UNRESOLVABLE,
      });
      assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
      assert.match(result.stderr, /state-path-unresolvable/);
      assert.equal(result.stdout, '');
    });
  }

  it('reports it inside the envelope under --json', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor', '--json'],
      platform: WINDOWS_FIXTURE_PLATFORM,
      stateRoot: null,
      environmentDiagnostics: UNRESOLVABLE,
    });
    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as {
      status: string;
      exitCode: number;
      diagnostics: { code: string }[];
    };
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.exitCode, EXIT_CODES['unsupported-environment']);
    assert.equal(envelope.diagnostics[0]?.code, 'state-path-unresolvable');
  });

  it('still lets --help and --version work, because neither needs the state directory', async () => {
    for (const flag of ['--help', '--version']) {
      const result = await captureRun({
        ...BASE,
        argv: [flag],
        platform: WINDOWS_FIXTURE_PLATFORM,
        stateRoot: null,
        environmentDiagnostics: UNRESOLVABLE,
      });
      assert.equal(result.exitCode, EXIT_CODES.ok, flag);
      assert.notEqual(result.stdout, '');
    }
  });

  it('does not turn a usage error into an environment error', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctr'],
      platform: WINDOWS_FIXTURE_PLATFORM,
      stateRoot: null,
      environmentDiagnostics: UNRESOLVABLE,
    });
    // The command line is wrong regardless of what the machine looks like.
    assert.equal(result.exitCode, EXIT_CODES['usage-error']);
  });

  it('ignores a warning, which is not a reason to refuse to run', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor'],
      platform: WINDOWS_FIXTURE_PLATFORM,
      stateRoot: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
      environmentDiagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'state-directory-inheritance-not-blocked',
          message: 'The state directory inherits permissions from its parent',
        }),
      ],
    });
    assert.equal(result.exitCode, EXIT_CODES.ok);
  });
});

describe('an unsupported operating system', () => {
  it('exits 9 before anything else, including --help', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['--help'],
      platform: null,
      stateRoot: null,
      environmentDiagnostics: [
        diagnostic({
          severity: 'error',
          code: 'unsupported-operating-system',
          message: 'Token Harness supports Windows, macOS, and Linux',
        }),
      ],
    });
    // Unlike an unresolvable state directory, there is no version of this program
    // that runs correctly here, so a usage page would imply otherwise.
    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.match(result.stderr, /unsupported-operating-system/);
  });

  it('produces a diagnostic even when the caller supplied none', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctor'], platform: null, stateRoot: null });
    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.match(result.stderr, /unsupported-operating-system/);
  });
});

describe('this machine', () => {
  /**
   * A probe built from the real environment, with no filesystem access at all:
   * `readTextFile` returns null and the home directory comes from the environment
   * rather than from `node:os`. AGENTS.md forbids a test reading the developer's
   * actual home, and the architecture test enforces it by name.
   */
  const probe: SystemProbe = {
    platform: process.platform,
    arch: process.arch,
    release: '',
    version: '',
    nodeVersion: process.versions.node,
    env: process.env,
    homeDirectory: process.env['HOME'] ?? process.env['USERPROFILE'] ?? null,
    temporaryDirectory: tmpdir(),
    readTextFile: () => null,
  };

  it('is one of the three supported operating systems', () => {
    const detection = detectPlatform(probe);
    assert.ok(detection.ok, 'CI runs Windows, macOS, and Linux');
  });

  it('resolves a state root outside the system temporary directory, or refuses to resolve one', () => {
    const detection = detectPlatform(probe);
    assert.ok(detection.ok);
    const facts: PlatformFacts = detection.facts;
    const resolution = resolvePlatformPaths({
      facts,
      env: probe.env,
      home: probe.homeDirectory,
      temporaryDirectory: probe.temporaryDirectory,
    });

    if (!resolution.ok) {
      // A machine that cannot say where its per-user data lives is unsupported, and
      // saying so is the required behaviour — not a fallback.
      assert.ok(
        resolution.diagnostics.every((entry) => entry.severity === 'error'),
        'a resolution failure is an error, never a warning',
      );
      return;
    }

    const state = resolution.paths.state;
    const temp = tmpdir();
    const insensitive = facts.os === 'windows' && !facts.isWsl;
    const normalized = insensitive ? state.toLowerCase() : state;
    const normalizedTemp = insensitive ? temp.toLowerCase() : temp;
    assert.ok(
      !normalized.startsWith(normalizedTemp),
      `the state root ${state} must not be inside ${temp}`,
    );

    const expectedLeaf = facts.os === 'linux' ? 'token-harness' : 'TokenHarness';
    assert.ok(state.endsWith(expectedLeaf), `${state} should end with ${expectedLeaf}`);
  });
});
