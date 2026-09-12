/**
 * `token-harness update` — RFC 0001 §CLI contract, the last of the nine commands it declares.
 *
 * RFC 0004 §Provider update policy governs it, and implementing it is what forced RFC 0004
 * §Amended: three of that section's six bullets named a mechanism they did not specify. What
 * follows is the contract that amendment fixed, not an interpretation of the bullets.
 *
 * ## Two versions, from two different places
 *
 * RFC 0006 makes mutating commands dry-run by default, so this has to print `0.42.0 → 0.44.0`
 * before touching anything. The installed side comes from the provider's own `detect`; the
 * available side comes from the **installation channel**, because that is where the knowledge is —
 * `winget` knows what exists for `rtk-ai.rtk` and RTK's adapter has no idea.
 *
 * ## Package compatibility is not harness mutation compatibility
 *
 * Replacing an installed provider package does not itself write Claude, Codex or OpenCode config.
 * Provider package updates therefore use the provider-level reviewed update policy. Exact
 * provider × harness × version × platform rows remain mandatory when a later plan wants to mutate
 * an integration; they no longer freeze the package binary at the version of the oldest fixture.
 *
 * ## What it will not do
 *
 * - **Install a provider that is absent.** `update` updates. A machine without RTK is `plan`'s
 *   business, and an update that silently installed would be an install nobody reviewed as one.
 * - **Downgrade.** A channel offering an older version than the one installed is reported as
 *   `current`, not acted on: the user may have deliberately installed something newer, and
 *   RFC 0004's binary rollback is a rollback, not an update.
 * - **Guess.** A channel that cannot be read produces `unknown` and no action. The alternative —
 *   reporting "already current" — is the same sentence a user reads as good news.
 * - **Cross an unreviewed provider package target.** A future provider release remains visible but
 *   unattended update stops until its consumed contract has been reviewed.
 * - **Elevate.** Inherited from the executor: `runPackageManagerInstall` refuses an action needing
 *   elevation and hands back the command to run.
 *
 * ## The pin is a refusal
 *
 * RFC 0004 §Amended: a pinned provider is skipped and the pin is named, and that is *not* a
 * problem — an environment the user deliberately froze is a state, in the sense RFC 0006 means it.
 * So a pin does not change the exit code.
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

/** Mirrors `apply.ts`: derived from the content and the instant, never random. */
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

interface RunUpdateOptions {
  preserveConfirmationReport?: boolean;
}

export async function runUpdate(
  context: CommandContext,
  options: RunUpdateOptions = {},
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

  // Provider detection may use live harness summaries to report where a tool is wired. That is a
  // read-only observation and deliberately carries no ownership or mutation-admission meaning.
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

    if (detection.state === 'absent') {
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
    if (installed === null || offered === null || compareVersions(offered, installed) <= 0) {
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
    actions.push(
      upgradeAction({
        providerId: adapter.manifest.id,
        channel: channel.id,
        packageName,
        target: query.version,
        requiresNetwork: channel.requiresNetwork,
        requiresElevation: channel.requiresElevation,
        installed: detection.version ?? 'an unknown version',
      }),
    );
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
    // A newer version existing is not itself an actionable problem. Refusing to cross the reviewed
    // provider package boundary is a successful update check, analogous to a deliberate pin.
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

/**
 * Dashboard-only observation path. It can never apply an update: confirmation is forced off even
 * if a caller accidentally supplies a confirmed context. The ordinary CLI keeps exit 8 + null data
 * for its public JSON contract; this internal adapter turns that already-computed dry-run into a
 * successful read-only report for the local UI.
 */
export async function runUpdateCheck(
  context: CommandContext,
): Promise<CommandResult<UpdateReport>> {
  const result = await runUpdate(
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
