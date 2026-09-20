import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diagnostic, harnessId, providerId, type ProviderDetection } from '@token-harness/core';

import { admitProviderPackageUpdate, applyProviderVersionCompatibility } from '../src/index.js';

const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');
const MCPTOON = providerId('mcptoon');
const GITNEXUS = providerId('gitnexus');
const HEADROOM = providerId('headroom');
const CLAUDE = harnessId('claude');

function detection(
  provider: 'rtk' | 'harnesstrim' | 'mcptoon' | 'gitnexus' | 'headroom',
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
  it('accepts RTK 0.49.0 when the managed runtime surface is still assignable', () => {
    const result = applyProviderVersionCompatibility(
      detection('rtk', '0.49.0', {
        assignableHarnesses: [CLAUDE],
        warnings: [unknownVersionWarning('0.49.0')],
      }),
    );

    assert.equal(result.versionVerdict, 'in-range');
    assert.equal(
      result.warnings.some((warning) => warning.code === 'provider-version-unknown-newer'),
      false,
    );
  });

  it('keeps a future RTK release usable without another hard-coded version bump', () => {
    const result = applyProviderVersionCompatibility(
      detection('rtk', '0.50.0', {
        assignableHarnesses: [CLAUDE],
        warnings: [unknownVersionWarning('0.50.0')],
      }),
    );

    assert.equal(result.versionVerdict, 'in-range');
    assert.equal(
      result.warnings.some((warning) => warning.code === 'provider-version-unknown-newer'),
      false,
    );
  });

  it('promotes newer managed tools when their runtime capability surface is still available', () => {
    for (const provider of ['mcptoon', 'gitnexus', 'headroom'] as const) {
      const result = applyProviderVersionCompatibility(
        detection(provider, provider === 'gitnexus' ? '9.0.0' : '1.0.0', {
          assignableHarnesses: [CLAUDE],
          warnings: [unknownVersionWarning('future')],
        }),
      );
      assert.equal(result.versionVerdict, 'in-range', provider);
      assert.equal(
        result.warnings.some((warning) => warning.code === 'provider-version-unknown-newer'),
        false,
        provider,
      );
    }
  });

  it('does not promote a newer managed tool when its runtime capability probe fails', () => {
    const result = applyProviderVersionCompatibility(
      detection('mcptoon', '1.0.0', {
        assignableHarnesses: [],
        warnings: [
          diagnostic({
            severity: 'warning',
            code: 'mcptoon-provider-capability-unavailable',
            message: 'required flags are missing',
            remediation: null,
          }),
        ],
      }),
    );
    assert.equal(result.versionVerdict, 'unknown-newer');
  });

  it('accepts HarnessTrim 0.3.1 when its installed capability contract agrees', () => {
    const result = applyProviderVersionCompatibility(
      detection('harnesstrim', '0.3.1', { evidence: [capabilitiesEvidence('0.3.1')] }),
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

  it('admits future RTK targets and relies on post-install runtime verification', () => {
    assert.deepEqual(admitProviderPackageUpdate(RTK, '0.50.0'), { state: 'admitted' });
  });

  it('admits the current reviewed HarnessTrim 0.3.1 package target', () => {
    assert.deepEqual(admitProviderPackageUpdate(HARNESSTRIM, '0.3.1'), {
      state: 'admitted',
    });
  });

  it('admits future HarnessTrim targets because the update transaction validates the installed contract', () => {
    assert.deepEqual(admitProviderPackageUpdate(HARNESSTRIM, '0.4.0'), {
      state: 'admitted',
    });
  });

  it('admits future managed-tool package targets for runtime verification after install', () => {
    assert.deepEqual(admitProviderPackageUpdate(MCPTOON, '9.0.0'), { state: 'admitted' });
    assert.deepEqual(admitProviderPackageUpdate(GITNEXUS, '9.0.0'), { state: 'admitted' });
    assert.deepEqual(admitProviderPackageUpdate(HEADROOM, '9.0.0'), { state: 'admitted' });
  });
});
