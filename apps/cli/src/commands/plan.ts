/**
 * `token-harness plan`.
 *
 * The capability resolver is Phase 4 and the action executor is Phase 2, so with
 * empty registries this produces a plan with no owners and no actions. That is a
 * real result, not a stub: RFC 0004 makes `plan` read-only, and a plan over zero
 * providers legitimately changes nothing.
 *
 * RFC 0006 §Plan persistence requires a stored plan to be addressable by ID. The
 * state directory arrives in Phase 2, so `persisted` is false and no `apply
 * --plan <id>` hint is printed. Printing one would name an artifact that does
 * not exist.
 */

import { listProviderAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  commandResult,
  isProfileId,
  type CommandResult,
  type PlanReport,
  type ProfileId,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

/** RFC 0003 §Profiles: `safe` is the default and `balanced` does not exist. */
const DEFAULT_PROFILE: ProfileId = 'safe';

export async function runPlan(context: CommandContext): Promise<CommandResult<PlanReport>> {
  const providers = listProviderAdapters().filter(
    (adapter) => context.provider === null || adapter.manifest.id === context.provider,
  );
  // Awaiting nothing keeps the signature stable for Phase 4, where resolution
  // becomes asynchronous. It is not load-bearing today.
  await Promise.resolve();

  const profile: ProfileId = isProfileId(DEFAULT_PROFILE) ? DEFAULT_PROFILE : 'safe';

  const report: PlanReport = {
    planId: null,
    profile,
    harness: context.harness,
    projectRoot: context.projectRoot,
    projectId: null,
    ownership: [],
    exclusions: [],
    actions: [],
    conflicts: [],
    network: [],
    elevation: [],
    backups: { files: 0 },
    persisted: false,
  };

  // RFC 0006 §Exit codes: 4 is "planning succeeded but a hard conflict prevents
  // apply". No providers means no contested scope, so a plan over an empty
  // registry exits 0.
  const exitCode = report.conflicts.length > 0 ? EXIT_CODES['blocked-by-conflict'] : EXIT_CODES.ok;

  return commandResult<PlanReport>({
    command: 'plan',
    exitCode,
    data: report,
    diagnostics:
      providers.length === 0
        ? [
            {
              severity: 'info',
              code: 'no-providers-registered',
              message: 'No provider adapters are registered in this build, so no plan has actions',
              path: null,
              remediation: null,
            },
          ]
        : [],
  });
}
