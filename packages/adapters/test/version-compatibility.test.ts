import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diagnostic, providerId, type ProviderDetection } from '@token-harness/core';

import {
  admitProviderPackageUpdate,
  applyProviderVersionCompatibility,
} from '../src/index.js';

const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');

function detection(
  provider: 'rtk' | 'harnesstrim',
  version: string,
  overrides: Partial<ProviderDetection> = {},
): ProviderDetection {
  return {
    providerId: providerId(provider),
    version,
    state: 'installed',
    executable: `C:\\tools\\${provider}.exe`,
    installationChannel: null,
    versionVerdict: 'unknown-newer',
    configuredHarnesses: [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: [],
    evidence: [],
    warnings: [],
    ...overrides,
  };
}

function unknownVersionWarning(version: string) {
  return diagnostic({
    severity: 'warning',
    code: 'provider-version-unknown-newer',
    message: `${version} is newer than the fixture-backed baseline`,
    remediation: 'Review the provider contract',
  });
}

function capabilitiesEvidence(version: string): ProviderDetection['evidence'][number] {
  return {
    kind: 'version-output',
    source: 'harnesstrim capabilities',
    path: 'C:\\tools\\harnesstrim.cmd',
    detail: `declared ${version} for claude, codex, opencode, hermes, pi, omp`,
  };
}

describe('provider version compatibility', () => {
  it('accepts source-reviewed RTK 0.49.0 and removes the stale newer-version warning', () => {
    const result = applyProviderVersionCompatibility(
      detection('rtk', '0.49.0', { warnings: [unknownVersionWarning('0.49.0')] }),
    );

    assert.equal(result.versionVerdict, 'in-range');
    assert.equal(
      result.warnings.some((warning) => warning.code === 'provider-version-unknown-newer'),
      false,
    );
  });

  it('keeps an unreviewed future RTK release visible as unknown-newer', () => {
    const result = applyProviderVersionCompatibility(
      detection('rtk', '0.50.0', { warnings: [unknownVersionWarning('0.50.0')] }),
    );

    assert.equal(result.versionVerdict, 'unknown-newer');
    assert.equal(result.warnings[0]?.code, 'provider-version-unknown-newer');
  });

  it('accepts HarnessTrim 0.3.0 when its installed capability contract agrees', () => {
    const result = applyProviderVersionCompatibility(
      detection('harnesstrim', '0.3.0', { evidence: [capabilitiesEvidence('0.3.0')] }),
    );

    assert.equal(result.versionVerdict, 'in-range');
  });

  it('can accept a later HarnessTrim release without another hard-coded version bump', () => {
    const result = applyProviderVersionCompatibility(
      detection('harnesstrim', '0.4.0', { evidence: [capabilitiesEvidence('0.4.0')] }),
    );

    assert.equal(result.versionVerdict, 'in-range');
  });

  it('does not accept HarnessTrim when executable and capabilities versions disagree', () => {
    const result = applyProviderVersionCompatibility(
      detection('harnesstrim', '0.4.0', { evidence: [capabilitiesEvidence('0.3.0')] }),
    );

    assert.equal(result.versionVerdict, 'unknown-newer');
  });

  it('does not accept HarnessTrim when the semantic capability comparison found drift', () => {
    const result = applyProviderVersionCompatibility(
      detection('harnesstrim', '0.4.0', {
        evidence: [capabilitiesEvidence('0.4.0')],
        warnings: [
          diagnostic({
            severity: 'warning',
            code: 'provider-capabilities-drift',
            subject: 'harnesstrim',
            message: 'the installed contract changed',
            remediation: 'Re-review the integration',
          }),
        ],
      }),
    );

    assert.equal(result.versionVerdict, 'unknown-newer');
  });
});

describe('provider package update admission', () => {
  it('admits the current reviewed RTK package target without a harness compatibility row', () => {
    assert.deepEqual(admitProviderPackageUpdate(RTK, '0.49.0'), { state: 'admitted' });
  });

  it('blocks a future RTK target until its consumed source contract is reviewed', () => {
    assert.equal(admitProviderPackageUpdate(RTK, '0.50.0').state, 'blocked');
  });

  it('admits the current reviewed HarnessTrim package target', () => {
    assert.deepEqual(admitProviderPackageUpdate(HARNESSTRIM, '0.3.0'), {
      state: 'admitted',
    });
  });

  it('keeps future HarnessTrim unattended package targets blocked before install-time validation', () => {
    assert.equal(admitProviderPackageUpdate(HARNESSTRIM, '0.4.0').state, 'blocked');
  });
});
