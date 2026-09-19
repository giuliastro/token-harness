import {
  compareVersions,
  parseSemanticVersion,
  providerId,
  type ProviderDetection,
  type ProviderId,
} from '@token-harness/core';

import type { ProviderAdapter } from './contract.js';
import { GITNEXUS_REVIEWED_BENCHMARK_VERSION } from './gitnexus-candidate.js';
import { HEADROOM_REVIEWED_BENCHMARK_VERSION } from './headroom-candidate.js';
import { MCPTOON_REVIEWED_BENCHMARK_VERSION } from './mcptoon-candidate.js';

const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');
const MCPTOON = providerId('mcptoon');
const GITNEXUS = providerId('gitnexus');
const HEADROOM = providerId('headroom');

/**
 * Historical package baselines.
 *
 * These ranges record releases Token Harness has directly exercised. They are evidence, not a
 * ceiling. Normal package updates are latest-forward: a newer semantic version may be installed
 * transactionally and must then pass post-install detection against the executable actually
 * resolved on PATH. Providers with runtime capability probes are rejected after installation when
 * those probes no longer expose the managed surface.
 */
const PACKAGE_UPDATE_BASELINES: ReadonlyMap<ProviderId, { minimum: string; maximum: string }> =
  new Map([
    [RTK, { minimum: '0.44.0', maximum: '0.49.0' }],
    [HARNESSTRIM, { minimum: '0.0.5', maximum: '0.3.0' }],
    [
      MCPTOON,
      { minimum: MCPTOON_REVIEWED_BENCHMARK_VERSION, maximum: MCPTOON_REVIEWED_BENCHMARK_VERSION },
    ],
    [
      GITNEXUS,
      {
        minimum: GITNEXUS_REVIEWED_BENCHMARK_VERSION,
        maximum: GITNEXUS_REVIEWED_BENCHMARK_VERSION,
      },
    ],
    [
      HEADROOM,
      {
        minimum: HEADROOM_REVIEWED_BENCHMARK_VERSION,
        maximum: HEADROOM_REVIEWED_BENCHMARK_VERSION,
      },
    ],
  ]);

export type ProviderPackageUpdateAdmission =
  | { state: 'admitted' }
  | { state: 'blocked'; reason: string };

/**
 * Newest directly exercised package release. Kept for historical evidence/reporting only; callers
 * must not treat this as a forward-compatibility ceiling.
 */
export function reviewedProviderPackageMaximum(provider: ProviderId): string | null {
  return PACKAGE_UPDATE_BASELINES.get(provider)?.maximum ?? null;
}

/**
 * Decide whether a provider package may be upgraded to `targetVersion`.
 *
 * A known provider is admitted when the target is a parseable semantic version at or above its
 * supported floor. The transaction must still verify the exact active executable after install and
 * reject/rollback when the runtime capability surface no longer matches what Token Harness needs.
 */
export function admitProviderPackageUpdate(
  provider: ProviderId,
  targetVersion: string,
): ProviderPackageUpdateAdmission {
  const range = PACKAGE_UPDATE_BASELINES.get(provider);
  if (range === undefined) {
    return { state: 'blocked', reason: `no package-update policy exists for ${provider}` };
  }

  const target = parseSemanticVersion(targetVersion);
  const minimum = parseSemanticVersion(range.minimum);
  if (target === null || minimum === null) {
    return {
      state: 'blocked',
      reason: `${targetVersion} is not a parseable provider release`,
    };
  }

  if (compareVersions(target, minimum) < 0) {
    return {
      state: 'blocked',
      reason: `${targetVersion} predates the supported provider update floor ${range.minimum}`,
    };
  }

  return { state: 'admitted' };
}

function harnessTrimContractMatchesInstalledVersion(detection: ProviderDetection): boolean {
  const version = detection.version;
  if (version === null) return false;

  const declaredByInstalledBuild = detection.evidence.some(
    (item) =>
      item.source === 'harnesstrim capabilities' &&
      item.detail.startsWith(`declared ${version} for `),
  );
  const capabilityDrift = detection.warnings.some(
    (warning) => warning.code === 'provider-capabilities-drift',
  );

  return declaredByInstalledBuild && !capabilityDrift;
}

function runtimeManagedSurfaceStillAvailable(detection: ProviderDetection): boolean {
  if (detection.state === 'broken' || detection.assignableHarnesses.length === 0) return false;
  return !detection.warnings.some(
    (warning) =>
      /capabilit/i.test(warning.code) &&
      /(unavailable|drift|mismatch|unsupported)/i.test(warning.code),
  );
}

/**
 * Promote newer releases from historical evidence to runtime-compatible when the installed build
 * still exposes the managed surface Token Harness needs.
 *
 * HarnessTrim has the strongest contract and is checked against its machine-readable capability,
 * write-set and artifact declarations. mcptoon, GitNexus and Headroom are checked through their
 * read-only CLI capability probes. RTK's managed mutation is produced by Token Harness itself and
 * remains forward-usable while the adapter can still detect a runnable build and its assignable
 * harness surface. Historical benchmark evidence remains exact-version elsewhere.
 */
export function applyProviderVersionCompatibility(detection: ProviderDetection): ProviderDetection {
  if (detection.versionVerdict !== 'unknown-newer' || detection.version === null) return detection;

  const compatible =
    detection.providerId === HARNESSTRIM
      ? harnessTrimContractMatchesInstalledVersion(detection)
      : [RTK, MCPTOON, GITNEXUS, HEADROOM].includes(detection.providerId) &&
        runtimeManagedSurfaceStillAvailable(detection);

  if (!compatible) return detection;

  return {
    ...detection,
    versionVerdict: 'in-range',
    warnings: detection.warnings.filter(
      (warning) => warning.code !== 'provider-version-unknown-newer',
    ),
  };
}

/** Keep version policy outside provider algorithms so compatibility can advance without forks. */
export function withProviderVersionCompatibility(adapter: ProviderAdapter): ProviderAdapter {
  return {
    ...adapter,
    detect: async (context) => applyProviderVersionCompatibility(await adapter.detect(context)),
  };
}
