/**
 * Verification results and receipts.
 *
 * RFC 0002 §Verification declares the check status union as
 * `"pass" | "warn" | "fail" | "skip"`. RFC 0006 §Golden path emits `info` for
 * `tier-limit` and `not-managed`, and RFC 0006 §Tier-aware verification status
 * states outright that "the tier limitation itself is reported as `info`". The
 * union below therefore includes `info`; the divergence is reported against
 * RFC 0002 rather than resolved by dropping a status the golden transcript uses.
 */

import type { Evidence } from './evidence.js';
import type { HarnessId, ProviderId } from './ids.js';
import type { VerificationTier } from './detection.js';

export type CheckStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'info'
  /**
   * RFC 0007 §Active and passive canaries. A passive canary reads the receipt of an
   * operation the harness performed anyway; before any such operation, nothing is
   * known. That is not a pass — asserting one on no evidence is the failure the tier
   * system exists to prevent — and not a fail, because nothing has gone wrong.
   */
  | 'not-exercised'
  | 'skip';

export interface VerificationCheck {
  id: string;
  status: CheckStatus;
  /** The line rendered after the check ID in human output. */
  summary: string;
  achievedTier: VerificationTier | null;
  evidence: Evidence[];
  remediation: string | null;
}

export type VerificationStatus = 'healthy' | 'degraded' | 'failed' | 'not-applicable';

export interface VerificationResult {
  providerId: ProviderId;
  harnessId: HarnessId;
  status: VerificationStatus;
  declaredTier: VerificationTier;
  /** RFC 0004 §Brownfield adoption: adopted installations are verified, not owned. */
  managedByTokenHarness: boolean;
  checks: VerificationCheck[];
}

/**
 * RFC 0006 §Tier-aware verification status: only `fail` contributes to the
 * problems-found exit code. `info` never does, and a correctly functioning
 * `config-only` installation is a `pass`.
 */
export function contributesToProblems(check: VerificationCheck): boolean {
  return check.status === 'fail';
}

/** RFC 0005 §Storage — the receipt held by `MetricsStore.upsertReceipt`. */
export interface VerificationReceipt {
  schemaVersion: 1;
  receiptId: string;
  /** ISO 8601 instant at which the transaction was applied. */
  appliedAt: string;
  /** RFC 0002 §Harness versioning is symmetric: recorded in every receipt. */
  harnessVersions: Record<string, string>;
  providerVersions: Record<string, string>;
  pipelineId: string | null;
  results: VerificationResult[];
}

export interface VerifyReport {
  /**
   * The receipt this verification is against, or null when nothing was applied here.
   *
   * Nullable, and that was an amendment. RFC 0006's normative transcript opens with
   * `Receipt … — applied …`, which assumes an apply happened. But PLAN §2 asks for both
   * "verify the actual harness integration" and "adopt an existing hand-configured RTK or
   * HarnessTrim installation" — and on an adopted machine there is no receipt, because Token
   * Harness applied nothing. A `verify` that required one would refuse to run in exactly the
   * situation RFC 0004 §Brownfield adoption calls the normal one.
   *
   * RFC 0006 §Verifying without a receipt records the second header line.
   */
  receiptId: string | null;
  /** ISO 8601 instant of the apply this verifies, or null when there was none. */
  appliedAt: string | null;
  results: VerificationResult[];
  /** The closing line: healthy at the declared tier for every provider, or not. */
  healthyAtDeclaredTier: boolean;
}
