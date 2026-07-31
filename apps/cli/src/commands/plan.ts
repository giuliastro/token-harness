/**
 * `token-harness plan`.
 *
 * Phase 4 is what makes this a plan rather than a shape. The resolver from RFC 0003 now runs
 * over the harnesses actually present and the providers actually detected, so `ownership`,
 * `exclusions`, and `conflicts` are real.
 *
 * Actions come from the provider adapters, one `plan` call each, given the scopes the resolver
 * assigned them. The direction matters: RFC 0003 centralises ownership, so an adapter is *told*
 * what it owns and answers only "what would I write". An adapter that chose its own scopes would
 * be making the resolver's decision a second time, where no rule table applies.
 *
 * Nothing here writes. RFC 0004 keeps `plan` read-only, and the actions are data — RFC 0002
 * §Planning: "a provider plan contains no executable closures and can be serialized as JSON".
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
  planRequiresElevation,
  planRequiresNetwork,
  resolveOwnership,
  type CommandResult,
  type Diagnostic,
  type HarnessConfigSummary,
  type HarnessManifest,
  type PlanReport,
  type PlannedAction,
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
  const harnessConfigs: HarnessConfigSummary[] = [];
  const detectionContext =
    context.adapters === null
      ? null
      : {
          fs: context.adapters.fs,
          runner: context.adapters.runner,
          facts: context.platform,
          paths: context.adapters.paths,
          projectRoot: context.projectRoot,
        };

  if (detectionContext !== null) {
    for (const adapter of harnessAdapters) {
      const detection = await adapter.detect(detectionContext);
      if (detection.state === 'absent') continue;
      present.push(adapter.manifest);
      // Inspected here as well as detected, because a plan that cannot see the live hook list
      // cannot tell "install this" from "this is already installed" — and RFC 0004 §Brownfield
      // adoption makes the second the common case.
      const inspection = await adapter.inspect(detectionContext);
      harnessConfigs.push(...inspection.summaries);
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

  /**
   * One `plan` call per provider that owns something.
   *
   * A provider with no resolved scope is not asked. Asking it anyway would invite a plan for a
   * scope the resolver declined to give it, which is the one thing centralising ownership was
   * meant to prevent.
   */
  const actions: PlannedAction[] = [];
  if (detectionContext !== null && context.adapters !== null) {
    const providerContext = {
      ...detectionContext,
      harnessConfigs,
      now: context.now,
      localDatabase: context.adapters.localDatabase,
      projectIdFor: context.adapters.projectIdFor,
    };
    for (const adapter of providerAdapters) {
      const owned = resolution.ownership.filter((entry) => entry.owner === adapter.manifest.id);
      if (owned.length === 0) continue;
      const providerPlan = await adapter.plan(providerContext, {
        ownership: owned,
        harnesses: present,
        desiredState: 'configured',
      });
      actions.push(...providerPlan.actions);
    }
  }

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
    actions,
    conflicts: resolution.conflicts,
    // Derived from the actions rather than declared, so the summary line cannot disagree with
    // what the plan would do. RFC 0006's transcript prints all three.
    network: planRequiresNetwork(actions) ? ['provider installation channel'] : [],
    elevation: planRequiresElevation(actions) ? ['provider installation channel'] : [],
    // One snapshot per distinct existing file an action touches. Counted from `affectedPaths`
    // for the same reason: a stated number that the actions do not imply is a number nobody
    // can check.
    backups: {
      files: new Set(actions.flatMap((action) => action.affectedPaths)).size,
    },
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

  if (resolution.ownership.length > 0 && actions.length === 0) {
    // RFC 0004 §Brownfield adoption, and the ordinary outcome on a machine already set up: the
    // desired state is the current state, so the honest plan is empty. Saying nothing here
    // would leave a reader wondering whether the plan failed.
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'already-in-desired-state',
        message:
          'Every scope Token Harness would own is already configured, so this plan has nothing to change',
        remediation: null,
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
