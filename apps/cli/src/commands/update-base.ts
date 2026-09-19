/**
 * `token-harness update` package-channel implementation.
 *
 * Kept byte-for-byte in behavior while the Windows RTK release coordinator is layered in front of
 * it. The direct RTK path is provider-specific; every ordinary package-manager update continues to
 * use this transaction engine unchanged.
 */

import {
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  channelCanReportInventory,
  commandResult,
  compareVersions,
  diagnostic,
  digestText,
  executeTransaction,
  parseSemanticVersion,
  preferredInstallationChannel,
  queryAvailableVersion,
  readPins,
  statusForExitCode,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type InstallationChannel,
  type PackageManagerInstallAction,
  type ProviderUpdateRow,
  type UpdateReport,
} from '@token-harness/core';
import {
  admitProviderPackageUpdate,
  listHarnessAdapters,
  listProviderAdapters,
} from '@token-harness/adapters';

import type { CommandContext } from './context.js';

function transactionIdFor(seed: string, at: string): string {
  const digest = digestText(`${seed} ${at}`);
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 13);
}

function emptyExecution(outcome: ApplyReport['outcome']): ApplyReport {
  return {
    planId: null,
    transactionId: null,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
  };
}

function upgradeAction(input: {
  providerId: string;
  channel: string;
  packageName: string;
  target: string;
  requiresNetwork: boolean;
  requiresElevation: boolean;
  installed: string;
}): PackageManagerInstallAction {
  const digest = digestText(`${input.providerId} update ${input.channel} ${input.target}`);
  return {
    kind: 'package-manager-install',
    id: digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 9),
    riskClass: 'delegated',
    requiresNetwork: input.requiresNetwork,
    requiresElevation: input.requiresElevation,
    affectedPaths: [],
    affectedProcesses: [input.channel],
    preconditions: [
      `${input.channel} is available on this machine`,
      `${input.packageName} is installed at ${input.installed}`,
    ],
    postconditions: [`${input.packageName} reports ${input.target}`],
    rollbackData: channelCanReportInventory(input.channel) ? 'package-inventory' : 'none',
    explanation: `Update ${input.packageName} from ${input.installed} to ${input.target} through ${input.channel}`,
    packageManager: input.channel,
    packageName: input.packageName,
    version: input.target,
  };
}

export interface RunPackageChannelUpdateOptions {
  preserveConfirmationReport?: boolean;
}

export async function runPackageChannelUpdate(
  context: CommandContext,
  options: RunPackageChannelUpdateOptions = {},
): Promise<CommandResult<UpdateReport>> {
  const diagnostics: Diagnostic[] = [];
  const report: UpdateReport = { providers: [], network: [], execution: null };

  const finish = (exitCode: ExitCode, data: UpdateReport | null): CommandResult<UpdateReport> =>
    commandResult<UpdateReport>({
      command: 'update',
      exitCode,
      data:
        statusForExitCode(exitCode) === 'error' &&
        !(options.preserveConfirmationReport && exitCode === EXIT_CODES['confirmation-required'])
          ? null
          : data,
      diagnostics,
    });

  if (context.adapters === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'unsupported-environment',
        message: 'No platform adapters are available, so no channel can be consulted',
        remediation: null,
      }),
    );
    return finish(EXIT_CODES['unsupported-environment'], null);
  }

  const adapters = context.adapters;
  const providerAdapters = listProviderAdapters().filter(
    (adapter) => context.provider === null || adapter.manifest.id === context.provider,
  );

  const harnessContext = {
    fs: adapters.fs,
    runner: adapters.runner,
    facts: context.platform,
    paths: adapters.paths,
    projectRoot: context.projectRoot,
  };
  const harnessConfigs = (
    await Promise.all(
      listHarnessAdapters().map(
        async (harness) => (await harness.inspect(harnessContext)).summaries,
      ),
    )
  ).flat();

  const pins =
    context.stateRoot === null
      ? { pins: new Map<string, string>(), unhonoredProjectPinPath: null, diagnostics: [] }
      : await readPins({
          fs: adapters.fs,
          stateRoot: context.stateRoot,
          projectRoot: context.projectRoot,
        });
  diagnostics.push(...pins.diagnostics);

  const providerContext = {
    fs: adapters.fs,
    runner: adapters.runner,
    facts: context.platform,
    paths: adapters.paths,
    projectRoot: context.projectRoot,
    harnessConfigs,
    now: context.now,
    localDatabase: adapters.localDatabase,
    projectIdFor: adapters.projectIdFor,
  };

  const actions: PackageManagerInstallAction[] = [];
  const updateTargets = new Map<
    string,
    {
      providerId: string;
      target: string;
      adapter: (typeof providerAdapters)[number];
    }
  >();
  const blockedUpdates: Array<{
    providerId: string;
    installed: string | null;
    target: string;
    reason: string;
  }> = [];
  const destinations = new Set<string>();

  for (const adapter of providerAdapters) {
    const detection = await adapter.detect(providerContext);
    const channel = preferredInstallationChannel<InstallationChannel>(
      adapter.manifest.installationChannels,
      context.platform.os,
    );
    const row: ProviderUpdateRow = {
      providerId: adapter.manifest.id,
      installed: detection.version,
      available: null,
      channel: channel?.id ?? null,
      verdict: 'unknown',
      pin: pins.pins.get(adapter.manifest.id) ?? null,
    };

    if (detection.state === 'absent' || detection.executable === null) {
      row.verdict = 'not-installed';
      report.providers.push(row);
      continue;
    }

    if (row.pin !== null) {
      row.verdict = 'pinned';
      report.providers.push(row);
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'provider-pinned',
          message: `${adapter.manifest.id} is pinned at ${row.pin}, so no update was planned for it`,
          remediation: `Remove it from the pin file to allow updates`,
        }),
      );
      continue;
    }

    if (channel === null) {
      row.verdict = 'no-channel';
      report.providers.push(row);
      continue;
    }

    const packageName = channel.packageId ?? adapter.manifest.id;
    const query = await queryAvailableVersion({
      packageManager: channel.id,
      packageName,
      runner: adapters.runner,
      cwd: context.projectRoot,
    });
    diagnostics.push(...query.diagnostics);
    if (query.destination !== null) destinations.add(query.destination);

    row.available = query.version;
    if (query.status !== 'found' || query.version === null) {
      row.verdict = query.status === 'unknown' ? 'unknown' : 'unavailable';
      report.providers.push(row);
      continue;
    }

    const installed = detection.version === null ? null : parseSemanticVersion(detection.version);
    const offered = parseSemanticVersion(query.version);
    if (installed === null || offered === null) {
      row.verdict = 'unknown';
      report.providers.push(row);
      continue;
    }
    if (compareVersions(offered, installed) <= 0) {
      row.verdict = 'current';
      report.providers.push(row);
      continue;
    }

    const admission = admitProviderPackageUpdate(adapter.manifest.id, query.version);
    if (admission.state !== 'admitted') {
      row.verdict = 'blocked-unreviewed';
      report.providers.push(row);
      blockedUpdates.push({
        providerId: adapter.manifest.id,
        installed: detection.version,
        target: query.version,
        reason: admission.reason,
      });
      continue;
    }

    row.verdict = 'upgradable';
    report.providers.push(row);
    const action = upgradeAction({
      providerId: adapter.manifest.id,
      channel: channel.id,
      packageName,
      target: query.version,
      requiresNetwork: channel.requiresNetwork,
      requiresElevation: channel.requiresElevation,
      installed: detection.version ?? 'an unknown version',
    });
    actions.push(action);
    updateTargets.set(action.id, {
      providerId: adapter.manifest.id,
      target: query.version,
      adapter,
    });
  }

  report.network = [...destinations].sort();

  for (const blocked of blockedUpdates) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'provider-update-target-unreviewed',
        message: `${blocked.providerId} ${blocked.target} is available but is outside the reviewed provider package-update policy; keeping ${blocked.installed ?? 'the installed version'}`,
        remediation:
          'Review the provider package contract before enabling unattended update to this release',
      }),
    );
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'provider-update-target-unreviewed-detail',
        message: blocked.reason,
        remediation: null,
      }),
    );
  }

  if (pins.unhonoredProjectPinPath !== null) {
    // Already carried as a diagnostic by `readPins`; nothing more to add here.
  }

  if (actions.length === 0 && blockedUpdates.length > 0) {
    report.execution = emptyExecution('nothing-to-do');
    return finish(EXIT_CODES.ok, report);
  }

  if (actions.length === 0) {
    report.execution = emptyExecution('nothing-to-do');
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'nothing-to-update',
        message: 'No provider has a newer version available through its channel',
        remediation: null,
      }),
    );
    return finish(EXIT_CODES.ok, report);
  }

  if (!context.confirmed) {
    const summary = report.providers
      .filter((entry) => entry.verdict === 'upgradable')
      .map((entry) => `${entry.providerId} ${String(entry.installed)} → ${String(entry.available)}`)
      .join(', ');
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        message: `Would update ${summary}`,
        remediation: 'Re-run with `--yes` to apply it',
      }),
    );
    report.execution = emptyExecution('confirmation-required');
    return finish(EXIT_CODES['confirmation-required'], report);
  }

  if (context.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No transactional state directory is available, so nothing was updated',
        remediation: null,
      }),
    );
    return finish(EXIT_CODES['unsupported-environment'], null);
  }

  const fs = adapters.fs;
  const startedAt = context.now();
  const transactionId = transactionIdFor(actions.map((action) => action.id).join(' '), startedAt);

  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId,
    projectRoot: context.projectRoot,
    now: context.now,
  });
  if (!creation.ok) {
    diagnostics.push(...creation.diagnostics);
    return finish(EXIT_CODES['unsupported-environment'], null);
  }

  const transaction = await executeTransaction({
    transactionId,
    planId: null,
    projectId: adapters.projectIdFor(context.projectRoot),
    projectRoot: context.projectRoot,
    actions,
    fs,
    snapshots: creation.store,
    journal: new FileJournalStore({
      fs,
      journalRoot: fs.join(context.stateRoot, 'journals'),
      backupRoot: fs.join(context.stateRoot, 'backups'),
    }),
    runner: adapters.runner,
    now: context.now,
    verifyPostconditions: async (applied) => {
      const postconditions: Diagnostic[] = [];
      for (const outcome of applied) {
        if (outcome.status !== 'applied' && outcome.status !== 'already-satisfied') continue;
        const target = updateTargets.get(outcome.actionId);
        if (target === undefined) continue;

        const detection = await target.adapter.detect(providerContext);
        const observed =
          detection.version === null ? null : parseSemanticVersion(detection.version);
        const expected = parseSemanticVersion(target.target);
        const exactTarget =
          observed !== null && expected !== null && compareVersions(observed, expected) === 0;
        if (!exactTarget) {
          postconditions.push(
            diagnostic({
              severity: 'error',
              code: 'provider-update-version-not-observed',
              subject: target.adapter.manifest.id,
              message:
                `${target.providerId} update did not become active: requested ${target.target}, but the executable currently resolved on PATH reports ${detection.version ?? 'no readable version'}`,
              path: detection.executable,
              remediation:
                'Review duplicate PATH installations. Token Harness will not report this update as successful while the old executable is still the one being resolved.',
            }),
          );
          continue;
        }

        const capabilityProblem = detection.warnings.find(
          (warning) =>
            /capabilit/i.test(warning.code) &&
            /(unavailable|drift|mismatch|unsupported)/i.test(warning.code),
        );

        if (
          target.adapter.manifest.id === 'harnesstrim' &&
          (detection.versionVerdict !== 'in-range' || capabilityProblem !== undefined)
        ) {
          postconditions.push(
            diagnostic({
              severity: 'error',
              code: 'harnesstrim-update-contract-mismatch',
              subject: target.adapter.manifest.id,
              message:
                `HarnessTrim ${target.target} was installed, but its machine-readable capability/artifact contract did not pass Token Harness validation` +
                (capabilityProblem === undefined ? '' : `: ${capabilityProblem.message}`),
              path: detection.executable,
              remediation:
                'Keep the previous working HarnessTrim release until the changed contract is understood.',
            }),
          );
          continue;
        }

        if (
          ['mcptoon', 'gitnexus', 'headroom'].includes(target.adapter.manifest.id) &&
          (detection.assignableHarnesses.length === 0 || capabilityProblem !== undefined)
        ) {
          postconditions.push(
            diagnostic({
              severity: 'error',
              code: 'provider-update-capability-unavailable',
              subject: target.adapter.manifest.id,
              message:
                `${target.providerId} ${target.target} became active on PATH, but the installed build no longer exposes the runtime capability surface required by Token Harness` +
                (capabilityProblem === undefined ? '' : `: ${capabilityProblem.message}`),
              path: detection.executable,
              remediation:
                'Keep the previous working provider release until the changed CLI capability surface is understood.',
            }),
          );
          continue;
        }

        postconditions.push(
          diagnostic({
            severity: 'info',
            code: 'provider-update-version-verified',
            subject: target.adapter.manifest.id,
            message: `${target.providerId} ${target.target} is now the executable resolved on PATH and passed post-update detection`,
            path: detection.executable,
            remediation: null,
          }),
        );
      }
      return postconditions;
    },
  });
  diagnostics.push(...transaction.diagnostics);

  report.execution = {
    planId: null,
    transactionId,
    fromStoredPlan: false,
    outcome:
      transaction.journal.outcome === 'committed'
        ? 'committed'
        : transaction.journal.outcome === 'rolled-back'
          ? 'rolled-back'
          : transaction.journal.outcome === 'dirty'
            ? 'dirty'
            : 'rejected',
    results: transaction.journal.entries.map((entry) => ({
      actionId: entry.actionId,
      kind: entry.kind,
      status: entry.status,
      path: null,
    })),
    unrestored: transaction.unrestored,
    receiptId: transaction.journal.outcome === 'committed' ? transactionId : null,
  };

  return finish(transaction.exitCode, report);
}

export async function runPackageChannelUpdateCheck(
  context: CommandContext,
): Promise<CommandResult<UpdateReport>> {
  const result = await runPackageChannelUpdate(
    { ...context, confirmed: false },
    { preserveConfirmationReport: true },
  );
  if (result.exitCode !== EXIT_CODES['confirmation-required'] || result.data === null)
    return result;
  return commandResult<UpdateReport>({
    command: 'update',
    exitCode: EXIT_CODES.ok,
    data: result.data,
    diagnostics: result.diagnostics.filter((entry) => entry.code !== 'confirmation-required'),
  });
}
