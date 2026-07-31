/**
 * Plan persistence — RFC 0006 §Plan persistence.
 *
 * > `plan` writes the serialized plan to the state directory under its ID and prints the ID.
 * > The ID is a digest over the plan's normalized content, so identical inputs produce
 * > identical IDs and a changed environment produces a different one.
 *
 * The point of all of this is one sentence further down: "`apply --plan <id>` is what makes
 * review-then-execute possible: the artifact a human or a reviewer approved is the artifact
 * that runs." Everything here exists to make that literally true rather than approximately.
 *
 * ## What goes into the digest, and what deliberately does not
 *
 * The digest covers what would be *done*: the profile, the ownership, and the actions with
 * their payloads and precondition digests. It does not cover the diagnostics, the exclusions,
 * or the timestamps — those explain the plan without changing it, and folding them in would
 * make the ID change when only the wording did.
 *
 * The project binding is stored but *not* digested, and that asymmetry is the RFC's own:
 *
 * > Without that binding, an ID computed in one repository could be applied in another. The
 * > digest would still validate, because it covers the plan's content and not the context
 * > that produced it.
 *
 * So the binding is checked as a precondition rather than folded into the identity. Digesting
 * it would make two identical plans in two repositories different plans, which is a different
 * claim from the one the RFC makes.
 */

import { digestText } from '../domain/digest.js';
import type { PlannedAction } from '../domain/actions.js';
import type { ResolvedCapability } from '../domain/capabilities.js';
import type { HarnessId, ProviderId } from '../domain/ids.js';
import type { PlanReport, ProfileId } from '../domain/plan.js';

export const STORED_PLAN_SCHEMA_VERSION = 1;

/**
 * The versions a plan was computed against — RFC 0004, quoted by RFC 0006 §Plan persistence:
 * "a plan record the exact provider versions and actions apply will use".
 *
 * Recorded, and revalidated, because an action written against RTK 0.42.0's hook shape is not
 * necessarily correct against 0.43.0's. A plan that ran anyway would be applying a reviewed
 * decision to an unreviewed tool.
 */
export interface RecordedVersions {
  providers: Record<string, string | null>;
  harnesses: Record<string, string | null>;
}

export interface StoredPlan {
  schemaVersion: typeof STORED_PLAN_SCHEMA_VERSION;
  planId: string;
  createdAt: string;
  profile: ProfileId;
  harness: HarnessId | null;
  /** RFC 0006 §Plans are scoped to a project: both, and both are checked. */
  projectRoot: string;
  projectId: string | null;
  versions: RecordedVersions;
  ownership: ResolvedCapability[];
  actions: PlannedAction[];
}

/**
 * The canonical form the digest is taken over.
 *
 * Hand-built rather than `JSON.stringify` over the whole report, so what is included is a
 * decision rather than an accident of field order. A field added to `PlanReport` later does
 * not silently change every plan ID.
 */
export function planDigestMaterial(input: {
  profile: ProfileId;
  harness: HarnessId | null;
  ownership: readonly ResolvedCapability[];
  actions: readonly PlannedAction[];
}): string {
  const lines: string[] = [
    `schema ${String(STORED_PLAN_SCHEMA_VERSION)}`,
    `profile ${input.profile}`,
    `harness ${input.harness ?? '*'}`,
  ];

  // Sorted, because ownership order is not meaningful — the resolver iterates harnesses and
  // capabilities in its own order, and a future change to that order must not change the ID of
  // an otherwise identical plan. Action order *is* meaningful and is left alone.
  for (const entry of [...input.ownership]
    .map(
      (owned) =>
        `own ${owned.scope.harness}/${owned.scope.toolFamily}/${owned.scope.interceptionPoint}/${owned.scope.capability}=${owned.owner}@${String(owned.order)}`,
    )
    .sort()) {
    lines.push(entry);
  }

  for (const action of input.actions) {
    // The payload, not just the kind. RFC 0006: "a plan that does not record the bytes it will
    // write is a plan nobody can approve" — so the bytes are part of what the ID identifies.
    lines.push(`action ${action.id} ${action.kind} ${action.affectedPaths.join(',')}`);
    lines.push(`  payload ${digestText(JSON.stringify(actionPayload(action)))}`);
  }

  return lines.join('\n');
}

/**
 * The part of an action that decides what happens.
 *
 * `explanation`, `preconditions`, and `postconditions` are prose for a reviewer; changing a
 * word of them must not invalidate a stored plan. Everything that determines an effect is
 * here.
 */
function actionPayload(action: PlannedAction): unknown {
  const { id, kind, riskClass, affectedPaths, ...rest } = action;
  const {
    explanation: _explanation,
    preconditions: _preconditions,
    postconditions: _postconditions,
    affectedProcesses: _affectedProcesses,
    requiresNetwork: _requiresNetwork,
    requiresElevation: _requiresElevation,
    rollbackData: _rollbackData,
    ...effect
  } = rest as Record<string, unknown> & {
    explanation?: unknown;
    preconditions?: unknown;
    postconditions?: unknown;
    affectedProcesses?: unknown;
    requiresNetwork?: unknown;
    requiresElevation?: unknown;
    rollbackData?: unknown;
  };
  return { id, kind, riskClass, affectedPaths, effect };
}

/** The plan ID: a digest over the normalized content. */
export function derivePlanId(input: {
  profile: ProfileId;
  harness: HarnessId | null;
  ownership: readonly ResolvedCapability[];
  actions: readonly PlannedAction[];
}): string {
  const digest = digestText(planDigestMaterial(input));
  // Eight hex characters, matching the `7f3a91c2` in RFC 0006's transcripts.
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 9);
}

export interface BuildStoredPlanInput {
  report: PlanReport;
  versions: RecordedVersions;
  createdAt: string;
}

export function buildStoredPlan(input: BuildStoredPlanInput): StoredPlan {
  const { report } = input;
  return {
    schemaVersion: STORED_PLAN_SCHEMA_VERSION,
    planId: derivePlanId(report),
    createdAt: input.createdAt,
    profile: report.profile,
    harness: report.harness,
    projectRoot: report.projectRoot,
    projectId: report.projectId,
    versions: input.versions,
    ownership: report.ownership,
    actions: report.actions,
  };
}

/** Why a stored plan may not be executed. Each maps to RFC 0006's staleness list. */
export type PlanRejection =
  | 'unsupported-schema-version'
  | 'plan-digest-mismatch'
  | 'plan-project-mismatch'
  | 'plan-version-drift'
  | 'plan-ownership-drift';

export interface PlanValidation {
  ok: boolean;
  rejections: { reason: PlanRejection; detail: string }[];
}

/**
 * Revalidates a stored plan against the current invocation — RFC 0006's five staleness rules,
 * in one pass.
 *
 * "Staleness is checked before any action executes." Every rule is checked rather than
 * short-circuiting on the first, because a user fixing one cause wants to know about the rest
 * before running the command again.
 */
export function validateStoredPlan(input: {
  stored: StoredPlan;
  projectRoot: string;
  projectId: string | null;
  versions: RecordedVersions;
  ownership: readonly ResolvedCapability[];
}): PlanValidation {
  const rejections: PlanValidation['rejections'] = [];
  const { stored } = input;

  if (stored.schemaVersion !== STORED_PLAN_SCHEMA_VERSION) {
    // RFC 0006 rule 1 applied to a stored artifact: stop rather than guess. A plan from a
    // future build may mean something different by the same field.
    rejections.push({
      reason: 'unsupported-schema-version',
      detail: `the plan was written by schema version ${String(stored.schemaVersion)}; this build understands ${String(STORED_PLAN_SCHEMA_VERSION)}`,
    });
    // Nothing below can be trusted once the schema is unknown, so this one does short-circuit.
    return { ok: false, rejections };
  }

  const recomputed = derivePlanId(stored);
  if (recomputed !== stored.planId) {
    // The stored file was edited after it was written. Not drift in the environment — drift in
    // the artifact, which is worse, because the ID a reviewer approved no longer describes it.
    rejections.push({
      reason: 'plan-digest-mismatch',
      detail: `the stored plan's content hashes to ${recomputed}, not to its own id ${stored.planId}`,
    });
  }

  if (stored.projectRoot !== input.projectRoot || stored.projectId !== input.projectId) {
    rejections.push({
      reason: 'plan-project-mismatch',
      detail: `the plan was computed for ${stored.projectRoot} and this invocation is in ${input.projectRoot}`,
    });
  }

  for (const [id, version] of Object.entries(stored.versions.providers)) {
    const current = input.versions.providers[id];
    if (current !== version) {
      rejections.push({
        reason: 'plan-version-drift',
        detail: `${id} was ${version ?? 'absent'} when the plan was made and is now ${current ?? 'absent'}`,
      });
    }
  }
  for (const [id, version] of Object.entries(stored.versions.harnesses)) {
    const current = input.versions.harnesses[id];
    if (current !== version) {
      rejections.push({
        reason: 'plan-version-drift',
        detail: `${id} was ${version ?? 'absent'} when the plan was made and is now ${current ?? 'absent'}`,
      });
    }
  }

  const storedOwnership = ownershipKeys(stored.ownership);
  const currentOwnership = ownershipKeys(input.ownership);
  if (storedOwnership.join('\n') !== currentOwnership.join('\n')) {
    rejections.push({
      reason: 'plan-ownership-drift',
      detail: 'the resolver now assigns different scopes than the plan recorded',
    });
  }

  return { ok: rejections.length === 0, rejections };
}

function ownershipKeys(ownership: readonly ResolvedCapability[]): string[] {
  return [...ownership]
    .map(
      (owned) =>
        `${owned.scope.harness}/${owned.scope.toolFamily}/${owned.scope.interceptionPoint}/${owned.scope.capability}=${owned.owner}`,
    )
    .sort();
}

/** Where a plan lives inside the state root. */
export function storedPlanFileName(planId: string): string {
  return `${planId}.json`;
}

/** Recognises an id shaped like one this build produces, before touching the filesystem. */
export function isPlanId(value: string): boolean {
  return /^[0-9a-f]{8}$/.test(value);
}

export type { ProviderId };
