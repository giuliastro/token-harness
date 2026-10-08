/** Reviewed, local-only temporary arm configuration through existing adapters. */
import {
  commandResult,
  diagnostic,
  digestText,
  executeTransaction,
  committedOwnership,
  factorialExperimentForArm,
  fileFingerprint,
  fingerprintMatches,
  previewFilePlan,
  FileJournalStore,
  TransactionSnapshotStore,
  MUTATION_LEASE_FILENAME,
  readMutationLease,
  harnessId,
  providerId,
  isTaskBenchmarkId,
  type CommandResult,
  type Diagnostic,
  type FileSystemPort,
  type PlannedAction,
  type SnapshotStore,
  type OwnedArtifact,
  type TaskBenchmarkCaptureStartReport,
  type MutationLease,
} from '@token-harness/core';
import {
  listHarnessAdapters,
  listProviderAdapters,
  type ProviderContext,
} from '@token-harness/adapters';
import {
  observeNativePromptRouting,
  planNativePromptRoutingInstall,
  planNativePromptRoutingRemoval,
} from '../prompt-router.js';
import type { CommandContext } from './context.js';
import { computePlan } from './plan.js';
import { runBenchmarkStart } from './benchmark-capture.js';
import {
  benchmarkSessionDrift,
  validateBenchmarkBackups,
  benchmarkSessionPath,
  encodeBenchmarkSession,
  preparedConfiguration,
  restoreBenchmarkSession,
  saveBenchmarkSession,
  type BenchmarkArmSession,
} from './benchmark-session.js';
import { repositoryRootForBackupSafety } from './snapshot-safety.js';

export interface BenchmarkPrepareReport {
  benchmarkId: string;
  variant: string;
  planId: string;
  initialConfigurationId: string;
  providers: string[];
  compression: boolean;
  routing: boolean;
  status: 'planned' | 'ready';
  verificationTier: 'config-only';
  actions: PlannedAction[];
  paths: string[];
  capture: TaskBenchmarkCaptureStartReport | null;
  recoveryCommand: string;
}

function ownedKey(artifact: OwnedArtifact): string {
  if (artifact.kind === 'owned-json-entry')
    return `json ${artifact.path} ${artifact.pointer} ${artifact.placement} ${artifact.valueDigest}`;
  if (artifact.kind === 'owned-yaml-entry')
    return `yaml ${artifact.path} ${artifact.pointer} ${artifact.placement} ${artifact.valueDigest} ${artifact.lineDigest}`;
  if (artifact.kind === 'owned-marker-block')
    return `marker ${artifact.path} ${artifact.markerBegin} ${artifact.bodyDigest}`;
  return `file ${artifact.path} ${artifact.digest}`;
}

async function providerContext(
  context: CommandContext,
  fs: FileSystemPort,
): Promise<ProviderContext> {
  const adapters = context.adapters!;
  const detection = {
    fs,
    runner: adapters.runner,
    facts: context.platform,
    paths: adapters.paths,
    projectRoot: context.projectRoot,
  };
  const harnessConfigs = (
    await Promise.all(
      listHarnessAdapters()
        .filter((a) => a.manifest.id === context.harness)
        .map(async (a) => (await a.inspect(detection)).summaries),
    )
  ).flat();
  return {
    ...detection,
    harnessConfigs,
    now: context.now,
    localDatabase: adapters.localDatabase,
    projectIdFor: adapters.projectIdFor,
  };
}

async function verifyArm(
  context: CommandContext,
  fs: FileSystemPort,
  providers: readonly string[],
  compression: boolean,
  routing: boolean,
  version: string | null,
): Promise<Diagnostic[]> {
  const input = await providerContext(context, fs);
  const diagnostics: Diagnostic[] = [];
  for (const adapter of listProviderAdapters().filter((a) => providers.includes(a.manifest.id))) {
    const detected = await adapter.detect(input);
    if (
      detected.configuredHarnesses.includes(context.harness!) !== compression ||
      detected.state === 'broken'
    )
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'benchmark-compression-state-unverified',
          message: `${adapter.manifest.displayName} did not reach the requested ${compression ? 'ON' : 'OFF'} configuration`,
          subject: adapter.manifest.id,
          remediation:
            'Resolve custom configuration through ordinary setup/adoption before preparing this experiment',
        }),
      );
  }
  const observed = await observeNativePromptRouting({
    fs,
    home: context.home,
    stateRoot: context.stateRoot,
    harness: context.harness!,
    version,
    runner: context.adapters!.runner,
    facts: context.platform,
    paths: context.adapters!.paths,
    projectRoot: context.projectRoot,
    projectId: context.adapters!.projectIdFor(context.projectRoot),
  });
  if (observed.configured !== routing || observed.needsRepair === true)
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'benchmark-routing-state-unverified',
        message: `Native routing did not reach the requested ${routing ? 'ON' : 'OFF'} configuration: ${observed.detail}`,
        path: observed.configPath,
        remediation:
          'Resolve custom or unsupported native hooks through ordinary setup before benchmarking',
      }),
    );
  return diagnostics;
}

export async function runBenchmarkPrepare(
  context: CommandContext,
): Promise<CommandResult<BenchmarkPrepareReport | null>> {
  const command = 'benchmark-prepare';
  const refuse = (
    exitCode: 2 | 4 | 5 | 6 | 7 | 9,
    code: string,
    message: string,
    diagnostics: Diagnostic[] = [],
  ): CommandResult<BenchmarkPrepareReport | null> =>
    commandResult({
      command,
      exitCode,
      data: null,
      diagnostics: [
        ...diagnostics,
        diagnostic({
          severity: 'error',
          code,
          message,
          remediation: 'Review ordinary setup first; recover an active arm with benchmark-restore',
        }),
      ],
    });
  const id = context.benchmarkId ?? '';
  const variant = context.benchmarkVariant ?? '';
  const experiment = factorialExperimentForArm(variant, context.benchmarkStartingState ?? '');
  if (
    !isTaskBenchmarkId(id) ||
    experiment === null ||
    context.taskClass == null ||
    !(context.harness === harnessId('claude') || context.harness === harnessId('codex')) ||
    context.optimizationCandidate != null ||
    context.provider !== null
  )
    return refuse(
      2,
      'benchmark-prepare-inputs-required',
      'Use a factorial arm, --benchmark-id, --starting-state, --task and --harness claude|codex; the installed compression stack is selected automatically',
    );
  if (
    context.adapters === null ||
    context.stateRoot === null ||
    context.adapters.fs.writeFileExclusive === undefined ||
    context.adapters.fs.atomicWriteFile === undefined
  )
    return refuse(
      9,
      'benchmark-prepare-storage-unavailable',
      'Recoverable temporary configuration requires exclusive and atomic local file storage',
    );
  const { fs, runner } = context.adapters;
  const stateRoot = context.stateRoot;
  let session: BenchmarkArmSession | null = null;
  let ownsLease = false;
  try {
    const lease = await readMutationLease(fs, stateRoot);
    if (lease !== null)
      return refuse(
        5,
        'temporary-configuration-active',
        `Benchmark ${lease.benchmarkId} / ${lease.variant} must be finished or restored first`,
      );
    if ((await fs.stat(benchmarkSessionPath(context, id, variant))) !== null)
      return refuse(
        5,
        'benchmark-session-exists',
        'This arm already has an immutable checkpoint; use a new benchmark id',
      );
    const input = await providerContext(context, fs);
    const compressionAdapters = listProviderAdapters().filter(
      (a) => a.manifest.id === providerId('rtk') || a.manifest.id === providerId('harnesstrim'),
    );
    const providers: string[] = [];
    for (const adapter of compressionAdapters) {
      const detected = await adapter.detect(input);
      if (detected.state === 'broken')
        return refuse(
          9,
          'benchmark-provider-broken',
          `${adapter.manifest.displayName} cannot be benchmarked while broken`,
          detected.warnings,
        );
      if (
        detected.executable !== null &&
        detected.version !== null &&
        detected.assignableHarnesses.includes(context.harness)
      )
        providers.push(adapter.manifest.id);
      else if (detected.configuredHarnesses.includes(context.harness))
        return refuse(
          9,
          'benchmark-provider-unassignable',
          `The existing ${adapter.manifest.displayName} integration cannot be safely toggled`,
        );
    }
    if (providers.length === 0)
      return refuse(
        9,
        'benchmark-compression-provider-required',
        'No installed, supported RTK/HarnessTrim compression provider is available for this harness',
      );
    const computed = await computePlan({
      ...context,
      provider: null,
      providerSelection: providers.map(providerId),
      agentSkill: false,
      agentRouting: false,
      disableAgentRouting: false,
      nativePolicy: false,
    });
    if (computed.report.conflicts.length > 0)
      return refuse(
        4,
        'benchmark-compression-conflict',
        'The ordinary resolver refused the compression stack',
        computed.diagnostics,
      );
    if (
      computed.blocked.length > 0 ||
      computed.diagnostics.some((d) => d.severity === 'error') ||
      !computed.present.some((h) => h.id === context.harness)
    )
      return refuse(
        9,
        'benchmark-compression-plan-unavailable',
        'The installed stack has no supported configuration plan',
        computed.diagnostics,
      );
    const journalStore = new FileJournalStore({
      fs,
      journalRoot: fs.join(stateRoot, 'journals'),
      backupRoot: fs.join(stateRoot, 'backups'),
    });
    const owned = new Set(
      (await journalStore.list()).flatMap((j) => committedOwnership(j)).map(ownedKey),
    );
    const off: PlannedAction[] = [];
    for (const adapter of compressionAdapters.filter((a) => providers.includes(a.manifest.id))) {
      const removal = await adapter.plan(input, {
        ownership: computed.report.ownership.filter((o) => o.owner === adapter.manifest.id),
        harnesses: computed.present,
        desiredState: 'absent',
      });
      if (removal.diagnostics?.some((d) => d.severity === 'error'))
        return refuse(
          5,
          'benchmark-removal-plan-unavailable',
          'The provider removal plan is unsafe',
          removal.diagnostics,
        );
      for (const action of removal.actions) {
        if (action.kind === 'remove-owned-change') {
          if ((await fs.stat(action.path)) === null) continue;
          if (!owned.has(ownedKey(action.target)))
            return refuse(
              5,
              'benchmark-unowned-compression',
              'An OFF arm would remove configuration not owned by Token Harness',
              [
                diagnostic({
                  severity: 'error',
                  code: 'benchmark-unowned-path',
                  message: action.explanation,
                  path: action.path,
                  remediation: 'Adopt or resolve this configuration through ordinary setup first',
                }),
              ],
            );
        }
        off.push(action);
      }
    }
    const version = computed.versions.harnesses[context.harness] ?? null;
    const routingInput = {
      fs,
      home: context.home,
      stateRoot,
      harness: context.harness,
      version,
      runner,
      facts: context.platform,
      paths: context.adapters.paths,
      projectRoot: context.projectRoot,
    };
    const routingOn = await planNativePromptRoutingInstall(routingInput);
    const routingOff = await planNativePromptRoutingRemoval(routingInput);
    if ([...routingOn.diagnostics, ...routingOff.diagnostics].some((d) => d.severity === 'error'))
      return refuse(
        9,
        'benchmark-native-routing-unavailable',
        'Native routing cannot be prepared safely',
        [...routingOn.diagnostics, ...routingOff.diagnostics],
      );
    const on = computed.report.actions;
    const combinations = [
      [...off, ...routingOff.actions],
      [...on, ...routingOff.actions],
      [...off, ...routingOn.actions],
      [...on, ...routingOn.actions],
    ];
    const previews = [];
    // Every arm is proved feasible before the first arm mutates anything.
    for (let i = 0; i < combinations.length; i++) {
      const preview = await previewFilePlan(fs, combinations[i]!);
      const problems = await verifyArm(
        context,
        preview.fs,
        providers,
        i === 1 || i === 3,
        i >= 2,
        version,
      );
      if (problems.length > 0)
        return refuse(
          5,
          'benchmark-projected-arm-unverified',
          'At least one factorial arm cannot reach its requested configuration',
          problems,
        );
      previews.push(preview);
    }
    const inventory = [...new Set(previews.flatMap((p) => p.before.map((f) => f.path)))];
    if (
      inventory.some(
        (path) =>
          !fs.isInside(path, context.projectRoot) &&
          (context.home === null || !fs.isInside(path, context.home)),
      )
    )
      return refuse(
        5,
        'benchmark-configuration-outside-scope',
        'Temporary configuration targets must stay in this project or user home',
      );
    if (inventory.some((path) => fs.isInside(stateRoot, path)))
      return refuse(
        5,
        'benchmark-state-inside-configuration',
        'The state/checkpoint directory cannot live inside a temporary configuration target',
      );
    const actions =
      combinations[
        experiment.compression ? (experiment.routing ? 3 : 1) : experiment.routing ? 2 : 0
      ]!;
    const preview = await previewFilePlan(fs, actions, inventory);
    const initialConfigurationId = digestText(
      JSON.stringify({ providers, versions: computed.versions, files: preview.before }),
    );
    const planId = digestText(
      JSON.stringify({
        id,
        variant,
        experiment,
        harness: context.harness,
        taskClass: context.taskClass,
        qualityCheck: context.benchmarkCheck ?? null,
        projectId: context.adapters.projectIdFor(context.projectRoot),
        providers,
        initialConfigurationId,
        actions,
      }),
    ).slice(7, 15);
    if (context.planId !== null && context.planId !== planId)
      return refuse(
        5,
        'benchmark-plan-drift',
        `The reviewed plan ${context.planId} differs from current plan ${planId}`,
      );
    const transactionId =
      'factorial-' + digestText(JSON.stringify({ planId, at: context.now() })).slice(7, 31);
    session = {
      schemaVersion: 1,
      benchmarkId: id,
      variant,
      projectId: context.adapters.projectIdFor(context.projectRoot),
      harness: context.harness,
      transactionId,
      planId,
      initialConfigurationId,
      providers,
      status: 'applying',
      before: preview.before,
      prefixes: preview.prefixes,
      snapshots: [],
    };
    const startContext = {
      ...context,
      benchmarkPreparedConfiguration: preparedConfiguration(session),
    };
    const preflight = await runBenchmarkStart({ ...startContext, benchmarkValidateOnly: true });
    if (preflight.exitCode !== 0) return commandResult({ ...preflight, command, data: null });
    const data: BenchmarkPrepareReport = {
      benchmarkId: id,
      variant,
      planId,
      initialConfigurationId,
      providers,
      compression: experiment.compression,
      routing: experiment.routing,
      status: 'planned',
      verificationTier: 'config-only',
      actions,
      paths: preview.before.map((f) => f.path),
      capture: null,
      recoveryCommand: `token-harness benchmark-restore --benchmark-id ${id} --variant ${variant} --yes`,
    };
    const notes = [
      diagnostic({
        severity: 'info',
        code: 'benchmark-preparation-tier',
        message:
          'Configuration inspection is config-only. Start a fresh agent session; native hook trust and real prompt/child callbacks are still required for runtime attribution.',
        remediation: data.recoveryCommand,
      }),
    ];
    if (!context.confirmed)
      return commandResult({ command, exitCode: 0, data, diagnostics: notes });
    const creation = TransactionSnapshotStore.create({
      fs,
      backupRoot: fs.join(stateRoot, 'backups'),
      transactionId,
      projectRoot: await repositoryRootForBackupSafety(context),
      now: context.now,
    });
    if (!creation.ok)
      return refuse(
        5,
        'benchmark-backup-location-refused',
        'Original configuration cannot be backed up safely',
        [...creation.diagnostics],
      );
    // Backups and the checkpoint exist before the lease becomes actionable or any config write.
    for (const before of session.before) {
      const snapshot = await creation.store.capture(before.path);
      if (
        snapshot.existed !== (before.kind !== 'absent') ||
        snapshot.mode !== before.mode ||
        (before.kind === 'file' && snapshot.digest !== before.digest)
      )
        throw new Error(`Snapshot changed during capture: ${before.path}`);
      session.snapshots.push(snapshot);
    }
    const leaseRecord: MutationLease = {
      schemaVersion: 1,
      transactionId,
      benchmarkId: id,
      variant,
      projectId: session.projectId,
      acquiredAt: context.now(),
    };
    if (
      !(await fs.writeFileExclusive!(
        benchmarkSessionPath(context, id, variant),
        encodeBenchmarkSession(session),
      ))
    )
      return refuse(5, 'benchmark-session-race', 'Another process created this arm checkpoint');
    ownsLease = await fs.writeFileExclusive!(
      fs.join(stateRoot, MUTATION_LEASE_FILENAME),
      new TextEncoder().encode(JSON.stringify(leaseRecord) + '\n'),
    );
    if (!ownsLease)
      return refuse(5, 'benchmark-lease-race', 'Another prepared arm acquired the mutation lease');
    const actual = await Promise.all(session.before.map((f) => fileFingerprint(fs, f.path)));
    if (actual.some((f, i) => !fingerprintMatches(session!.before[i]!, f)))
      return refuse(
        5,
        'benchmark-preparation-drift',
        `Configuration changed before apply; no changes applied. Use ${data.recoveryCommand}`,
      );
    const initialSnapshots: SnapshotStore = {
      captured: session.snapshots,
      capture: async (path) => {
        const snapshot = session!.snapshots.find((s) => s.path === path);
        if (snapshot === undefined) throw new Error(`Unreviewed snapshot target: ${path}`);
        return snapshot;
      },
      captureAbsent: (path) => {
        const snapshot = session!.snapshots.find((s) => s.path === path && !s.existed);
        if (snapshot === undefined) throw new Error(`Unreviewed absence target: ${path}`);
        return snapshot;
      },
      restore: (snapshot) => creation.store.restore(snapshot),
      restoreAll: async () => {
        const drift = await benchmarkSessionDrift(fs, session!);
        if (drift.length > 0)
          throw new Error(`Concurrent changes block rollback: ${drift.join(', ')}`);
        await validateBenchmarkBackups(context, session!);
        await creation.store.restoreAll(session!.snapshots);
      },
    };
    const applied = await executeTransaction({
      transactionId,
      planId,
      projectId: session.projectId,
      projectRoot: context.projectRoot,
      actions,
      fs,
      snapshots: initialSnapshots,
      journal: journalStore,
      runner,
      now: context.now,
      pinned: true,
      verifyPostconditions: () =>
        verifyArm(context, fs, providers, experiment.compression, experiment.routing, version),
    });
    if (applied.exitCode !== 0) {
      const restored = await restoreBenchmarkSession({ ...context, confirmed: true }, session);
      return commandResult({
        command,
        exitCode: restored.exitCode === 0 ? (applied.exitCode === 7 ? 6 : applied.exitCode) : 7,
        data: null,
        diagnostics: [...applied.diagnostics, ...restored.diagnostics],
      });
    }
    const final = await Promise.all(session.before.map((f) => fileFingerprint(fs, f.path)));
    if (final.some((f, i) => !fingerprintMatches(session!.prefixes.at(-1)![i]!, f)))
      throw new Error('Applied bytes did not match the reviewed preview');
    session.prefixes[session.prefixes.length - 1] = final;
    session.status = 'ready';
    await saveBenchmarkSession(context, session);
    const started = await runBenchmarkStart(startContext);
    if (started.exitCode !== 0) {
      const restored = await restoreBenchmarkSession({ ...context, confirmed: true }, session);
      return commandResult({
        command,
        exitCode: restored.exitCode === 0 ? started.exitCode : 7,
        data: null,
        diagnostics: [...started.diagnostics, ...restored.diagnostics],
      });
    }
    return commandResult({
      command,
      exitCode: 0,
      data: { ...data, status: 'ready', capture: started.data },
      diagnostics: [...notes, ...started.diagnostics],
    });
  } catch (error) {
    const diagnostics: Diagnostic[] = [
      diagnostic({
        severity: 'error',
        code: 'benchmark-preparation-failed',
        message: error instanceof Error ? error.message : 'Configuration preparation failed',
        remediation:
          ownsLease && session !== null
            ? `Run benchmark-restore --benchmark-id ${id} --variant ${variant} --yes; preserve ${session.transactionId} backups`
            : 'Resolve ordinary setup before retrying with a new benchmark id',
      }),
    ];
    if (ownsLease && session !== null) {
      try {
        const recovery = await restoreBenchmarkSession({ ...context, confirmed: true }, session);
        return commandResult({
          command,
          exitCode: recovery.exitCode === 0 ? 6 : 7,
          data: null,
          diagnostics: [...diagnostics, ...recovery.diagnostics],
        });
      } catch {
        return refuse(
          7,
          'benchmark-preparation-recovery-required',
          `Recovery could not complete for ${session.transactionId}; paths: ${session.before.map((f) => f.path).join(', ')}`,
          diagnostics,
        );
      }
    }
    return commandResult({ command, exitCode: 5, data: null, diagnostics });
  }
}
