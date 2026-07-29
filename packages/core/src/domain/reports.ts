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
