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
  /**
   * What an adapter is allowed to reach — the ports from `core`, never the
   * implementations from `@token-harness/platform`.
   *
   * Null when the caller supplied none, which is how a test asserts the CLI contract
   * without a filesystem: adapters are skipped and the report says so, rather than the
   * command reaching for the developer's home. AGENTS.md forbids the second.
   */
  adapters: AdapterAccess | null;
}

export interface AdapterAccess {
  fs: FileSystemPort;
  runner: ProcessRunner;
  paths: PlatformPaths;
}
