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
 * What `update` found for one provider — RFC 0004 §Provider update policy and §Amended.
 *
 * `installed` and `available` are separate nullable fields rather than one "needs update" flag,
 * because the four ways this can be inconclusive call for different responses and a boolean
 * collapses them into the same reassuring answer. A provider whose channel could not be read is
 * not a provider that is up to date.
 */
export interface ProviderUpdateRow {
  providerId: ProviderId;
  /** Null when the provider is not installed, or reported no version. */
  installed: string | null;
  /** Null unless the channel answered with one. */
  available: string | null;
  /** The installation channel consulted, by its manifest id. Null when none applies here. */
  channel: string | null;
  verdict: /** Installed version equals what the channel offers. */
  | 'current'
    /** A newer version exists and an action was planned. */
    | 'upgradable'
    /** A pin holds this provider, so nothing was planned. Not a problem. */
    | 'pinned'
    /** The channel answered, and its answer named no version this build can read. */
    | 'unknown'
    /**
     * The channel could not be asked at all — not supported by this build, or it failed to run.
     *
     * Separate from `unknown` because the first version of this collapsed the two and then printed
     * "the channel did not report a version this build can read" for a channel that was never
     * invoked. That is a false statement about what happened, and it is exactly the flattening the
     * six verdicts exist to avoid.
     */
    | 'unavailable'
    /** Nothing to update: `update` does not install what was never there. */
    | 'not-installed'
    /** The provider declares no channel for this platform. */
    | 'no-channel'
    /**
     * A newer version exists, but this provider is managed by Token Harness on at least one
     * harness and no compatibility row admits that target version there.
     */
    | 'blocked-unreviewed';
  /** The version the pin names, when `verdict` is `pinned`. */
  pin: string | null;
}

/**
 * What `update` did — RFC 0001 §CLI contract, the last command it declares.
 *
 * The execution half is an `ApplyReport` rather than six repeated fields: an update that runs is a
 * transaction, and describing it in a second vocabulary would let the two disagree about what
 * "rolled back" means.
 */
export interface UpdateReport {
  providers: ProviderUpdateRow[];
  /**
   * Network destinations this command reached to answer the question — RFC 0004 §Network policy.
   *
   * Populated on a dry run too, and that is the point: `update` cannot name a target version
   * without asking a channel, so the disclosure has to cover the reconnaissance and not only the
   * install.
   */
  network: string[];
  /** Null until something is actually applied. */
  execution: ApplyReport | null;
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
