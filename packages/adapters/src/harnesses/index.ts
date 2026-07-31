/**
 * Harness adapter registry — PLAN §3.1.
 *
 * The contract lives in `contract.ts`; this file is only the list, so an adapter can
 * import the contract without importing the list it appears in.
 */

import type { HarnessId } from '@token-harness/core';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import type { HarnessAdapter } from './contract.js';

export * from './contract.js';
export { claudeAdapter } from './claude.js';
export { codexAdapter } from './codex.js';
export { opencodeAdapter } from './opencode.js';
export { matcherCoversFamily } from './claude.js';

/**
 * Claude Code first, inverting PLAN §15 issue 10, which names Codex. The Phase 2.5 spike
 * reached tier 3 on Claude Code and could not declare a tier for Codex without writing to
 * the user's configuration, and writing an adapter against an undeclared verification
 * surface is what PLAN §4 puts the spike before the adapters to avoid.
 *
 * Codex and OpenCode follow, both at `config-only`. Neither can be verified further: Codex
 * keeps hook enablement in state no adapter can read, and OpenCode's reducing plugin is a
 * generated wrapper with no externally observable receipt. Registering them at the tier they
 * can actually reach is the point — PLAN §2 criterion 1 asks that all three be *detected*,
 * not that all three be provable.
 */
const HARNESS_ADAPTERS: readonly HarnessAdapter[] = [claudeAdapter, codexAdapter, opencodeAdapter];

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return HARNESS_ADAPTERS;
}

export function findHarnessAdapter(id: HarnessId): HarnessAdapter | null {
  return HARNESS_ADAPTERS.find((adapter) => adapter.manifest.id === id) ?? null;
}
