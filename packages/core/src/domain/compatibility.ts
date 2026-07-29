/**
 * Compatibility rules — RFC 0003 §Compatibility rule, verbatim.
 *
 * "No rule means conservative conflict for overlapping exclusive capabilities."
 * The lookup below therefore fails closed by construction: it returns a rule or
 * nothing, and the caller treats nothing as a conflict.
 */

import type { CapabilityId } from './capabilities.js';
import type { HarnessId, ProviderId } from './ids.js';

export interface CompatibilityRule {
  id: string;
  providers: ProviderId[];
  /** `"*"` means every harness; RFC 0003 §Rule keeps the harness dimension. */
  harnesses: HarnessId[] | '*';
  capabilities: CapabilityId[];
  outcome: 'compatible' | 'ordered' | 'conflict';
  /** Required when `outcome` is `ordered`. */
  order?: ProviderId[];
  testedVersions: Record<string, string>;
  rationale: string;
  fixtures: string[];
}

function coversHarness(rule: CompatibilityRule, harness: HarnessId): boolean {
  return rule.harnesses === '*' || rule.harnesses.includes(harness);
}

function coversProviders(rule: CompatibilityRule, providers: readonly ProviderId[]): boolean {
  return (
    rule.providers.length === providers.length &&
    providers.every((provider) => rule.providers.includes(provider))
  );
}

/**
 * Finds the rule that covers exactly this provider set on this harness for this
 * capability. Returns null when no rule covers it, which the resolver reads as a
 * hard conflict rather than as permission.
 */
export function findCompatibilityRule(
  rules: readonly CompatibilityRule[],
  query: { providers: readonly ProviderId[]; harness: HarnessId; capability: CapabilityId },
): CompatibilityRule | null {
  for (const rule of rules) {
    if (!rule.capabilities.includes(query.capability)) continue;
    if (!coversHarness(rule, query.harness)) continue;
    if (!coversProviders(rule, query.providers)) continue;
    return rule;
  }
  return null;
}

/** An `ordered` rule without an order is malformed data, not a permissive rule. */
export function isWellFormedRule(rule: CompatibilityRule): boolean {
  if (rule.outcome === 'ordered') {
    return Array.isArray(rule.order) && rule.order.length === rule.providers.length;
  }
  return rule.order === undefined;
}
