/**
 * The static capability resolver — RFC 0003 §Scope of the resolver at 0.1.0.
 *
 * The RFC is explicit that this is deliberately small, and about why:
 *
 * > `0.1.0` ships two providers, and the ownership policy for that pair is already known
 * > and written below. A general resolution engine built now would be designed against one
 * > data point.
 *
 * So there are four things here and no solver:
 *
 * 1. a static compatibility-rule table, committed as data (`rules.ts`);
 * 2. exclusive-scope ownership resolved by lookup in that table;
 * 3. fail-closed on any overlapping exclusive scope not covered by a rule;
 * 4. a pipeline ID derived from the ordered owner list.
 *
 * ## Fail-closed is the property, not the machinery
 *
 * "No rule means conservative conflict for overlapping exclusive capabilities." That is
 * load-bearing and it is why this module has no default resolution path: when two providers
 * claim one exclusive scope and no rule names the pair, the result is a `HardConflict` that
 * blocks apply. There is no force flag — RFC 0003 §Profiles: "An unsafe overlap requires a
 * named compatibility rule, never a generic force flag."
 *
 * ## Two gates before a claim is even considered
 *
 * RFC 0003 §Rule states both, and both reject rather than warn:
 *
 * - **demonstrated capability.** "An ownership assignment requires a demonstrated capability
 *   at the assigned scope on the assigned harness, evidenced in the provider's own source at
 *   a recorded version." A declaration with no evidence is not a weaker claim; it is not a
 *   claim. So `evidence: null` is dropped, with a recorded exclusion.
 * - **a producible target state.** "A capability the provider has but cannot be asked for is
 *   not an assignable capability." This one cannot be derived from a manifest — it is a fact
 *   about an installer — so it arrives as `assignable` on the input and is checked here.
 */

import {
  formatCapabilityScope,
  surfaceCoversToolFamily,
  type CapabilityDeclaration,
  type CapabilityExclusion,
  type CapabilityId,
  type CapabilityScope,
  type CompositionMode,
  type ResolvedCapability,
} from '../domain/capabilities.js';
import {
  findCompatibilityRule,
  staleRecordedVersions,
  type CompatibilityRule,
} from '../domain/compatibility.js';
import { digestText } from '../domain/digest.js';
import type { HarnessId, ProviderId } from '../domain/ids.js';
import type { HarnessManifest } from '../domain/manifest.js';
import type { HardConflict, ProfileId } from '../domain/plan.js';

/** A provider as the resolver sees it. */
export interface ResolverProvider {
  id: ProviderId;
  capabilities: readonly CapabilityDeclaration[];
  /**
   * Whether Token Harness can actually bring about the assignment — RFC 0003 §Resolution at
   * 0.1.0. HarnessTrim `0.0.5` is the case: it has the capability and its installer cannot be
   * asked for a narrowed state, so under `safe` it "is not installed by Token Harness at
   * all". It is still detected, adopted, reconciled, and measured; it is simply not an owner.
   */
  assignable: boolean;
}

/** What a `custom` profile assigned explicitly. */
export interface CustomAssignment {
  provider: ProviderId;
  owns: readonly CapabilityId[];
}

export interface ResolveInput {
  profile: ProfileId;
  /** The harnesses actually present, with their surfaces. */
  harnesses: readonly HarnessManifest[];
  providers: readonly ResolverProvider[];
  rules: readonly CompatibilityRule[];
  /**
   * The provider versions actually installed, by provider id, for checking a rule against what
   * it was tested at — RFC 0004 §Amended: "Major" is the wrong test.
   *
   * Required rather than optional, deliberately. An optional field here would be a loophole: a
   * caller that omitted it would get the old behaviour, in which a rule tested at one version
   * kept applying at every later one and said nothing. A null entry, or an absent one, means the
   * version could not be established — which is a valid input and is not treated as coverage.
   */
  observedVersions: Readonly<Record<string, string | null>>;
  /**
   * Required when `profile` is `custom`; ignored otherwise. RFC 0003: "`custom` is explicit
   * assignment."
   */
  assignments?: readonly CustomAssignment[];
  /**
   * Restricts the resolution to one harness, for `--harness`. Null covers every harness.
   */
  harness?: HarnessId | null;
}

export interface ResolutionResult {
  ownership: ResolvedCapability[];
  exclusions: CapabilityExclusion[];
  conflicts: HardConflict[];
  /**
   * RFC 0003 §Scope of the resolver at 0.1.0 item 4: derived from the ordered owner list,
   * "because metrics attribution depends on it". Null when nothing was resolved — a pipeline
   * with no owners is not a pipeline, and an identifier for it would appear in metrics as if
   * it were.
   */
  pipelineId: string | null;
}

/** One provider's claim on one scope, after the two gates. */
interface Claim {
  provider: ProviderId;
  mode: CompositionMode;
}

/**
 * The pipeline ID — a digest over the ordered owner list.
 *
 * Ordered, and that is the point: RFC 0003 makes the ID the attribution key, and two
 * installations that run the same providers in a different order are different pipelines
 * producing differently attributable savings. Sorting the input here would make the two
 * indistinguishable and silently merge their metrics.
 *
 * The scope is included with each owner, so moving one provider from one surface to another
 * is also a different pipeline.
 */
export function derivePipelineId(ownership: readonly ResolvedCapability[]): string | null {
  if (ownership.length === 0) return null;
  const material = ownership
    .map((entry) => `${formatCapabilityScope(entry.scope)}=${entry.owner}@${String(entry.order)}`)
    .join('\n');
  const digest = digestText(material);
  // Short enough to appear in a report and in a receipt without wrapping; RFC 0006's
  // transcripts show `pipeline b41e`.
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 5);
}

/**
 * Every scope the present harnesses actually expose.
 *
 * Enumerated from the harness manifests rather than from what providers claim, so a claim on
 * a surface the harness does not have resolves to nothing instead of inventing the surface.
 */
function scopesFor(harness: HarnessManifest, capability: CapabilityId): CapabilityScope[] {
  const scopes: CapabilityScope[] = [];
  for (const family of harness.toolFamilies) {
    for (const point of harness.interceptionPoints) {
      scopes.push({
        harness: harness.id,
        toolFamily: family.id,
        interceptionPoint: point.scopeId,
        capability,
      });
    }
  }
  return scopes;
}

function declarationCoversScope(
  declaration: CapabilityDeclaration,
  scope: CapabilityScope,
): boolean {
  if (!declaration.harnesses.includes(scope.harness)) return false;
  return declaration.surfaces.some(
    (surface) =>
      surface.interceptionPoint === scope.interceptionPoint &&
      surfaceCoversToolFamily(surface, scope.toolFamily),
  );
}

/**
 * Resolves ownership.
 *
 * The shape of the loop matters for acceptance: one pass per scope, and within a scope the
 * only ways out are exactly one owner, an ordered chain, or a conflict.
 * There is no branch that assigns two exclusive owners, which is what makes the property
 * test in `tests/` a check on the code rather than on a convention.
 */
export function resolveOwnership(input: ResolveInput): ResolutionResult {
  const ownership: ResolvedCapability[] = [];
  const exclusions: CapabilityExclusion[] = [];
  const conflicts: HardConflict[] = [];

  const harnesses = input.harnesses.filter(
    (harness) => input.harness == null || harness.id === input.harness,
  );

  // `custom` narrows what each provider may own; `safe` lets every declaration stand and
  // relies on `assignable` plus the rule table. RFC 0003: `balanced` is absent, and there is
  // no third branch here for it.
  const allowed = new Map<ProviderId, ReadonlySet<CapabilityId>>();
  if (input.profile === 'custom') {
    for (const assignment of input.assignments ?? []) {
      allowed.set(assignment.provider, new Set(assignment.owns));
    }
  }

  const capabilities = new Set<CapabilityId>();
  for (const provider of input.providers) {
    for (const declaration of provider.capabilities) capabilities.add(declaration.capability);
  }

  for (const harness of harnesses) {
    for (const capability of [...capabilities].sort()) {
      for (const scope of scopesFor(harness, capability)) {
        const claims: Claim[] = [];

        for (const provider of input.providers) {
          const declaration = provider.capabilities.find(
            (entry) => entry.capability === capability,
          );
          if (declaration === undefined) continue;
          if (!declarationCoversScope(declaration, scope)) continue;

          // RFC 0003 §Observational capabilities are outside this model. An observer transforms
          // no payload, so there is nothing for ownership to arbitrate, and the address above
          // names an interception point that observation does not have. Silently: no exclusion
          // is recorded, because nothing was excluded — the capability was never a candidate.
          if (declaration.mode === 'observational') continue;

          // Gate one: RFC 0003 §Rule. Unevidenced is not a weaker claim, it is none.
          if (declaration.evidence === null) {
            exclusions.push({
              scope,
              excluded: provider.id,
              retained: null,
              reason: [
                `${provider.id} declares ${capability} on ${harness.id} without evidence in its own source at a recorded version`,
                'RFC 0003 requires a demonstrated capability at the assigned scope; an unevidenced assignment is a planning error',
              ],
            });
            continue;
          }

          // Gate two: RFC 0003 §Resolution at 0.1.0. A capability that cannot be asked for
          // is not assignable.
          if (!provider.assignable) {
            exclusions.push({
              scope,
              excluded: provider.id,
              retained: null,
              reason: [
                `${provider.id} implements ${capability} but no installer state produces it in isolation`,
                'RFC 0003: a capability the provider has but cannot be asked for is not an assignable capability',
                'It is still detected, adopted, reconciled against the owner, and measured',
              ],
            });
            continue;
          }

          if (input.profile === 'custom') {
            const owns = allowed.get(provider.id);
            if (owns === undefined || !owns.has(capability)) {
              exclusions.push({
                scope,
                excluded: provider.id,
                retained: null,
                reason: [`the custom profile does not assign ${capability} to ${provider.id}`],
              });
              continue;
            }
          }

          claims.push({ provider: provider.id, mode: declaration.mode });
        }

        if (claims.length === 0) continue;

        if (claims.length === 1) {
          const only = claims[0] as Claim;
          ownership.push({ scope, owner: only.provider, mode: only.mode, order: 0 });
          continue;
        }

        resolveContested({
          scope,
          claims,
          harness,
          capability,
          input,
          ownership,
          exclusions,
          conflicts,
        });
      }
    }
  }

  // Retained providers are only knowable once a scope is resolved, so the back-reference is
  // filled in here rather than guessed at the point of exclusion.
  const ownerByScope = new Map(
    ownership.map((entry) => [formatCapabilityScope(entry.scope), entry.owner]),
  );
  for (const exclusion of exclusions) {
    if (exclusion.retained !== null) continue;
    const retained = ownerByScope.get(formatCapabilityScope(exclusion.scope));
    if (retained !== undefined) exclusion.retained = retained;
  }

  return { ownership, exclusions, conflicts, pipelineId: derivePipelineId(ownership) };
}

interface ContestedInput {
  scope: CapabilityScope;
  claims: readonly Claim[];
  harness: HarnessManifest;
  capability: CapabilityId;
  input: ResolveInput;
  ownership: ResolvedCapability[];
  exclusions: CapabilityExclusion[];
  conflicts: HardConflict[];
}

/**
 * More than one provider claims the scope.
 *
 * Every claim that reaches here is exclusive or chainable: observational declarations were
 * dropped before becoming candidates, per RFC 0003 §Observational capabilities are outside this
 * model. So a contested scope needs a rule, and no rule means conflict.
 */
function resolveContested(context: ContestedInput): void {
  const { scope, claims, capability, input, ownership, exclusions, conflicts } = context;
  const claimants = claims.map((claim) => claim.provider);

  const found = findCompatibilityRule(input.rules, {
    providers: claimants,
    harness: scope.harness,
    capability,
  });

  /**
   * A rule speaks only for the versions it records — RFC 0004 §Amended: "Major" is the wrong test,
   * and nothing performs even that one.
   *
   * Withdrawing the rule rather than inventing a fourth outcome is the whole trick. RFC 0003
   * already makes the absence of a rule a conservative conflict, so a result of unknown validity
   * produces exactly what one should: the pair is unresolved and the user is told. A `stale`
   * verdict would have been a second way to express the same thing, free to drift from it.
   *
   * The reason is reported below rather than swallowed, because "no rule names this pair" and "the
   * rule that named it was tested at another version" call for different actions.
   */
  const stale = found === null ? [] : staleRecordedVersions(found, input.observedVersions);
  const rule = stale.length > 0 ? null : found;

  // The fail-closed path, and the one that matters most. RFC 0003: "No rule means
  // conservative conflict for overlapping exclusive capabilities."
  if (rule === null) {
    if (found !== null) {
      conflicts.push({
        code: 'compatibility-rule-stale',
        scope: formatCapabilityScope(scope),
        claimants,
        detail: [
          `${claimants.join(' and ')} both claim ${capability} on ${formatCapabilityScope(scope)}`,
          `Rule ${found.id} was tested at ${stale.map((entry) => `${entry.provider} ${entry.recorded}`).join(', ')}`,
          `Installed now: ${stale.map((entry) => `${entry.provider} ${entry.observed ?? 'unknown'}`).join(', ')}`,
          'A compatibility result covers the versions it records, so this one is withdrawn rather than applied outside them',
        ],
        remediation: `Re-test ${found.id} against the installed versions and update its \`testedVersions\`, or assign the scope explicitly with \`profile: custom\``,
      });
      return;
    }
    conflicts.push({
      code: 'exclusive-scope-contested',
      scope: formatCapabilityScope(scope),
      claimants,
      detail: [
        `${claimants.join(' and ')} both claim ${capability} on ${formatCapabilityScope(scope)}`,
        'No compatibility rule names this provider pair for this capability on this harness',
        'Both would transform the same payload, and the saving would be counted twice',
      ],
      remediation: `Assign the scope explicitly with \`profile: custom\`, or add a compatibility rule naming ${claimants.join(', ')} with an order and a fixture`,
    });
    return;
  }

  if (rule.outcome === 'conflict') {
    conflicts.push({
      code: 'exclusive-scope-incompatible',
      scope: formatCapabilityScope(scope),
      claimants,
      detail: [
        `${claimants.join(' and ')} are declared incompatible on ${capability}`,
        `Rule ${rule.id}: ${rule.rationale}`,
      ],
      remediation: `Choose one owner for ${formatCapabilityScope(scope)} with \`profile: custom\``,
    });
    return;
  }

  if (rule.outcome === 'ordered') {
    // `isWellFormedRule` is the guard for a malformed table; reaching here without an order
    // would mean an ordered rule with nothing to order, so the pair is treated as unresolved
    // rather than run in an arbitrary sequence.
    const order = rule.order;
    if (order === undefined || order.length !== claimants.length) {
      conflicts.push({
        code: 'compatibility-rule-malformed',
        scope: formatCapabilityScope(scope),
        claimants,
        detail: [
          `Rule ${rule.id} declares an ordered chain without a usable order`,
          'An ordered rule with no order cannot be executed, and guessing one would be the arbitrary composition the rule exists to prevent',
        ],
        remediation: `Fix rule ${rule.id} so its order lists every provider it names`,
      });
      return;
    }
    for (const [index, provider] of order.entries()) {
      const claim = claims.find((entry) => entry.provider === provider);
      if (claim === undefined) continue;
      ownership.push({ scope, owner: provider, mode: 'chainable', order: index });
    }
    return;
  }

  // `compatible`: the rule says they coexist, and for an exclusive capability that still
  // needs exactly one owner at this scope. The rule's provider order supplies it, so the
  // choice is data in the table rather than a preference in this code.
  const winner = rule.providers.find((provider) => claimants.includes(provider)) ?? claimants[0];
  for (const claimant of claimants) {
    if (claimant === winner) continue;
    exclusions.push({
      scope,
      excluded: claimant,
      retained: winner ?? null,
      reason: [
        `rule ${rule.id} gives ${capability} on ${scope.harness} to ${String(winner)}`,
        rule.rationale,
      ],
    });
  }
  const winnerClaim = claims.find((claim) => claim.provider === winner);
  if (winner !== undefined && winnerClaim !== undefined) {
    ownership.push({ scope, owner: winner, mode: winnerClaim.mode, order: 0 });
  }
}
