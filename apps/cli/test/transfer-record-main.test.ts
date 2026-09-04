import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCrossHarnessTransferReceipt,
  digestText,
  harnessId,
  type CrossHarnessTransferAssessment,
} from '@token-harness/core';

import { transferRecordMain } from '../src/transfer-record-main.js';
import type { TransferRecordResult } from '../src/transfer-runtime.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const RECORDED_AT = '2026-09-04T21:50:00.000Z';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function recorded(): TransferRecordResult {
  const assessment: CrossHarnessTransferAssessment = {
    benefit: 'proven-positive',
    basis: 'attempts',
    benchmarkId: 'transfer-hard-a',
    currentHarness: CLAUDE,
    candidateHarness: CODEX,
    handoffBytes: 700,
    maxHandoffBytes: 2048,
    reasons: ['switched run completed the quality-gated task in fewer attempts'],
  };
  return {
    status: 'recorded',
    receipt: buildCrossHarnessTransferReceipt({
      projectId: 'p_current',
      handoffDigest: digestText('handoff fixture'),
      recordedAt: RECORDED_AT,
      assessment,
      taskClass: 'hard',
    }),
    receiptPath: '/state/benchmarks/transfer-hard-a/transfer.json',
    reason: null,
  };
}

const args = ['--benchmark-id', 'transfer-hard-a', '--handoff-file', 'handoff.md'] as const;

describe('transfer-record CLI', () => {
  it('records one immutable project-scoped transfer receipt', async () => {
    const output = capture();
    let observedRecordedAt = '';
    const exitCode = await transferRecordMain(args, output.streams, {
      now: () => RECORDED_AT,
      recordEvidence: async (input) => {
        observedRecordedAt = input.recordedAt;
        return recorded();
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.equal(observedRecordedAt, RECORDED_AT);
    assert.match(output.stdout(), /Cross-harness transfer evidence recorded/);
    assert.match(output.stdout(), /Route: claude -> codex/);
    assert.match(output.stdout(), /Benefit: proven-positive/);
    assert.match(output.stdout(), /Handoff digest: sha256:/);
    assert.match(output.stdout(), /transfer\.json/);
  });

  it('emits the immutable receipt in the standard JSON envelope', async () => {
    const output = capture();
    const exitCode = await transferRecordMain([...args, '--json'], output.streams, {
      now: () => RECORDED_AT,
      recordEvidence: async () => recorded(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      data: { receipt: { benefit: string; handoffDigest: string }; receiptPath: string };
    };
    assert.equal(envelope.command, 'transfer-record');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.data.receipt.benefit, 'proven-positive');
    assert.match(envelope.data.receipt.handoffDigest, /^sha256:/);
  });

  it('refuses to overwrite an existing receipt as precondition drift', async () => {
    const output = capture();
    const exitCode = await transferRecordMain(args, output.streams, {
      recordEvidence: async () => ({
        status: 'exists',
        receipt: null,
        receiptPath: '/state/benchmarks/transfer-hard-a/transfer.json',
        reason: 'transfer evidence receipt already exists and is immutable',
      }),
    });

    assert.equal(exitCode, 5);
    assert.equal(output.stdout(), '');
    assert.match(output.stderr(), /transfer-record-exists/);
  });

  it('rejects malformed input without writing evidence', async () => {
    const output = capture();
    let writes = 0;
    const exitCode = await transferRecordMain(['--benchmark-id', 'INVALID'], output.streams, {
      recordEvidence: async () => {
        writes += 1;
        return recorded();
      },
    });

    assert.equal(exitCode, 2);
    assert.equal(writes, 0);
    assert.match(output.stderr(), /invalid-transfer-record-input/);
  });

  it('lets help and version win without touching local evidence', async () => {
    let writes = 0;
    const runtime = {
      recordEvidence: async () => {
        writes += 1;
        return recorded();
      },
    };

    const help = capture();
    assert.equal(await transferRecordMain(['--bad', '--help'], help.streams, runtime), 0);
    assert.match(help.stdout(), /token-harness transfer-record/);

    const version = capture();
    assert.equal(await transferRecordMain(['--bad', '--version'], version.streams, runtime), 0);
    assert.match(version.stdout(), /^0\.1\.5\n$/);
    assert.equal(writes, 0);
  });
});
