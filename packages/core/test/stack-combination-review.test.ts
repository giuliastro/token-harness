import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fingerprintConfiguredStack,
  harnessId,
  providerId,
  selectStackCombinationReview,
  type ProviderDetection,
  type ProviderId,
  type StackCombinationReviewRecord,
} from '../src/index.js';

const RTK = providerId('rtk');
const HARNESS_TRIM = providerId('harnesstrim');
const OTHER = providerId('other');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function detection(
  provider: ProviderId,
  version: string,
  harnesses = [CLAUDE],
  state: ProviderDetection['state'] = 'configured',
): ProviderDetection {
  return {
    providerId: provider,
    state,
    version,
    executable: `/tools/${provider}`,
    installationChannel: 'test',
    versionVerdict: 'in-range',
    configuredHarnesses: state === 'configured' ? harnesses : [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: harnesses,
    evidence: [],
    warnings: [],
  };
}

function record(overrides: Partial<StackCombinationReviewRecord> = {}): StackCombinationReviewRecord {
  return {
    providerIds: [RTK, HARNESS_TRIM],
    versions: { rtk: '0.44.0', harnesstrim: '0.2.1' },
    configuredHarnesses: { rtk: [CLAUDE], harnesstrim: [CLAUDE] },
    state: 'reviewed',
    detail: 'Reviewed together on the captured configuration.',
    evidence: ['review:test-fixture'],
    ...overrides,
  };
}

const configuredPair = () => [
  detection(RTK, '0.44.0'),
  detection(HARNESS_TRIM, '0.2.1'),
];

describe('combined-stack review records', () => {
  it('captures a stable exact fingerprint for configured providers only', () => {
    const fingerprint = fingerprintConfiguredStack([
      detection(HARNESS_TRIM, '0.2.1', [CODEX, CLAUDE]),
      detection(RTK, '0.44.0', [CLAUDE]),
      detection(OTHER, '1.0.0', [], 'installed'),
    ]);

    assert.deepEqual(fingerprint, {
      providerIds: [HARNESS_TRIM, RTK],
      versions: { harnesstrim: '0.2.1', rtk: '0.44.0' },
      configuredHarnesses: { harnesstrim: [CLAUDE, CODEX], rtk: [CLAUDE] },
    });
  });

  it('accepts only an exact provider/version/harness review', () => {
    const evidence = selectStackCombinationReview([record()], configuredPair());
    assert.deepEqual(evidence, {
      state: 'reviewed',
      providerIds: [HARNESS_TRIM, RTK],
      detail: 'Reviewed together on the captured configuration.',
      evidence: ['review:test-fixture'],
    });
  });

  it('rejects a stale review after a provider version changes', () => {
    assert.equal(
      selectStackCombinationReview(
        [record()],
        [detection(RTK, '0.45.0'), detection(HARNESS_TRIM, '0.2.1')],
      ),
      null,
    );
  });

  it('rejects a stale review after configured harnesses change', () => {
    assert.equal(
      selectStackCombinationReview(
        [record()],
        [detection(RTK, '0.44.0', [CLAUDE, CODEX]), detection(HARNESS_TRIM, '0.2.1')],
      ),
      null,
    );
  });

  it('rejects a review when another configured provider joins the stack', () => {
    assert.equal(
      selectStackCombinationReview(
        [record()],
        [...configuredPair(), detection(OTHER, '1.0.0')],
      ),
      null,
    );
  });

  it('preserves an explicit incompatible decision', () => {
    const evidence = selectStackCombinationReview(
      [record({ state: 'incompatible', detail: 'Conflict reproduced.' })],
      configuredPair(),
    );
    assert.equal(evidence?.state, 'incompatible');
    assert.equal(evidence?.detail, 'Conflict reproduced.');
  });

  it('keeps an empty registry unreviewed', () => {
    assert.equal(selectStackCombinationReview([], configuredPair()), null);
  });

  it('fails closed on duplicate configured detections', () => {
    assert.equal(
      fingerprintConfiguredStack([...configuredPair(), detection(RTK, '0.44.0')]),
      null,
    );
  });
});
