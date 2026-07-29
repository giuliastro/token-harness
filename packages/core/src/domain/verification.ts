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

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip';

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
  receiptId: string;
  appliedAt: string;
  results: VerificationResult[];
  /** The closing line: healthy at the declared tier for every provider, or not. */
  healthyAtDeclaredTier: boolean;
}
