/**
 * What a command is allowed to see.
 *
 * Everything here is injected. No command reads `process`, the environment, or
 * the filesystem, which is what keeps the Phase 1 tests from ever touching the
 * developer's real home directory (AGENTS.md, PLAN §2.1).
 */

import type {
  FileSystemPort,
  HarnessId,
  LocalDatabasePort,
  MetricsStore,
  PlatformFacts,
  PlatformPaths,
  ProcessRunner,
  ProviderId,
} from '@token-harness/core';

export interface CommandContext {
  platform: PlatformFacts;
  /** Absolute project root: `--project <dir>` when given, otherwise the cwd. */
  projectRoot: string;
  /** Absolute home directory, used only to abbreviate displayed paths. */
  home: string | null;
  /** Absolute Token Harness state root, or null while it is not resolved. */
  stateRoot: string | null;
  harness: HarnessId | null;
  provider: ProviderId | null;
  /** The `--since` value as given, or null. Parsed by the command that needs a window. */
  since: string | null;
  until: string | null;
  /**
   * The metrics store, or null when this host has none.
   *
   * Separate from `adapters` because it is not a port an adapter reaches for: an importer is
   * *handed* the store so that its cursor and its appends move together. RFC 0005 §Storage
   * keeps the backend invisible on both sides of this field.
   */
  metrics: MetricsStore | null;
  /**
   * What an adapter is allowed to reach — the ports from `core`, never the
   * implementations from `@token-harness/platform`.
   *
   * Null when the caller supplied none, which is how a test asserts the CLI contract
   * without a filesystem: adapters are skipped and the report says so, rather than the
   * command reaching for the developer's home. AGENTS.md forbids the second.
   */
  adapters: AdapterAccess | null;
  /** ISO 8601 instant. Injected so a report is deterministic in tests. */
  now(): string;
}

export interface AdapterAccess {
  fs: FileSystemPort;
  runner: ProcessRunner;
  paths: PlatformPaths;
  /**
   * A reader for a provider's own local database, or null when this host has none —
   * RFC 0005 §Importers. Null is an ordinary state and makes an importer report
   * `mode: 'unavailable'` rather than fail.
   */
  localDatabase: LocalDatabasePort | null;
  /**
   * RFC 0005 §Privacy: "`projectId` is a local stable hash with a machine-local salt."
   *
   * Supplied by the host because the salt lives in the state directory. Returns
   * `p_unattributed` when no salt could be established: an event with no project is honest,
   * and one attributed under a salt that will change next run is not.
   */
  projectIdFor(absolutePath: string): string;
}
