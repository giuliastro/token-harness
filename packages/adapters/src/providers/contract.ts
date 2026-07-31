/**
 * The provider adapter contract — RFC 0002 §Adapter lifecycle, PLAN §10.
 *
 * Phase 1 exposed `detect` alone and said why: the other four "need the planning,
 * process, and metrics contexts that Phase 2 introduces, and an interface that names
 * them before those types exist would be a placeholder, not a contract."
 *
 * Two of the three now exist, so two more methods do. `plan` and `collectMetrics` were
 * still absent, and for different reasons rather than the same excuse:
 *
 * - `plan` needs the Phase 4 capability resolver to know which scopes this provider is
 *   being asked to own. RFC 0003 centralises that decision, and a provider that planned
 *   without the resolver would be making it alone.
 * - `collectMetrics` needs somewhere to put the events. RFC 0005 §Storage puts them
 *   behind `MetricsStore`, and `JsonlStore` — PLAN §2.4, issue 8 — has not been written.
 *   An importer with no store is a function that reads a file and drops it.
 *
 * `JsonlStore` now exists, so `collectMetrics` does. And the Phase 4 resolver exists, so `plan`
 * does too: RFC 0003 centralises the ownership decision, so an adapter is now *told* which
 * scopes it owns rather than deciding alone. That direction is the whole reason `plan` waited.
 */

import type {
  Diagnostic,
  FileSystemPort,
  HarnessConfigSummary,
  HarnessManifest,
  ImportCursor,
  LocalDatabasePort,
  MetricsDeclaration,
  MetricsStore,
  PlatformFacts,
  PlatformPaths,
  ProcessRunner,
  ProviderDetection,
  ProviderId,
  ProviderManifest,
  ProviderPlan,
  ResolvedCapability,
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
  /**
   * A provider's own local database, when the host can read one.
   *
   * Null is an ordinary state, not a degraded one: a runtime without a SQLite driver, or a
   * caller that supplied no reader. RFC 0005 §Importer degradation policy makes the
   * consequence `mode: 'unavailable'` — an importer that reports nothing rather than one
   * that estimates.
   */
  readonly localDatabase: LocalDatabasePort | null;
  /**
   * The RFC 0005 §Privacy identifier for a project directory: "a local stable hash with a
   * machine-local salt". Injected because the salt lives in the state directory, and an
   * adapter that derived its own would produce a different identifier per provider for the
   * same project — which would fragment every report grouped by project.
   */
  projectIdFor(absolutePath: string): string;
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

/**
 * What an import did — RFC 0005 §Importer degradation policy: "An importer states which
 * fidelity mode it is running in, and the mode appears in `status` output."
 *
 * `imported` and `skipped` are separate counts because they answer different questions. A
 * run that imported nothing because there was nothing new is healthy; a run that skipped
 * two hundred records because the upstream schema moved is not, and a single number cannot
 * distinguish them.
 */
export interface MetricsImport {
  providerId: ProviderId;
  mode: MetricsDeclaration['mode'];
  /** Where the records came from, for the evidence trail. Null when nothing was read. */
  source: string | null;
  /** Events appended to the store. */
  imported: number;
  /** Records read and deliberately not turned into events, with a reason in `diagnostics`. */
  skipped: number;
  /** The cursor as it now stands, or null when the source has none to remember. */
  cursor: ImportCursor | null;
  diagnostics: Diagnostic[];
}

/**
 * What the planner asks a provider for.
 *
 * `ownership` is the input that makes this a request rather than a negotiation: the resolver
 * has already decided, and the adapter's job is to produce the actions that bring that about.
 * An adapter that received the whole environment and picked its own scopes would be making
 * RFC 0003's decision a second time, in a place where no rule table applies.
 */
export interface ProviderPlanRequest {
  /** The scopes this provider owns, from `resolveOwnership`. Never empty for a real request. */
  readonly ownership: readonly ResolvedCapability[];
  /** Manifests of the harnesses those scopes belong to, for their configuration files. */
  readonly harnesses: readonly HarnessManifest[];
  /**
   * `configured` installs and wires; `absent` is the uninstall plan. One method for both,
   * because RFC 0004 requires removal to be as reviewable as installation — a separate
   * uninstall path is a second implementation of ownership, free to disagree about what is
   * owned.
   */
  readonly desiredState: ProviderPlan['desiredState'];
}

export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  /** RFC 0002 §Detection: read-only, evidence-based, never inferred from configuration alone. */
  detect(context: ProviderContext): Promise<ProviderDetection>;
  /**
   * Whether a hook command string invokes *this* provider.
   *
   * Synchronous and pure, because it is asked once per command per scope during conflict
   * detection, and because there is nothing to read: the answer is in the string.
   *
   * It lives on the adapter rather than in the resolver for the reason RFC 0003
   * §Continuous conflict detection needs "the competing command" at all — recognising a tool
   * is the tool's adapter's job. A table of patterns held by the conflict detector would be a
   * second implementation of every provider's identity, free to drift from the one `detect`
   * already uses.
   */
  identifiesCommand(command: string): boolean;
  /**
   * RFC 0007: at the declared tier, passive by default. An active canary costs a model
   * call and is never run by a read-only command.
   */
  verify(context: ProviderContext): Promise<ProviderVerification>;
  /**
   * RFC 0005 §Importers: reads the provider's own records and appends normalized events.
   *
   * Takes the store rather than returning events, because the cursor and the append have to
   * move together. An importer that returned events for someone else to write could have
   * its cursor advanced by a caller that then failed to append, and the records between the
   * two would be lost with nothing reporting it.
   */
  collectMetrics(context: ProviderContext, store: MetricsStore): Promise<MetricsImport>;
  /**
   * RFC 0002 §Planning: the actions that would bring the requested state about.
   *
   * Read-only, and returns data with "no executable closures" so the plan a reviewer approves
   * is serializable and replayable. An adapter that already finds the desired state satisfied
   * returns no actions — which is what makes RFC 0004 §Brownfield adoption work: an existing
   * user-managed installation is tolerated rather than overwritten.
   */
  plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan>;
}
