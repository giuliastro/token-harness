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
 * The public HarnessTrim adapter keeps its direct skills-only planning surface for focused callers
 * and adapter tests. The CLI registry is narrower: an ordinary multi-provider `plan` must not let
 * a non-intercepting optional skills install expand a plan from the harnesses HarnessTrim actually
 * owns to every supported harness on the machine.
 *
 * This is the distinction the Windows brownfield case exposed: RTK owns Claude while HarnessTrim
 * owns Codex, yet `plansWithoutOwnership: true` made HarnessTrim also propose Claude skills. The
 * compatibility gate then turned that optional side action into a global unsupported-environment
 * error. Registry planning therefore passes only owned harnesses and requires ownership. An
 * explicitly focused HarnessTrim plan still obtains ownership when it is the selected provider;
 * if it obtains none, the CLI correctly has no integration to mutate.
 */
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

/**
 * RTK first, HarnessTrim second.
 *
 * Order is not arbitrary: RFC 0003's compatibility table gives RTK `shell.output.reduce` when both
 * claim it, and the resolver reads a `compatible` rule's provider order to pick the owner. The
 * conflict between these two is the one the shipped rule table names, so the order here is the
 * order that rule assumes.
 */
const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [rtkAdapter, cliHarnessTrimAdapter];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
