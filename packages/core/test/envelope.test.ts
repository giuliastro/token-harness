import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENVELOPE_SCHEMA_VERSION,
  EXIT_CODE_TABLE,
  commandResult,
  diagnostic,
  serializeEnvelope,
  statusForExitCode,
  toEnvelope,
} from '../src/index.js';

describe('CliEnvelope', () => {
  it('derives status from the exit code for every code in the table', () => {
    const expected: Record<number, string> = {
      0: 'ok',
      1: 'error',
      2: 'error',
      3: 'problems',
      4: 'blocked',
      5: 'blocked',
      6: 'error',
      7: 'error',
      8: 'error',
      9: 'error',
    };
    for (const entry of EXIT_CODE_TABLE) {
      assert.equal(statusForExitCode(entry.code), expected[entry.code], `code ${entry.code}`);
    }
  });

  it('derives status for a code outside the table as error', () => {
    assert.equal(statusForExitCode(42), 'error');
  });

  it('emits the RFC key order', () => {
    const envelope = toEnvelope(
      commandResult({ command: 'doctor', exitCode: 0, data: { ok: true } }),
      '0.1.0',
    );
    assert.deepEqual(Object.keys(envelope), [
      'schemaVersion',
      'command',
      'toolVersion',
      'status',
      'exitCode',
      'data',
      'diagnostics',
    ]);
  });

  it('nulls data when the status is error', () => {
    const envelope = toEnvelope(
      commandResult({ command: 'doctor', exitCode: 1, data: { leaked: true } }),
      '0.1.0',
    );
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.data, null);
  });

  it('keeps data for blocked and problems', () => {
    for (const code of [3, 4, 5] as const) {
      const envelope = toEnvelope(
        commandResult({ command: 'plan', exitCode: code, data: { kept: true } }),
        '0.1.0',
      );
      assert.deepEqual(envelope.data, { kept: true });
    }
  });

  it('carries diagnostics for any status', () => {
    const envelope = toEnvelope(
      commandResult({
        command: 'doctor',
        exitCode: 0,
        data: null,
        diagnostics: [diagnostic({ severity: 'info', code: 'note', message: 'a note' })],
      }),
      '0.1.0',
    );
    assert.equal(envelope.diagnostics.length, 1);
    assert.deepEqual(Object.keys(envelope.diagnostics[0] as object), [
      'severity',
      'code',
      'message',
      // RFC 0006 §JSON envelope, amended: the human rendering is one line per diagnostic and needs
      // to say which harness or provider each is about.
      'subject',
      'path',
      'remediation',
    ]);
  });

  it('serializes to one document with exactly one terminating newline', () => {
    const text = serializeEnvelope(
      toEnvelope(commandResult({ command: 'doctor', exitCode: 0, data: null }), '0.1.0'),
    );
    assert.equal(text.endsWith('}\n'), true);
    assert.equal(text.endsWith('}\n\n'), false);
    assert.equal(JSON.parse(text).schemaVersion, ENVELOPE_SCHEMA_VERSION);
  });

  it('round trips through JSON without losing a field', () => {
    const envelope = toEnvelope(
      commandResult({
        command: 'plan',
        exitCode: 4,
        data: { planId: null, conflicts: [] },
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'exclusive-scope-contested',
            message: 'contested',
            path: '/tmp/settings.json',
            remediation: 'pick an owner',
          }),
        ],
      }),
      '0.1.0',
    );
    assert.deepEqual(JSON.parse(serializeEnvelope(envelope)), envelope);
  });
});
