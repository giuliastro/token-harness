/**
 * Every exit code in the RFC 0006 table has a test that produces it.
 *
 * PLAN §1.3 acceptance. Codes reachable from the Phase 1 command surface are
 * produced end to end through `run()`; the rest are produced through the same
 * result → envelope → exit pipeline that `run()` uses, because the commands
 * that raise them (`apply`, `rollback`, `uninstall`) do not exist yet and a test
 * that faked one would be asserting the fake.
 *
 * Which is which is recorded per code, so nothing here silently claims more
 * coverage than it has.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXIT_CODES,
  EXIT_CODE_TABLE,
  commandResult,
  diagnostic,
  serializeEnvelope,
  statusForExitCode,
  toEnvelope,
  type ExitCodeName,
} from '@token-harness/core';

import { captureRun, WINDOWS_FIXTURE_PLATFORM, LINUX_FIXTURE_PLATFORM } from '../src/index.js';

const BASE = {
  platform: WINDOWS_FIXTURE_PLATFORM,
  cwd: 'C:\\work\\demo',
  home: 'C:\\Users\\dev',
  stateRoot: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
  env: {},
  stdoutIsTty: false,
  toolVersion: '0.1.0',
} as const;

/** Codes an end-to-end `run()` invocation can produce in this build. */
const produced = new Set<ExitCodeName>();

describe('exit codes', () => {
  it('0 — an empty environment is a state, not a problem', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctor'] });
    assert.equal(result.exitCode, EXIT_CODES.ok);
    produced.add('ok');
  });

  it('0 — plan over an empty registry also exits 0', async () => {
    const result = await captureRun({ ...BASE, argv: ['plan'] });
    assert.equal(result.exitCode, EXIT_CODES.ok);
  });

  it('0 — status on a machine with nothing applied exits 0', async () => {
    const result = await captureRun({ ...BASE, argv: ['status'] });
    assert.equal(result.exitCode, EXIT_CODES.ok);
  });

  it('1 — an unexpected failure inside a command', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor'],
      commands: {
        doctor: () => Promise.reject(new Error('boom')),
        plan: () => Promise.reject(new Error('unused')),
        metrics: () => Promise.reject(new Error('unused')),
        apply: () => Promise.reject(new Error('unused')),
        status: () => Promise.reject(new Error('unused')),
      },
    });
    assert.equal(result.exitCode, EXIT_CODES['internal-error']);
    assert.match(result.stderr, /internal-error/);
    produced.add('internal-error');
  });

  it('2 — an unknown command', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctr'] });
    assert.equal(result.exitCode, EXIT_CODES['usage-error']);
    assert.match(result.stderr, /unknown-command/);
    produced.add('usage-error');
  });

  it('2 — an unknown flag', async () => {
    const result = await captureRun({ ...BASE, argv: ['doctor', '--verbose'] });
    assert.equal(result.exitCode, EXIT_CODES['usage-error']);
    assert.match(result.stderr, /unknown-flag/);
  });

  it('2 — a declared but unimplemented command is not reported as a typo', async () => {
    // `apply` used to be the example here. It is implemented now, so the case moved to a command
    // RFC 0001 declares and this build still does not carry.
    const result = await captureRun({ ...BASE, argv: ['rollback'] });
    assert.equal(result.exitCode, EXIT_CODES['usage-error']);
    assert.match(result.stderr, /command-not-available/);
  });

  it('3 — a broken integration', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor'],
      commands: {
        doctor: () =>
          Promise.resolve(
            commandResult({
              command: 'doctor',
              exitCode: EXIT_CODES['problems-found'],
              data: null,
              diagnostics: [
                diagnostic({
                  severity: 'error',
                  code: 'harness-config-unreadable',
                  message: 'The claude settings file could not be parsed',
                  remediation: 'Repair the JSON syntax',
                }),
              ],
            }),
          ),
        plan: () => Promise.reject(new Error('unused')),
        metrics: () => Promise.reject(new Error('unused')),
        apply: () => Promise.reject(new Error('unused')),
        status: () => Promise.reject(new Error('unused')),
      },
    });
    assert.equal(result.exitCode, EXIT_CODES['problems-found']);
    produced.add('problems-found');
  });

  it('4 — a hard conflict blocks the plan', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['plan'],
      commands: {
        doctor: () => Promise.reject(new Error('unused')),
        plan: () =>
          Promise.resolve(
            commandResult({
              command: 'plan',
              exitCode: EXIT_CODES['blocked-by-conflict'],
              data: null,
            }),
          ),
        status: () => Promise.reject(new Error('unused')),
        metrics: () => Promise.reject(new Error('unused')),
        apply: () => Promise.reject(new Error('unused')),
      },
    });
    assert.equal(result.exitCode, EXIT_CODES['blocked-by-conflict']);
    produced.add('blocked-by-conflict');
  });

  it('9 — a runtime below the supported floor', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['doctor'],
      platform: { ...LINUX_FIXTURE_PLATFORM, nodeVersion: '22.12.0' },
    });
    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.match(result.stderr, /unsupported-node-version/);
    produced.add('unsupported-environment');
  });

  it('9 — `--help` does not paper over an unsupported runtime', async () => {
    const result = await captureRun({
      ...BASE,
      argv: ['--help'],
      platform: { ...LINUX_FIXTURE_PLATFORM, nodeVersion: '20.19.0' },
    });
    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
  });

  // Codes 5, 6, 7, and 8 are raised by the transaction engine and by mutating
  // commands, neither of which exists at Phase 1. They are produced here through
  // the same pipeline `run()` uses, so the envelope, the derived status, and the
  // process exit code are all asserted for them.
  const pipelineOnly: ExitCodeName[] = [
    'precondition-drift',
    'apply-failed-rolled-back',
    'apply-failed-dirty',
    'confirmation-required',
  ];

  for (const name of pipelineOnly) {
    it(`${EXIT_CODES[name]} — ${name}, through the result pipeline`, () => {
      const result = commandResult({
        command: 'apply',
        exitCode: EXIT_CODES[name],
        data: { placeholder: true },
        diagnostics: [diagnostic({ severity: 'error', code: name, message: `simulated ${name}` })],
      });
      const envelope = toEnvelope(result, '0.1.0');
      assert.equal(envelope.exitCode, EXIT_CODES[name]);
      assert.equal(envelope.status, statusForExitCode(EXIT_CODES[name]));
      assert.doesNotThrow(() => serializeEnvelope(envelope));
      produced.add(name);
    });
  }

  it('produces every code in the RFC 0006 table', () => {
    for (const entry of EXIT_CODE_TABLE) {
      assert.ok(
        produced.has(entry.name),
        `no test produced exit code ${entry.code} (${entry.name})`,
      );
    }
  });
});
