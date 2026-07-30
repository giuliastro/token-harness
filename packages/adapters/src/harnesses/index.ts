/**
 * Harness adapter registry — PLAN §3.1.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { HarnessId } from '@token-harness/core';

import { claudeAdapter } from './claude.js';
import type { HarnessAdapter } from './contract.js';

export * from './contract.js';
export { claudeAdapter } from './claude.js';
export { matcherCoversFamily } from './claude.js';

/**
 * Claude Code first, inverting PLAN §15 issue 10, which names Codex. The Phase 2.5 spike
 * reached tier 3 on Claude Code and could not declare a tier for Codex without writing to
 * the user's configuration, and writing an adapter against an undeclared verification
 * surface is what PLAN §4 puts the spike before the adapters to avoid.
 */
const HARNESS_ADAPTERS: readonly HarnessAdapter[] = [claudeAdapter];

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return HARNESS_ADAPTERS;
}

export function findHarnessAdapter(id: HarnessId): HarnessAdapter | null {
  return HARNESS_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
