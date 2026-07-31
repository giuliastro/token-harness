/**
 * The provider adapter contract — RFC 0002 §Adapter lifecycle, PLAN §10.
 *
 * Phase 1 exposed `detect` alone and said why: the other four "need the planning,
 * process, and metrics contexts that Phase 2 introduces, and an interface that names
 * them before those types exist would be a placeholder, not a contract."
 *
 * Two of the three now exist, so two more methods do. `plan` and `collectMetrics` are
 * still absent, and for different reasons rather than the same excuse:
 *
 * - `plan` needs the Phase 4 capability resolver to know which scopes this provider is
 *   being asked to own. RFC 0003 centralises that decision, and a provider that planned
 *   without the resolver would be making it alone.
 * - `collectMetrics` needs somewhere to put the events. RFC 0005 §Storage puts them
 *   behind `MetricsStore`, and `JsonlStore` — PLAN §2.4, issue 8 — has not been written.
 *   An importer with no store is a function that reads a file and drops it.
 */

import type {
  Diagnostic,
  FileSystemPort,
  HarnessConfigSummary,
  PlatformFacts,
  PlatformPaths,
  ProcessRunner,
  ProviderDetection,
  ProviderId,
  ProviderManifest,
  VerificationCheck,
  VerificationTier,
} from '@token-harness/core';

/**
 * Everything a provider adapter is allowed to reach.
 *
 * `harnessConfigs` is the seam. A provider learns which harnesses it is wired to by
 * recognising its own command in what the harness adapters reported, never by parsing a
 * harness configuration file itself — which would be a second implementation of the
 * harness adapter, free to drift from the first.
 */
export interface ProviderContext {
  readonly fs: FileSystemPort;
  /** RFC 0002 §Process abstraction: adapters never call the operating system directly. */
  readonly runner: ProcessRunner;
  readonly facts: PlatformFacts;
  readonly paths: PlatformPaths;
  readonly projectRoot: string;
  /** What the harness adapters found. Empty when no harness was inspected. */
  readonly harnessConfigs: readonly HarnessConfigSummary[];
  /**
   * ISO 8601 instant. Injected rather than read from `Date.now()`, so a test can assert
   * that a receipt is a week stale without waiting a week.
   */
  now(): string;
}

/**
 * The receipt a passive canary read — RFC 0007 §Active and passive canaries.
 *
 * `observedAt` is required rather than optional, because RFC 0007 says a passive receipt
 * "carries the time of the operation it observed": working as of three weeks ago and
 * working as of a minute ago are different claims, and a receipt that cannot say which
 * it is has not made either.
 */
export interface PassiveReceipt {
  /** ISO 8601 date or instant of the most recent intercepted operation. */
  observedAt: string;
  /** Operations the provider recorded at that point. */
  operations: number;
  /** Where it was read from, for the evidence trail. */
  source: string;
}

export interface ProviderVerification {
  providerId: ProviderId;
  declaredTier: VerificationTier;
  /** The strongest tier actually reached, or null when nothing could be established. */
  achievedTier: VerificationTier | null;
  /** Null when no operation has been observed, which is `not-exercised`, not a failure. */
  receipt: PassiveReceipt | null;
  checks: VerificationCheck[];
  diagnostics: Diagnostic[];
}

export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  /** RFC 0002 §Detection: read-only, evidence-based, never inferred from configuration alone. */
  detect(context: ProviderContext): Promise<ProviderDetection>;
  /**
   * RFC 0007: at the declared tier, passive by default. An active canary costs a model
   * call and is never run by a read-only command.
   */
  verify(context: ProviderContext): Promise<ProviderVerification>;
}
