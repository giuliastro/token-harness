/**
 * The plan report: the result object behind `token-harness plan`.
 *
 * RFC 0006 rule 3 — "Human output and JSON output are two renderings of the same
 * result object. A field visible in human output but absent from `data` is a
 * defect" — is why every token in the golden transcript has a field here,
 * including the network, elevation, and backup summary line.
 */

import type { CapabilityExclusion, ResolvedCapability } from './capabilities.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { PlannedAction } from './actions.js';

/** RFC 0003 §Profiles: `balanced` is deliberately absent at 0.1.0. */
export const PROFILE_IDS = ['safe', 'custom'] as const;

export type ProfileId = (typeof PROFILE_IDS)[number];

export function isProfileId(value: string): value is ProfileId {
  return (PROFILE_IDS as readonly string[]).includes(value);
}

/**
 * RFC 0003 §Continuous conflict detection and §Planner result: a hard conflict
 * blocks apply and is reported, never resolved by overwriting.
 */
export interface HardConflict {
  /** Stable kebab-case identifier, e.g. `exclusive-scope-contested`. */
  code: string;
  /** The contested scope, in `<harness>/<tool-family>/<point>/<capability>` form. */
  scope: string;
  /** Providers that claim the scope. */
  claimants: ProviderId[];
  /** One entry per rendered line of the explanation. */
  detail: string[];
  /** The `Fix:` line. */
  remediation: string;
}

export interface PlanBackupSummary {
  /** Existing files that will be snapshotted before mutation. */
  files: number;
}

export interface PlanReport {
  /**
   * Null when planning aborted. RFC 0006 §Plan persistence: the ID is a digest
   * over the plan's normalized content.
   */
  planId: string | null;
  profile: ProfileId;
  /** The `--harness` selector, or null when the plan covers every harness. */
  harness: HarnessId | null;
  /** Absolute project root the plan was computed against. */
  projectRoot: string;
  /** RFC 0006 §Plans are scoped to a project. */
  projectId: string | null;
  /**
   * The pipeline this plan would create — RFC 0003 §Scope of the resolver at 0.1.0, item 4:
   * derived from the ordered owner list "because metrics attribution depends on it".
   *
   * Data only. RFC 0006's plan transcript shows no pipeline line, and rule 3 forbids the
   * reverse case — a field in human output missing from `data` — not this one. It is here so
   * `plan --json` can say which pipeline an apply would produce, before there is a receipt to
   * read it from.
   *
   * Null when nothing was resolved: a pipeline with no owners is not a pipeline.
   */
  pipelineId: string | null;
  ownership: ResolvedCapability[];
  exclusions: CapabilityExclusion[];
  actions: PlannedAction[];
  conflicts: HardConflict[];
  /** Network destinations, empty when the plan needs none. */
  network: string[];
  /** Steps requiring elevation, empty when the plan needs none. */
  elevation: string[];
  backups: PlanBackupSummary;
  /**
   * True when the plan was persisted and can be replayed with `apply --plan`.
   * False while the state layer does not exist (PLAN §2.4).
   */
  persisted: boolean;
}

export function planAborted(report: PlanReport): boolean {
  return report.planId === null || report.conflicts.length > 0;
}
