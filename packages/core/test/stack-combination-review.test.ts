import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fingerprintConfiguredStack,
  harnessId,
  providerId,
  selectStackCombinationReview,
  summarizeStackCombinationVerification,
  type HarnessId,
  type ProviderDetection,
  type ProviderId,
  type StackCombinationReviewRecord,
  type VerificationResult,
} from '../src/index.js';

const RTK = providerId('rtk');
const HARNESS_TRIM = providerId('harnesstrim');
const OTHER = providerId('other');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function detection(
  provider: ProviderId,
  version: string | null,
  harnesses = [CLAUDE],
  state: ProviderDetection['state'] = 'configured',
): ProviderDetection {
  return {
    providerId: provider,
    state,
    version,
    executable: `/tools/${provider}`,
    installationChannel: 'test',
    versionVerdict: version === null ? null : 'in-range',
    configuredHarnesses: state === 'configured' ? harnesses : [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: harnesses,
    evidence: [],
    warnings: [],
  };
}

function verification(
  provider: ProviderId,
  harness: HarnessId,
  options: {
    status?: VerificationResult['status'];
    declaredTier?: VerificationResult['declaredTier'];
    checkStatus?: VerificationResult['checks'][number]['status'];
    achievedTier?: VerificationResult['checks'][number]['achievedTier'];
    summary?: string;
  } = {},
): VerificationResult {
  const declaredTier = options.declaredTier ?? 'canary';
  return {
    providerId: provider,
    harnessId: harness,
    status: options.status ?? 'healthy',
    declaredTier,
    managedByTokenHarness: true,
    checks: [
      {
        id: 'canary',
        status: options.checkStatus ?? 'pass',
        summary: options.summary ?? 'Runtime canary observed.',
        achievedTier: options.achievedTier === undefined ? declaredTier : options.achievedTier,
        evidence: [],
        remediation: null,
      },
    ],
  };
}

function record(
  overrides: Partial<StackCombinationReviewRecord> = {},
): StackCombinationReviewRecord {
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

const configuredPair = () => [detection(RTK, '0.44.0'), detection(HARNESS_TRIM, '0.2.1')];

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

  it('projects passive runtime evidence onto the exact configured provider/harness pairs', () => {
    const fingerprint = fingerprintConfiguredStack([
      detection(HARNESS_TRIM, '0.1.0', [CODEX]),
      detection(RTK, '0.44.0', [CLAUDE]),
    ]);
    const evidence = summarizeStackCombinationVerification(fingerprint, [
      verification(RTK, CLAUDE, {
        declaredTier: 'canary',
        checkStatus: 'pass',
        achievedTier: 'canary',
        summary: '616 commands intercepted.',
      }),
      verification(HARNESS_TRIM, CODEX, {
        declaredTier: 'config-only',
        checkStatus: 'not-exercised',
        achievedTier: null,
        summary: 'No telemetry file yet.',
      }),
    ]);

    assert.deepEqual(evidence, [
      {
        providerId: HARNESS_TRIM,
        harnessId: CODEX,
        declaredTier: 'config-only',
        verificationStatus: 'healthy',
        runtimeEvidence: 'not-exercised',
        detail: 'No telemetry file yet.',
      },
      {
        providerId: RTK,
        harnessId: CLAUDE,
        declaredTier: 'canary',
        verificationStatus: 'healthy',
        runtimeEvidence: 'observed',
        detail: '616 commands intercepted.',
      },
    ]);
  });

  it('keeps failed or degraded passive verification visible for review', () => {
    const fingerprint = fingerprintConfiguredStack(configuredPair());
    const evidence = summarizeStackCombinationVerification(fingerprint, [
      verification(RTK, CLAUDE, {
        status: 'degraded',
        checkStatus: 'fail',
        achievedTier: null,
        summary: 'Hook verification failed.',
      }),
      verification(HARNESS_TRIM, CLAUDE, {
        declaredTier: 'config-only',
        achievedTier: 'config-only',
      }),
    ]);

    assert.equal(evidence[1]?.runtimeEvidence, 'failed');
    assert.equal(evidence[1]?.detail, 'Hook verification failed.');
  });

  it('fails closed when a configured pair has no passive verification result', () => {
    const fingerprint = fingerprintConfiguredStack(configuredPair());
    const evidence = summarizeStackCombinationVerification(fingerprint, [
      verification(RTK, CLAUDE),
    ]);

    assert.equal(evidence[0]?.providerId, HARNESS_TRIM);
    assert.equal(evidence[0]?.runtimeEvidence, 'unavailable');
    assert.match(evidence[0]?.detail ?? '', /No passive verification result/);
  });

  it('returns no verification projection when no exact fingerprint exists', () => {
    assert.deepEqual(summarizeStackCombinationVerification(null, []), []);
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
      selectStackCombinationReview([record()], [...configuredPair(), detection(OTHER, '1.0.0')]),
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
    assert.equal(fingerprintConfiguredStack([...configuredPair(), detection(RTK, '0.44.0')]), null);
  });

  it('fails closed when a configured provider version is unknown', () => {
    assert.equal(
      fingerprintConfiguredStack([detection(RTK, null), detection(HARNESS_TRIM, '0.2.1')]),
      null,
    );
  });

  it('rejects a malformed review record with duplicate provider ids', () => {
    assert.equal(
      selectStackCombinationReview(
        [record({ providerIds: [RTK, RTK, HARNESS_TRIM] })],
        configuredPair(),
      ),
      null,
    );
  });
});
