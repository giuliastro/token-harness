import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestText,
  harnessId,
  hydrateTransferBenefitFromReceipts,
  type CrossHarnessSchedulerInput,
  type CrossHarnessTransferReceipt,
  type TransferBenefitState,
} from '@token-harness/core';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function input(benefit: TransferBenefitState = 'unknown'): CrossHarnessSchedulerInput {
  return {
    taskClass: 'hard',
    current: {
      harnessId: CLAUDE,
      available: true,
      fiveHourPace: 'over-pace',
      weeklyPace: 'on-pace',
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    candidate: {
      harnessId: CODEX,
      available: true,
      fiveHourPace: 'under-pace',
      weeklyPace: 'on-pace',
      quality: 'passed',
      qualityTaskClass: 'hard',
      qualitySamples: 1,
    },
    transfer: { handoffBytes: 700, maxHandoffBytes: 2048, benefit },
  };
}

function receipt(
  benchmarkId: string,
  benefit: TransferBenefitState,
  overrides: Partial<CrossHarnessTransferReceipt> = {},
): CrossHarnessTransferReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    projectId: 'p_current',
    taskClass: 'hard',
    currentHarness: CLAUDE,
    candidateHarness: CODEX,
    handoffBytes: 700,
    handoffDigest: digestText(`# ${benchmarkId}`),
    maxHandoffBytes: 2048,
    benefit,
    basis: benefit === 'non-positive' ? 'handoff-budget' : 'quality',
    reasons: ['fixture evidence'],
    recordedAt: '2026-09-05T04:00:00.000Z',
    ...overrides,
  };
}

describe('cross-harness transfer receipt hydration', () => {
  it('hydrates proven-positive only when every attributable receipt agrees', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input(), [
      receipt('hard-a', 'proven-positive'),
      receipt('hard-b', 'proven-positive'),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'proven-positive');
    assert.equal(hydrated.notes[0]?.code, 'transfer-evidence-positive');
    assert.equal(hydrated.notes[0]?.samples, 2);
  });

  it('hydrates non-positive only when every attributable receipt agrees', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input(), [
      receipt('hard-a', 'non-positive'),
      receipt('hard-b', 'non-positive'),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'non-positive');
    assert.equal(hydrated.notes[0]?.code, 'transfer-evidence-non-positive');
  });

  it('keeps known plus unknown evidence unknown instead of dropping uncertainty', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input(), [
      receipt('hard-a', 'proven-positive'),
      receipt('hard-b', 'unknown'),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'unknown');
    assert.equal(hydrated.notes[0]?.code, 'transfer-evidence-inconclusive');
  });

  it('keeps directly conflicting evidence unknown', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input(), [
      receipt('hard-a', 'proven-positive'),
      receipt('hard-b', 'non-positive'),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'unknown');
    assert.equal(hydrated.notes[0]?.code, 'transfer-evidence-conflicting');
  });

  it('ignores other routes and task classes', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input(), [
      receipt('reverse', 'proven-positive', {
        currentHarness: CODEX,
        candidateHarness: CLAUDE,
      }),
      receipt('standard', 'proven-positive', { taskClass: 'standard' }),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'unknown');
    assert.equal(hydrated.notes[0]?.code, 'transfer-evidence-unavailable');
    assert.equal(hydrated.notes[0]?.samples, 0);
  });

  it('preserves an already explicit non-unknown verdict', () => {
    const hydrated = hydrateTransferBenefitFromReceipts(input('non-positive'), [
      receipt('hard-a', 'proven-positive'),
    ]);

    assert.equal(hydrated.input.transfer.benefit, 'non-positive');
    assert.equal(hydrated.notes[0]?.code, 'explicit-transfer-benefit-preserved');
  });
});
