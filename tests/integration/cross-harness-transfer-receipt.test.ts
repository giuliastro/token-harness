import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCrossHarnessTransferReceipt,
  digestText,
  harnessId,
  parseCrossHarnessTransferReceipt,
  type CrossHarnessTransferAssessment,
} from '@token-harness/core';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function assessment(): CrossHarnessTransferAssessment {
  return {
    benefit: 'proven-positive',
    basis: 'failed-attempts',
    benchmarkId: 'transfer-hard-a',
    currentHarness: CLAUDE,
    candidateHarness: CODEX,
    handoffBytes: 512,
    maxHandoffBytes: 2048,
    reasons: ['switched run reached the quality gate with fewer failed attempts'],
  };
}

test('builds and parses one project-scoped immutable transfer receipt', () => {
  const receipt = buildCrossHarnessTransferReceipt({
    projectId: 'p_current',
    handoffDigest: digestText('# Compact handoff\n'),
    recordedAt: '2026-09-04T21:50:00.000Z',
    assessment: assessment(),
    taskClass: 'hard',
  });

  const parsed = parseCrossHarnessTransferReceipt(receipt);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.benchmarkId, 'transfer-hard-a');
  assert.equal(parsed.receipt.projectId, 'p_current');
  assert.equal(parsed.receipt.currentHarness, CLAUDE);
  assert.equal(parsed.receipt.candidateHarness, CODEX);
  assert.equal(parsed.receipt.handoffBytes, 512);
  assert.match(parsed.receipt.handoffDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(parsed.receipt.benefit, 'proven-positive');
  assert.equal(parsed.receipt.basis, 'failed-attempts');
});

test('rejects a transfer receipt with a forged digest or same-harness route', () => {
  const valid = buildCrossHarnessTransferReceipt({
    projectId: 'p_current',
    handoffDigest: digestText('handoff'),
    recordedAt: '2026-09-04T21:50:00.000Z',
    assessment: assessment(),
    taskClass: 'hard',
  });

  const badDigest = parseCrossHarnessTransferReceipt({ ...valid, handoffDigest: 'sha256:nope' });
  assert.equal(badDigest.ok, false);
  if (!badDigest.ok) assert.equal(badDigest.reason, 'invalid-shape');

  const sameHarness = parseCrossHarnessTransferReceipt({ ...valid, candidateHarness: CLAUDE });
  assert.equal(sameHarness.ok, false);
  if (!sameHarness.ok) assert.equal(sameHarness.reason, 'invalid-shape');
});

test('rejects unsupported transfer receipt schema versions', () => {
  const valid = buildCrossHarnessTransferReceipt({
    projectId: 'p_current',
    handoffDigest: digestText('handoff'),
    recordedAt: '2026-09-04T21:50:00.000Z',
    assessment: assessment(),
    taskClass: 'hard',
  });
  const parsed = parseCrossHarnessTransferReceipt({ ...valid, schemaVersion: 2 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, 'unsupported-schema');
});
