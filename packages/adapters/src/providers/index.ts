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
export {
  HEADROOM_MINIMUM_BENCHMARK_VERSION,
  headroomVersionAtLeast,
  observeHeadroomCandidate,
  parseHeadroomVersion,
  parseHeadroomWrapTargets,
  type HeadroomCandidateObservation,
  type HeadroomCandidateState,
} from './headroom-candidate.js';
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

const cliHarnessTrimAdapter: ProviderAdapter = {
  ...harnesstrimAdapter,
  plansWithoutOwnership: false,
  plan: (context, request) => {
    const ownedHarnesses = new Set(request.ownership.map((entry) => entry.scope.harness));
    return harnesstrimAdapter.plan(context, {
      ...request,
      harnesses: request.harnesses.filter((harness) => ownedHarnesses.has(harness.id)),
    });
  },
};

const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [rtkAdapter, cliHarnessTrimAdapter];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
