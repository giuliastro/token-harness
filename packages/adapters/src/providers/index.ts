/**
 * Provider adapter registry — PLAN §10.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { ProviderId } from '@token-harness/core';

import { rtkAdapter } from './rtk.js';
import type { ProviderAdapter } from './contract.js';

export * from './contract.js';
export { rtkAdapter, parseRtkAnalytics, harnessesWiredToRtk } from './rtk.js';

/** HarnessTrim is Phase 6 and is deliberately not here yet. */
const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [rtkAdapter];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
