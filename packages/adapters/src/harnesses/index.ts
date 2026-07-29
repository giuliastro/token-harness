/**
 * Harness adapter registry.
 *
 * Empty at Phase 1 by design. PLAN §1.3: "Implement the contract in RFC 0006 in
 * full, even where the underlying registries are still empty." Codex, Claude
 * Code, and OpenCode adapters land in Phase 3, after the RFC 0007 spike fixes
 * the verification surface they are written against.
 */

import type { HarnessDetection, HarnessId, HarnessManifest } from '@token-harness/core';

/**
 * The detection half of the harness contract. The configuration, planning, and
 * verification halves are deliberately absent until RFC 0007 exists (PLAN §2.5),
 * because guessing them here is what the spike is scheduled to prevent.
 */
export interface HarnessAdapter {
  readonly manifest: HarnessManifest;
  detect(context: HarnessDetectionContext): Promise<HarnessDetection>;
}

/**
 * Everything an adapter is allowed to read. Phase 2 fills it with the platform
 * abstraction and the process runner; until then it carries only the project
 * root, so no adapter can quietly reach for `node:fs`.
 */
export interface HarnessDetectionContext {
  readonly projectRoot: string;
}

const HARNESS_ADAPTERS: readonly HarnessAdapter[] = [];

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return HARNESS_ADAPTERS;
}

export function findHarnessAdapter(id: HarnessId): HarnessAdapter | null {
  return HARNESS_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
