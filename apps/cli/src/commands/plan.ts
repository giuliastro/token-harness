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
  COMPATIBILITY_ROWS,
  COMPATIBILITY_RULES,
  EXIT_CODES,
  admitManagedMutation,
  commandResult,
  diagnostic,
  harnessId,
  isProfileId,
  buildStoredPlan,
  derivePlanId,
  findMarkerRegionConflicts,
  planRequiresElevation,
  planRequiresNetwork,
  resolveOwnership,
  storedPlanFileName,
  type CommandResult,
  type Diagnostic,
  type HarnessConfigSummary,
  type HarnessId,
  type HarnessManifest,
  type ManagedIntegration,
  type HardConflict,
  type PlanReport,
  type PlannedAction,
  type ProfileId,
  type ProviderId,
  type RecordedVersions,
  type ExitCode,
  type ResolverProvider,
} from '@token-harness/core';

import { PLANS_DIRECTORY } from './apply.js';
import { runContext } from './context-cost.js';
import { runOptimize } from './optimize.js';

import type { CommandContext } from './context.js';

/** RFC 0003 §Profiles: `safe` is the default and `balanced` does not exist. */
const DEFAULT_PROFILE: ProfileId = 'safe';
const CODEX = harnessId('codex');

async function appendCodexNativePolicy(
  context: CommandContext,
  actions: PlannedAction[],
  diagnostics: Diagnostic[],
): Promise<void> {
  if (context.nativePolicy !== true) return;
  if (context.harness !== null && context.harness !== CODEX) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'native-policy-harness-unsupported',
        subject: context.harness,
        message: 'This build can plan managed native policy only for Codex',
        remediation: 'Use --harness codex, or omit --native-policy for this harness',
      }),
    );
    return;
  }

  const nativeContext: CommandContext = { ...context, harness: CODEX };
  const [optimization, contextResult] = await Promise.all([
    runOptimize(nativeContext),
    runContext(nativeContext),
  ]);
  const advice = optimization.data?.harnesses.find((item) => item.harnessId === CODEX) ?? null;
  const observation =
    contextResult.data?.harnesses.find((item) => item.harnessId === CODEX) ?? null;

  if (advice === null || observation === null || observation.managedConfigTarget === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'codex-native-policy-unavailable',
        subject: CODEX,
        message:
          'Codex optimizer advice could not be paired with a versioned native user-config target',
        remediation:
          'Run token-harness context --harness codex and keep native policy advisory until the target is observable',
      }),
    );
    return;
  }

  const target = observation.managedConfigTarget;
  const edits: Array<{
    keyPath: string;
    value: string;
    mergeStrategy: 'replace';
  }> = [];

  const consider = (input: {
    keyPath: 'model_reasoning_effort' | 'model_verbosity';
    current: string | null;
    recommended: string | null;
  }): void => {
    if (input.recommended === null || input.recommended === input.current) return;
    if (!observation.managedConfigOriginsObserved) {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'codex-native-policy-origin-unavailable',
          subject: CODEX,
          message: `Codex did not expose origin metadata for ${input.keyPath}, so it will not be managed`,
          remediation: 'Keep this recommendation advisory rather than guessing config precedence',
        }),
      );
      return;
    }
    const origin = observation.managedConfigFieldOrigins.find(
      (item) => item.keyPath === input.keyPath,
    );
    if (origin !== undefined && !origin.matchesManagedTarget) {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'codex-native-policy-shadowed',
          subject: CODEX,
          message:
            `${input.keyPath} currently comes from Codex layer ${origin.sourceType}` +
            (origin.profile === null ? '' : ` profile ${origin.profile}`) +
            ', not from the writable base user layer',
          path: origin.path,
          remediation:
            'Leave the project/profile-owned value untouched; change that scope explicitly if desired',
        }),
      );
      return;
    }
    edits.push({
      keyPath: input.keyPath,
      value: input.recommended,
      mergeStrategy: 'replace',
    });
  };

  consider({
    keyPath: 'model_reasoning_effort',
    current: advice.currentEffort,
    recommended: advice.recommendedEffort,
  });
  consider({
    keyPath: 'model_verbosity',
    current: advice.currentVerbosity,
    recommended: advice.recommendedVerbosity,
  });

  if (edits.length === 0) return;

  actions.push({
    kind: 'codex-config-batch-write',
    id:
      'codex-native-policy:' +
      edits.map((edit) => edit.keyPath + '=' + String(edit.value)).join(','),
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.path],
    affectedProcesses: ['codex'],
    preconditions: [
      'Codex user config target is still ' + target.path,
      'Codex config version is still ' + target.version,
    ],
    postconditions: edits.map((edit) => edit.keyPath + '=' + String(edit.value)),
    rollbackData: 'file-snapshot',
    explanation:
      'Apply reviewed Codex native policy: ' +
      edits.map((edit) => edit.keyPath + '=' + String(edit.value)).join(', '),
    path: target.path,
    edits,
    expectedVersion: target.version,
    reloadUserConfig: true,
  });
}

/**
 * What `plan` computes, shared with `apply`.
 *
 * Extracted rather than duplicated because RFC 0006's staleness rules compare a stored plan
 * against *the current resolution* — recorded ownership and versions against live ones. A second
 * implementation of "what would we do now" is a second answer, and the one thing a revalidation
 * must not do is disagree with the planner it is revalidating against.
 */
export interface ComputedPlan {
  report: PlanReport;
  versions: RecordedVersions;
  diagnostics: Diagnostic[];
  /** The harnesses detected as present, for a caller that needs to plan against them. */
  present: HarnessManifest[];
  /** What the harness adapters found on disk, for a brownfield-aware provider plan. */
  harnessConfigs: HarnessConfigSummary[];
  /**
   * Provider × harness relationships the admitted actions would make Token Harness manage.
   *
   * Kept beside actions rather than reconstructed later: non-intercepting integrations such as
   * HarnessTrim skills deliberately have no resolver ownership entry.
   */
  managedIntegrations: ManagedIntegration[];
  /**
   * RFC 0009 §Compatibility matrix — managed mutations the gate refused, each with the missing
   * config schema or provider fixture named. Present actions were dropped; the plan is empty and
   * `runPlan` exits with the unsupported-environment code rather than propose what a row has not
   * admitted.
   */
  blocked: BlockedManagedMutation[];
}

/** One refused managed mutation, as the plan reports it. */
export interface BlockedManagedMutation {
  provider: ProviderId;
  providerVersion: string | null;
  harness: HarnessId;
  harnessVersion: string | null;
  /** `unknown-newer`, `unknown-older`, `below-range`, or `no-row`. */
  verdict: string;
  /** What a row would have to name: the missing harness schema or provider fixture. */
  missing: string;
}

export async function computePlan(context: CommandContext): Promise<ComputedPlan> {
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
  const versions: RecordedVersions = { providers: {}, harnesses: {} };
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
      // Recorded even when null. RFC 0004 wants "the exact provider versions … apply will use",
      // and "the harness was here but reported no version" is itself a fact a later
      // revalidation must be able to compare against.
      versions.harnesses[adapter.manifest.id] = detection.version;
      present.push(adapter.manifest);
      // Inspected here as well as detected, because a plan that cannot see the live hook list
      // cannot tell "install this" from "this is already installed" — and RFC 0004 §Brownfield
      // adoption makes the second the common case.
      const inspection = await adapter.inspect(detectionContext);
      harnessConfigs.push(...inspection.summaries);
    }
  }

  /**
   * Every provider is detected before anything is resolved, not only the ones that end up owning
   * a scope.
   *
   * The order used to be the other way round, because a version was needed only to record it in
   * the stored plan. It is now an *input* to resolution: RFC 0004 §Amended makes a compatibility
   * rule speak only for the versions it records, and a rule cannot be checked against a version
   * discovered after the rule has already been applied.
   *
   * The cost is one extra probe per provider that owns nothing. `doctor` already probes all of
   * them, so this is a cost the shipped surface pays anyway.
   */
  const providerContext =
    detectionContext === null || context.adapters === null
      ? null
      : {
          ...detectionContext,
          harnessConfigs,
          now: context.now,
          localDatabase: context.adapters.localDatabase,
          projectIdFor: context.adapters.projectIdFor,
        };

  /**
   * Assignability comes from detection, so it is built here rather than above.
   *
   * PLAN §15 item 46: it used to be a constant list naming `rtk`, which answered "can this
   * provider's installer be asked for a narrowed state" once for every version of every provider.
   * HarnessTrim made that wrong — `0.0.5` could not be asked and `0.1.0` can — so the adapter
   * answers it from the build it just probed. A provider that could not be detected at all keeps
   * the conservative answer, because there is no build to have asked.
   */
  const assignable = new Map<string, ReadonlySet<HarnessId>>();

  if (providerContext !== null) {
    for (const adapter of providerAdapters) {
      const detection = await adapter.detect(providerContext);
      // Recorded even when null, for the reason the harness loop above records its own nulls.
      versions.providers[adapter.manifest.id] = detection.version;
      assignable.set(adapter.manifest.id, new Set(detection.assignableHarnesses));
    }
  }

  const providers: ResolverProvider[] = providerAdapters.map((adapter) => ({
    id: adapter.manifest.id,
    capabilities: adapter.manifest.capabilities,
    assignableHarnesses: assignable.get(adapter.manifest.id) ?? new Set<HarnessId>(),
  }));

  const resolution = resolveOwnership({
    profile,
    harnesses: present,
    providers,
    rules: [...COMPATIBILITY_RULES],
    observedVersions: versions.providers,
    harness: context.harness,
  });

  /**
   * Providers normally plan only the payload scopes the resolver assigned. A provider may opt in
   * to a separate, non-intercepting install; it must not use that path to claim an exclusive scope.
   */
  const actions: PlannedAction[] = [];
  const attributedActions: Array<{ providerId: ProviderId; action: PlannedAction }> = [];
  const managedIntegrations: ManagedIntegration[] = [];
  const blocked: BlockedManagedMutation[] = [];
  if (providerContext !== null) {
    const rows = context.compatibilityRows ?? COMPATIBILITY_ROWS;
    for (const adapter of providerAdapters) {
      const owned = resolution.ownership.filter((entry) => entry.owner === adapter.manifest.id);
      if (owned.length === 0 && adapter.plansWithoutOwnership !== true) continue;
      const providerPlan = await adapter.plan(providerContext, {
        ownership: owned,
        harnesses: present,
        desiredState: 'configured',
      });
      if (providerPlan.actions.length === 0) continue;

      /**
       * RFC 0009 §Compatibility matrix — the managed-mutation gate.
       *
       * A provider plan is admitted as a whole only when every harness it would mutate is
       * covered by a row for the observed provider × harness × version × platform combination.
       * The harnesses are read from the scopes the resolver assigned, never from a wider list:
       * gating a plan for a harness it does not touch would refuse a mutation that is not
       * planned. A plan refused on any combination is dropped whole — proposing half of a
       * mutation a row has not admitted is how a reviewer learns to trust the gate.
       */
      const touched =
        providerPlan.targetHarnesses !== undefined
          ? [...new Set(providerPlan.targetHarnesses)]
          : [...new Set(owned.map((entry) => entry.scope.harness))];
      if (touched.length === 0 && providerPlan.targetHarnesses === undefined) {
        touched.push(...present.map((harness) => harness.id));
      }
      let admitted = true;
      for (const harness of touched) {
        const admission = admitManagedMutation(rows, {
          provider: adapter.manifest.id,
          providerVersion: versions.providers[adapter.manifest.id] ?? null,
          harness,
          harnessVersion: versions.harnesses[harness] ?? null,
          os: context.platform.os,
          wsl: context.platform.isWsl,
        });
        if (admission.state !== 'admitted') {
          admitted = false;
          blocked.push({
            provider: adapter.manifest.id,
            providerVersion: versions.providers[adapter.manifest.id] ?? null,
            harness,
            harnessVersion: versions.harnesses[harness] ?? null,
            verdict: admission.verdict,
            missing: admission.missing,
          });
        }
      }
      if (admitted) {
        actions.push(...providerPlan.actions);
        attributedActions.push(
          ...providerPlan.actions.map((action) => ({
            providerId: adapter.manifest.id,
            action,
          })),
        );
        for (const harness of touched) {
          if (
            !managedIntegrations.some(
              (entry) => entry.providerId === adapter.manifest.id && entry.harnessId === harness,
            )
          ) {
            managedIntegrations.push({ providerId: adapter.manifest.id, harnessId: harness });
          }
        }
      }
    }
  }

  await appendCodexNativePolicy(context, actions, diagnostics);

  const markerConflicts: HardConflict[] = findMarkerRegionConflicts(attributedActions).map(
    (conflict) => ({
      code: 'marker-region-contested',
      scope: `${conflict.path}#${conflict.markerBegin}..${conflict.markerEnd}`,
      claimants: conflict.claimants,
      detail: [
        `Multiple providers claim the same marker-fenced region in ${conflict.path}`,
        `Claimants: ${conflict.claimants.join(', ')}`,
      ],
      remediation:
        'Give each provider a distinct marker pair, or disable one of the providers for this instruction region',
    }),
  );
  const conflicts = [...resolution.conflicts, ...markerConflicts];

  const report: PlanReport = {
    // RFC 0006 §Plan persistence: "a digest over the plan's normalized content, so identical
    // inputs produce identical IDs and a changed environment produces a different one". Null
    // when there is nothing to do — an id for an empty plan would be the same on every machine
    // and would name an artifact nobody needs to apply.
    planId:
      actions.length === 0
        ? null
        : derivePlanId({
            profile,
            harness: context.harness,
            ownership: resolution.ownership,
            actions,
          }),
    pipelineId: resolution.pipelineId,
    profile,
    harness: context.harness,
    projectRoot: context.projectRoot,
    projectId: context.adapters?.projectIdFor(context.projectRoot) ?? null,
    ownership: resolution.ownership,
    exclusions: resolution.exclusions,
    actions,
    conflicts,
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

  if (resolution.ownership.length > 0 && actions.length === 0 && blocked.length === 0) {
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

  /**
   * A refusal is only an error when it is the whole answer.
   *
   * RFC 0006 §Exit codes: "A supported configuration must be able to exit 0. A declared limitation
   * is not a problem, and reporting it as one is the fastest way to teach users to ignore the exit
   * code." Until rows shipped, every blocked combination *was* the whole answer — the comment on the
   * exit code below still said "both leave the plan empty", and it was true. It stopped being true
   * with the first row: a machine can now have RTK and HarnessTrim installable on Claude Code and
   * uncovered on Codex and OpenCode at the same time.
   *
   * On this development machine that meant `plan` exiting 9 with two refusals while holding a plan
   * that installs both providers — the covered combination unreachable because two nobody asked for
   * are not covered. So a refusal alongside actions is a warning: the plan is real, and what it
   * cannot reach is named. With no actions the refusal is the outcome, and it stays an error.
   */
  const refusalIsTheOutcome = actions.length === 0;

  for (const entry of blocked) {
    // RFC 0009 §Compatibility matrix: a provider/harness/version combination with no row is
    // refused by plan, which must name the missing config schema or provider fixture. The
    // verdict tells the reader how far the observed version sits from the nearest row.
    diagnostics.push(
      diagnostic({
        severity: refusalIsTheOutcome ? 'error' : 'warning',
        code: 'managed-mutation-blocked',
        message:
          `plan refuses managed mutation of ${entry.harness} by ${entry.provider}` +
          `${entry.providerVersion !== null ? ` at ${entry.providerVersion}` : ''}: ` +
          `${entry.missing}`,
        remediation:
          'Add a compatibility row whose fixture proves this combination, or configure this integration by hand',
      }),
    );
  }

  for (const conflict of conflicts) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: conflict.code,
        message: conflict.detail.join('. '),
        remediation: conflict.remediation,
      }),
    );
  }

  return {
    report,
    versions,
    diagnostics,
    present,
    harnessConfigs,
    managedIntegrations,
    blocked,
  };
}

/**
 * Persists the plan — RFC 0006 §Plan persistence: "`plan` writes the serialized plan to the
 * state directory under its ID and prints the ID."
 *
 * A write from a command RFC 0004 calls read-only, and specified as such for the same reason the
 * attribution salt is: what `plan` may not touch is a harness configuration or the project. Its
 * own state directory is where the artifact a reviewer approves has to live, or `apply --plan`
 * has nothing to load.
 */
async function persist(context: CommandContext, computed: ComputedPlan): Promise<boolean> {
  if (context.adapters === null || context.stateRoot === null) return false;
  if (computed.report.planId === null) return false;

  const stored = buildStoredPlan({
    report: computed.report,
    versions: computed.versions,
    createdAt: context.now(),
  });
  const path = context.adapters.fs.join(
    context.stateRoot,
    PLANS_DIRECTORY,
    storedPlanFileName(stored.planId),
  );
  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(`${JSON.stringify(stored, null, 2)}
`),
      '0600',
    );
    return true;
  } catch {
    // A plan that could not be stored is still a valid plan to read. Reporting `persisted: false`
    // is what stops the renderer printing an `apply --plan <id>` hint for an artifact that is
    // not there.
    return false;
  }
}

export async function runPlan(context: CommandContext): Promise<CommandResult<PlanReport>> {
  const computed = await computePlan(context);
  const persisted = await persist(context, computed);
  const report: PlanReport = { ...computed.report, persisted };

  const exitCode = planExitCode({
    blocked: computed.blocked.length,
    actions: report.actions.length,
    conflicts: report.conflicts.length,
  });

  return commandResult<PlanReport>({
    command: 'plan',
    exitCode,
    data: report,
    diagnostics: computed.diagnostics,
  });
}

/**
 * The exit code a computed plan deserves — RFC 0006 §Exit codes.
 *
 * 4 is "planning succeeded but a hard conflict prevents apply"; 9 (unsupported-environment) is the
 * refused managed mutation, the combination a row has not admitted (RFC 0009). They are not the same
 * outcome: "cannot do this safely" is an admission the tooling does not cover, not a dispute between
 * scopes a user can resolve by editing configuration.
 *
 * The 9 is conditional on the plan having nothing else to offer. It used to fire on any refusal,
 * which was right while the row table was empty and every refusal emptied the plan. With rows
 * shipped a plan can hold actions *and* refusals at once — on the development machine, an install
 * of both providers on Claude Code beside two uncovered combinations on Codex and OpenCode — and
 * exiting 9 there reports a working install as an unsupported environment. RFC 0006 names that
 * failure directly: "A supported configuration must be able to exit 0. A declared limitation is not
 * a problem, and reporting it as one is the fastest way to teach users to ignore the exit code."
 *
 * Extracted rather than left inline because the mixed case needs two installed providers to
 * reproduce, and the integration harness resolves one.
 */
export function planExitCode(counts: {
  blocked: number;
  actions: number;
  conflicts: number;
}): ExitCode {
  if (counts.blocked > 0 && counts.actions === 0) return EXIT_CODES['unsupported-environment'];
  if (counts.conflicts > 0) return EXIT_CODES['blocked-by-conflict'];
  return EXIT_CODES.ok;
}

/** The versions a plan was computed against, for `apply`'s revalidation. */
export function recordedVersions(computed: ComputedPlan): RecordedVersions {
  return computed.versions;
}
