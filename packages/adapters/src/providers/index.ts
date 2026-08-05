/**
 * Provider adapter registry — PLAN §10.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { ProviderId } from '@token-harness/core';

import { harnesstrimAdapter } from './harnesstrim.js';
import { rtkAdapter } from './rtk.js';
import type { ProviderAdapter } from './contract.js';

export * from './contract.js';
export { rtkAdapter, parseRtkAnalytics, harnessesWiredToRtk } from './rtk.js';
export {
  compareCapabilities,
  harnesstrimAdapter,
  harnessesWiredToHarnessTrim,
  metricsLocations,
  synthesizeEventId,
  type HarnessTrimCapabilities,
  type HarnessTrimHarnessCapabilities,
} from './harnesstrim.js';

/**
 * RTK first, HarnessTrim second.
 *
 * Order is not arbitrary: RFC 0003's compatibility table gives RTK `shell.output.reduce` when both
 * claim it, and the resolver reads a `compatible` rule's provider order to pick the owner. The
 * conflict between these two is the one the shipped rule table names, so the order here is the
 * order that rule assumes.
 */
const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [rtkAdapter, harnesstrimAdapter];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
