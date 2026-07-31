/**
 * Read-only command reports.
 *
 * One result object per command, rendered twice (RFC 0006 rule 3). `doctor` and
 * `plan` are pinned by the golden transcripts in RFC 0006 §Golden path. `status`
 * has no transcript in any accepted RFC, so its shape and rendering are
 * project-local and its golden file is marked as such.
 */

import type { HarnessDetection, ProviderDetection } from './detection.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { PlatformFacts } from './platform.js';
import type { ResolvedCapability } from './capabilities.js';

export interface DoctorReport {
  platform: PlatformFacts;
  harnesses: HarnessDetection[];
  providers: ProviderDetection[];
  /**
   * RFC 0006 §Exit codes: "An empty environment is a *state*, not a problem".
   * Only broken integrations, unowned edits on exclusive scopes, out-of-range
   * versions, and sub-tier verifications increment this.
   */
  problemCount: number;
}

/** RFC 0004 §Post-apply drift — the four findings a read-only command reports. */
export interface DriftFinding {
  code:
    | 'owned-block-edited'
    | 'unowned-entry-on-exclusive-scope'
    | 'harness-version-changed'
    | 'provider-version-out-of-tested-range';
  path: string | null;
  detail: string;
  remediation: string | null;
}

export interface PipelineStatus {
  /** RFC 0003 §Scope of the resolver: derived from the ordered owner list. */
  pipelineId: string;
  harness: HarnessId;
  receiptId: string | null;
  appliedAt: string | null;
  owners: ResolvedCapability[];
}

/** RFC 0005 §Importer degradation policy: "the mode appears in `status` output". */
export interface ImporterStatus {
  providerId: ProviderId;
  mode: 'native' | 'legacy' | 'unavailable';
  lastImportedAt: string | null;
}

export interface StatusReport {
  platform: PlatformFacts;
  pipelines: PipelineStatus[];
  drift: DriftFinding[];
  importers: ImporterStatus[];
  problemCount: number;
}

/**
 * What `apply` did — RFC 0004 §Transaction lifecycle and RFC 0006 §Exit codes.
 *
 * Every field answers a question a user has after a mutation, and the ones that look
 * redundant are not. `transactionId` is required on exit 7 by RFC 0006 — "it always names the
 * exact affected paths and the transaction ID on stderr" — and `unrestored` is what
 * distinguishes exit 6 from exit 7: a rollback that was verified from one that was attempted.
 */
export interface ApplyReport {
  /** The plan that was executed. Null when nothing was applied. */
  planId: string | null;
  transactionId: string | null;
  /** True when the plan was loaded from the state directory rather than recomputed. */
  fromStoredPlan: boolean;
  /** How the transaction ended, in the journal's own vocabulary. */
  outcome:
    | 'nothing-to-do'
    | 'confirmation-required'
    | 'rejected'
    | 'committed'
    | 'rolled-back'
    | 'dirty';
  /** One line per action, in execution order. */
  results: {
    actionId: string;
    kind: string;
    status: string;
    path: string | null;
  }[];
  /** Paths a rollback failed to restore. Non-empty only on exit 7. */
  unrestored: string[];
  /** The receipt written to the state directory, when one was. */
  receiptId: string | null;
}
