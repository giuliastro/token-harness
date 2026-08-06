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
  /**
   * RFC 0003 §Rule §Amended (PLAN §15 item 46) adds `narrowed`.
   *
   * The first three answer "may these two share this capability, and in what order". `narrowed`
   * answers a question the pair could not express before: *neither* shares it — one keeps the
   * channel and the other installs the reduced form its own flags produce. It is not `conflict`,
   * because nothing is blocked and there is nothing for the user to resolve; it is not `ordered`,
   * because the two never both run on the payload.
   *
   * It exists because the alternative was to keep telling a user running HarnessTrim `0.1.0` that
   * "its installer cannot produce this in isolation" — true of `0.0.5` and false of the build in
   * front of them — or to hand them a hard conflict where the honest answer is that one tool
   * reduces and the other installs its skills.
   */
  outcome: 'compatible' | 'ordered' | 'conflict' | 'narrowed';
  /** Required when `outcome` is `ordered`. */
  order?: ProviderId[];
  /**
   * Required when `outcome` is `narrowed`: the provider that keeps the channel.
   *
   * Named in the rule rather than derived, for the reason the order is. "RTK keeps shell reduction"
   * is a reviewed decision about a pair, and a resolver that picked a winner by some property of
   * the providers would be making that decision silently and differently as providers changed.
   */
  retains?: ProviderId;
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

/**
 * An `ordered` rule without an order is malformed data, not a permissive rule. A `narrowed` rule
 * without a `retains` naming one of its own providers is the same kind of malformed: it would
 * decide that someone keeps the channel without saying who.
 */
export function isWellFormedRule(rule: CompatibilityRule): boolean {
  if (rule.outcome === 'ordered') {
    return (
      Array.isArray(rule.order) &&
      rule.order.length === rule.providers.length &&
      rule.retains === undefined
    );
  }
  if (rule.outcome === 'narrowed') {
    return (
      rule.order === undefined &&
      rule.retains !== undefined &&
      rule.providers.includes(rule.retains)
    );
  }
  return rule.order === undefined && rule.retains === undefined;
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
