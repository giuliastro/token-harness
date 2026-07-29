/**
 * What a command is allowed to see.
 *
 * Everything here is injected. No command reads `process`, the environment, or
 * the filesystem, which is what keeps the Phase 1 tests from ever touching the
 * developer's real home directory (AGENTS.md, PLAN §2.1).
 */

import type { HarnessId, PlatformFacts, ProviderId } from '@token-harness/core';

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
}
