import {
  classifyVersion,
  type ProviderDetection,
  type TestedVersionRange,
} from '@token-harness/core';

import type { ProviderAdapter, ProviderContext } from './contract.js';

/**
 * Current stable upstream releases deliberately reviewed for the provider-facing CLI contract.
 *
 * This policy is intentionally separate from the exact managed-mutation compatibility matrix.
 * A provider release can remain CLI-compatible and therefore be recognised here while still
 * requiring a real provider × harness × platform fixture before Token Harness may mutate that
 * integration automatically.
 */
export const CURRENT_PROVIDER_RELEASES = {
  rtk: '0.49.0',
  harnesstrim: '0.3.0',
} as const;

export const CURRENT_PROVIDER_VERSION_RANGES = {
  rtk: { minimum: '0.44.0', maximum: CURRENT_PROVIDER_RELEASES.rtk },
  harnesstrim: { minimum: '0.0.5', maximum: CURRENT_PROVIDER_RELEASES.harnesstrim },
} as const satisfies Readonly<
  Record<keyof typeof CURRENT_PROVIDER_RELEASES, TestedVersionRange>
>;

/**
 * Apply the central provider release policy at the registry boundary.
 *
 * Provider adapters retain their historical observations internally; the registry is the product
 * boundary used by doctor, plan, verify, update and the guided UI. Keeping the current upstream
 * release here prevents those commands from drifting because one adapter-local literal was not
 * refreshed. Exact mutation permission remains governed by COMPATIBILITY_ROWS.
 */
export function withCurrentProviderVersionPolicy(
  adapter: ProviderAdapter,
  range: TestedVersionRange,
): ProviderAdapter {
  return {
    ...adapter,
    detect: async (context: ProviderContext): Promise<ProviderDetection> => {
      const detection = await adapter.detect(context);
      return {
        ...detection,
        versionVerdict:
          detection.version === null
            ? null
            : classifyVersion(detection.version, range),
      };
    },
  };
}
