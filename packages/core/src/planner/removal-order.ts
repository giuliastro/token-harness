/**
 * Provider removal ordering for an applied pipeline.
 *
 * RFC 0003 gives an ordered chain concrete `ResolvedCapability.order` values. Installation runs
 * from the lower order to the higher one; removal must walk that dependency in reverse. Independent
 * providers have no semantic dependency, so their relative order is deliberately only a stable
 * tie-breaker.
 */

import { formatCapabilityScope, type ResolvedCapability } from '../domain/capabilities.js';
import type { ProviderId } from '../domain/ids.js';

export type ProviderRemovalOrder =
  | { ok: true; order: ProviderId[] }
  | {
      ok: false;
      reason: 'ambiguous-recorded-order' | 'dependency-cycle';
      providers: ProviderId[];
    };

function uniqueProviders(values: readonly ProviderId[]): ProviderId[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Computes a provider-level topological order for uninstall.
 *
 * An edge `later -> earlier` means "remove the later chain member before the earlier one".
 * Exact scope is used rather than only capability/channel: the resolver records `order` on that
 * scope, and widening the edge beyond what the receipt proved would invent a dependency.
 */
export function providerRemovalOrder(
  ownership: readonly ResolvedCapability[],
  candidates: readonly ProviderId[],
): ProviderRemovalOrder {
  const nodes = uniqueProviders(candidates);
  const nodeSet = new Set(nodes);
  if (nodes.length < 2) return { ok: true, order: nodes };

  const byScope = new Map<string, ResolvedCapability[]>();
  for (const entry of ownership) {
    if (entry.mode !== 'chainable' || !nodeSet.has(entry.owner)) continue;
    const key = formatCapabilityScope(entry.scope);
    const group = byScope.get(key) ?? [];
    group.push(entry);
    byScope.set(key, group);
  }

  const edges = new Map<ProviderId, Set<ProviderId>>();
  const indegree = new Map<ProviderId, number>(nodes.map((provider) => [provider, 0]));

  const addEdge = (before: ProviderId, after: ProviderId): void => {
    if (before === after) return;
    const outgoing = edges.get(before) ?? new Set<ProviderId>();
    if (outgoing.has(after)) return;
    outgoing.add(after);
    edges.set(before, outgoing);
    indegree.set(after, (indegree.get(after) ?? 0) + 1);
  };

  for (const group of byScope.values()) {
    const providerOrders = new Map<ProviderId, Set<number>>();
    const orderProviders = new Map<number, Set<ProviderId>>();

    for (const entry of group) {
      const orders = providerOrders.get(entry.owner) ?? new Set<number>();
      orders.add(entry.order);
      providerOrders.set(entry.owner, orders);

      const providers = orderProviders.get(entry.order) ?? new Set<ProviderId>();
      providers.add(entry.owner);
      orderProviders.set(entry.order, providers);
    }

    const ambiguous = new Set<ProviderId>();
    for (const [provider, orders] of providerOrders) {
      if (orders.size > 1) ambiguous.add(provider);
    }
    for (const providers of orderProviders.values()) {
      if (providers.size > 1) {
        for (const provider of providers) ambiguous.add(provider);
      }
    }
    if (ambiguous.size > 0) {
      return {
        ok: false,
        reason: 'ambiguous-recorded-order',
        providers: uniqueProviders([...ambiguous]),
      };
    }

    const chain = [...providerOrders.entries()]
      .map(([provider, orders]) => ({
        provider,
        order: [...orders][0] ?? 0,
      }))
      .sort((left, right) => left.order - right.order);

    // Install: A -> B -> C. Uninstall dependency: C -> B -> A.
    for (let index = chain.length - 1; index > 0; index -= 1) {
      const later = chain[index];
      const earlier = chain[index - 1];
      if (later !== undefined && earlier !== undefined) {
        addEdge(later.provider, earlier.provider);
      }
    }
  }

  const ready = nodes
    .filter((provider) => (indegree.get(provider) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));
  const ordered: ProviderId[] = [];

  while (ready.length > 0) {
    const provider = ready.shift();
    if (provider === undefined) break;
    ordered.push(provider);

    for (const dependent of [...(edges.get(provider) ?? [])].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== nodes.length) {
    return {
      ok: false,
      reason: 'dependency-cycle',
      providers: nodes.filter((provider) => (indegree.get(provider) ?? 0) > 0),
    };
  }

  return { ok: true, order: ordered };
}
