import {
  compareVersions,
  parseSemanticVersion,
  providerId,
  type ProviderDetection,
  type ProviderId,
} from '@token-harness/core';

import type { ProviderAdapter } from './contract.js';

const RTK = providerId('rtk');
const HARNESSTRIM = providerId('harnesstrim');

/**
 * Provider releases whose external contract has been reviewed after the adapter's fixture-backed
 * baseline was recorded.
 *
 * RTK does not currently expose a machine-readable capability contract, so advancing its reviewed
 * ceiling remains an explicit source-contract decision. v0.49.0 keeps the `gain --all --format
 * json` analytics contract Token Harness consumes; later releases remain visible as
 * `unknown-newer` until their contract is reviewed.
 */
const SOURCE_REVIEWED_RTK_RELEASES = new Set(['0.49.0']);

/**
 * Package-update admission is intentionally separate from managed harness mutation admission.
 *
 * These ranges answer only whether Token Harness has reviewed enough of the provider package itself
 * to replace one installed release with another. They do not authorize writing Claude, Codex or
 * OpenCode configuration; those writes still require their exact compatibility rows.
 *
 * HarnessTrim can validate a newer *installed* build dynamically through `capabilities`, but an
 * updater has to decide before that build is installed. Until an install-and-verify transaction can
 * roll a contract mismatch back atomically, unattended updates stop at the latest reviewed target.
 */
const REVIEWED_PACKAGE_UPDATE_RANGES: ReadonlyMap<
  ProviderId,
  { minimum: string; maximum: string }
> = new Map([
  [RTK, { minimum: '0.44.0', maximum: '0.49.0' }],
  [HARNESSTRIM, { minimum: '0.0.5', maximum: '0.3.0' }],
]);

export type ProviderPackageUpdateAdmission =
  | { state: 'admitted' }
  | { state: 'blocked'; reason: string };

/**
 * Decide whether a provider package may be upgraded to `targetVersion`.
 *
 * This is deliberately provider-only: harness versions, OS rows and managed ownership do not
 * belong here because replacing the provider package does not itself mutate a harness. Exact
 * provider × harness × platform evidence remains mandatory when a later plan wants to edit those
 * harnesses.
 */
export function admitProviderPackageUpdate(
  provider: ProviderId,
  targetVersion: string,
): ProviderPackageUpdateAdmission {
  const range = REVIEWED_PACKAGE_UPDATE_RANGES.get(provider);
  if (range === undefined) {
    return { state: 'blocked', reason: `no package-update policy exists for ${provider}` };
  }

  const target = parseSemanticVersion(targetVersion);
  const minimum = parseSemanticVersion(range.minimum);
  const maximum = parseSemanticVersion(range.maximum);
  if (target === null || minimum === null || maximum === null) {
    return {
      state: 'blocked',
      reason: `${targetVersion} is not a parseable reviewed provider release`,
    };
  }

  if (compareVersions(target, minimum) < 0 || compareVersions(target, maximum) > 0) {
    return {
      state: 'blocked',
      reason: `${targetVersion} is outside the reviewed package-update range ${range.minimum}..${range.maximum}`,
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

/**
 * Promote a newer provider release only when Token Harness has evidence that its consumed contract
 * is still compatible.
 *
 * HarnessTrim is deliberately not pinned to a forever-growing version table. Newer builds are
 * accepted when the executable and `harnesstrim capabilities` report the same version and the
 * existing semantic surface/write-set comparison reports no drift. Managed mutation remains gated
 * independently by the reviewed write-set checks in the HarnessTrim adapter.
 *
 * RTK has no equivalent capability endpoint, so only explicitly source-reviewed releases are
 * promoted. This keeps future RTK releases usable for detection while refusing to silently claim a
 * contract Token Harness has not inspected.
 */
export function applyProviderVersionCompatibility(detection: ProviderDetection): ProviderDetection {
  if (detection.versionVerdict !== 'unknown-newer' || detection.version === null) return detection;

  const compatible =
    (detection.providerId === RTK && SOURCE_REVIEWED_RTK_RELEASES.has(detection.version)) ||
    (detection.providerId === HARNESSTRIM && harnessTrimContractMatchesInstalledVersion(detection));

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
