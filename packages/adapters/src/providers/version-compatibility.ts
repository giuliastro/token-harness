import { providerId, type ProviderDetection } from '@token-harness/core';

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
