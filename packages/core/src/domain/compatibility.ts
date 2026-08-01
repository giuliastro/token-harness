/**
 * Compatibility rules — RFC 0003 §Compatibility rule, verbatim.
 *
 * "No rule means conservative conflict for overlapping exclusive capabilities."
 * The lookup below therefore fails closed by construction: it returns a rule or
 * nothing, and the caller treats nothing as a conflict.
 */

import type { CapabilityId } from './capabilities.js';
import type { HarnessId, ProviderId } from './ids.js';
import { compareVersions, parseSemanticVersion, type SemanticVersion } from './version.js';

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

/**
 * Whether a version the rule was tested at still speaks for the version now installed.
 *
 * RFC 0004 §Amended: "Major" is the wrong test: below `1.0.0` semver promises nothing across a
 * minor or patch bump, so coverage there is exact equality; at or above it, a major is the unit
 * of compatibility. Nothing wider, because a tested range is a record of what was exercised and
 * not a prediction.
 *
 * Both shipped providers are `0.x`, which is precisely why the `major` test the RFC first named
 * could not fire for either of them.
 */
function coversVersion(recorded: SemanticVersion, observed: SemanticVersion): boolean {
  if (recorded.major === 0 || observed.major === 0)
    return compareVersions(recorded, observed) === 0;
  return recorded.major === observed.major;
}

/** One provider whose installed version has left what the rule records. */
export interface StaleRecordedVersion {
  provider: string;
  recorded: string;
  /** Null when the version could not be established at all, which is also not covered. */
  observed: string | null;
}

/**
 * Which of a rule's recorded versions no longer describe the machine.
 *
 * A `CompatibilityRule` has always carried `testedVersions`, and until now nothing read it:
 * `findCompatibilityRule` matches providers, harness and capability, so a rule tested at one
 * version kept applying at every later one, silently. RFC 0004 §Amended records the case that
 * exposed it — HarnessTrim `0.0.6` against a rule declaring `0.0.5`, deciding which provider owns
 * shell reduction, with nothing said.
 *
 * A provider the rule does not name is not consulted, and a provider the caller has no version
 * for is *not* covered: an unknown version cannot be inside a tested range, and treating it as
 * inside is the assumption this function exists to remove.
 */
export function staleRecordedVersions(
  rule: CompatibilityRule,
  observed: Readonly<Record<string, string | null>>,
): StaleRecordedVersion[] {
  const stale: StaleRecordedVersion[] = [];
  for (const [provider, recorded] of Object.entries(rule.testedVersions)) {
    const seen = observed[provider] ?? null;
    const recordedVersion = parseSemanticVersion(recorded);
    const seenVersion = seen === null ? null : parseSemanticVersion(seen);
    if (
      recordedVersion !== null &&
      seenVersion !== null &&
      coversVersion(recordedVersion, seenVersion)
    ) {
      continue;
    }
    stale.push({ provider, recorded, observed: seen });
  }
  return stale;
}
