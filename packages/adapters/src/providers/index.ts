/**
 * Provider adapter registry.
 *
 * Empty at Phase 1 by design. RTK is Phase 5 and HarnessTrim is Phase 6; both
 * follow the RFC 0007 spike, per PLAN §15.
 */

import type { ProviderDetection, ProviderId, ProviderManifest } from '@token-harness/core';

/**
 * RFC 0002 §Adapter lifecycle declares five methods. Only `detect` is exposed
 * here: `inspect`, `plan`, `verify`, and `collectMetrics` need the planning,
 * process, and metrics contexts that Phase 2 introduces, and an interface that
 * names them before those types exist would be a placeholder, not a contract.
 */
export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  detect(context: ProviderDetectionContext): Promise<ProviderDetection>;
}

export interface ProviderDetectionContext {
  readonly projectRoot: string;
}

const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [];

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return PROVIDER_ADAPTERS;
}

export function findProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
