/**
 * `token-harness plan`.
 *
 * Phase 4 is what makes this a plan rather than a shape. The resolver from RFC 0003 now runs
 * over the harnesses actually present and the providers actually detected, so `ownership`,
 * `exclusions`, and `conflicts` are real.
 *
 * What is still absent is `actions`. Ownership answers *who* owns a scope; an action is *what
 * to write*, and that needs the installation planning of Phase 6 — RFC 0002 §Adapter lifecycle
 * keeps `plan` on the adapter for that reason. A plan that invented actions from ownership
 * would be guessing at file edits, which RFC 0004 exists to prevent. So this reports what was
 * resolved and says plainly that nothing will be written yet.
 *
 * RFC 0006 §Plan persistence requires a stored plan to be addressable by ID. Persisting it
 * belongs with `apply`, so `persisted` stays false and no `apply --plan <id>` hint is printed
 * — printing one would name an artifact that does not exist.
 */

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  COMPATIBILITY_RULES,
  EXIT_CODES,
  commandResult,
  diagnostic,
  isProfileId,
  resolveOwnership,
  type CommandResult,
  type Diagnostic,
  type HarnessManifest,
  type PlanReport,
  type ProfileId,
  type ResolverProvider,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

/** RFC 0003 §Profiles: `safe` is the default and `balanced` does not exist. */
const DEFAULT_PROFILE: ProfileId = 'safe';

/**
 * Which providers Token Harness can actually bring an assignment about for.
 *
 * RFC 0003 §Resolution at 0.1.0 checked each installer at `0.0.5` and found no narrowed state
 * producible for HarnessTrim on any MVP harness, so under `safe` it "is not installed by Token
 * Harness at all" — detected, adopted, reconciled, and measured, but never an owner.
 *
 * A list here rather than a manifest field, because it is a fact about *our* installer support
 * rather than about the provider: a provider adapter that gains an installation plan becomes
 * assignable without its upstream tool changing at all.
 */
const ASSIGNABLE_PROVIDERS: readonly string[] = ['rtk'];

export async function runPlan(context: CommandContext): Promise<CommandResult<PlanReport>> {
  const diagnostics: Diagnostic[] = [];

  const providerAdapters = listProviderAdapters().filter(
    (adapter) => context.provider === null || adapter.manifest.id === context.provider,
  );
  const harnessAdapters = listHarnessAdapters().filter(
    (adapter) => context.harness === null || adapter.manifest.id === context.harness,
  );

  const profile: ProfileId = isProfileId(DEFAULT_PROFILE) ? DEFAULT_PROFILE : 'safe';

  /**
   * Detection decides which harnesses the plan covers.
   *
   * Resolving over every *known* harness instead would produce ownership for a harness that is
   * not on the machine. With no ports available — the shape a CLI-contract test uses — nothing
   * is detected, and a plan over nothing is the honest result.
   */
  const present: HarnessManifest[] = [];
  if (context.adapters !== null) {
    const detectionContext = {
      fs: context.adapters.fs,
      runner: context.adapters.runner,
      facts: context.platform,
      paths: context.adapters.paths,
      projectRoot: context.projectRoot,
    };
    for (const adapter of harnessAdapters) {
      const detection = await adapter.detect(detectionContext);
      if (detection.state === 'absent') continue;
      present.push(adapter.manifest);
    }
  }

  const providers: ResolverProvider[] = providerAdapters.map((adapter) => ({
    id: adapter.manifest.id,
    capabilities: adapter.manifest.capabilities,
    assignable: ASSIGNABLE_PROVIDERS.includes(adapter.manifest.id),
  }));

  const resolution = resolveOwnership({
    profile,
    harnesses: present,
    providers,
    rules: [...COMPATIBILITY_RULES],
    harness: context.harness,
  });

  const report: PlanReport = {
    // RFC 0006 §Plan persistence makes the ID "a digest over the plan's normalized content",
    // and a plan is not content until it has actions. Null for now, rather than a digest over
    // an empty action list that would be identical on every machine.
    planId: null,
    pipelineId: resolution.pipelineId,
    profile,
    harness: context.harness,
    projectRoot: context.projectRoot,
    projectId: context.adapters?.projectIdFor(context.projectRoot) ?? null,
    ownership: resolution.ownership,
    exclusions: resolution.exclusions,
    actions: [],
    conflicts: resolution.conflicts,
    network: [],
    elevation: [],
    backups: { files: 0 },
    persisted: false,
  };

  if (context.adapters === null) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'no-harness-inspected',
        message: 'No harness was inspected, so this plan resolves ownership over nothing',
        remediation: null,
      }),
    );
  } else if (present.length === 0) {
    // RFC 0006 §Exit codes: "An empty environment is a state, not a problem."
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'no-harness-detected',
        message: 'No supported harness was detected on this machine',
        remediation: null,
      }),
    );
  }

  if (providerAdapters.length === 0) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'no-providers-registered',
        message: 'No provider adapters are registered in this build, so no plan has actions',
        remediation: null,
      }),
    );
  }

  if (resolution.ownership.length > 0) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'plan-has-no-actions',
        message:
          'Ownership is resolved, but writing it is not in this build, so this plan changes nothing',
        remediation: 'Run `token-harness doctor` to see what is already configured',
      }),
    );
  }

  for (const conflict of resolution.conflicts) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: conflict.code,
        message: conflict.detail.join('. '),
        remediation: conflict.remediation,
      }),
    );
  }

  // RFC 0006 §Exit codes: 4 is "planning succeeded but a hard conflict prevents apply".
  const exitCode =
    resolution.conflicts.length > 0 ? EXIT_CODES['blocked-by-conflict'] : EXIT_CODES.ok;

  return commandResult<PlanReport>({ command: 'plan', exitCode, data: report, diagnostics });
}
