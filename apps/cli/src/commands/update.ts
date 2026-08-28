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
 * ## What it will not do
 *
 * - **Install a provider that is absent.** `update` updates. A machine without RTK is `plan`'s
 *   business, and an update that silently installed would be an install nobody reviewed as one.
 * - **Downgrade.** A channel offering an older version than the one installed is reported as
 *   `current`, not acted on: the user may have deliberately installed something newer, and
 *   RFC 0004's binary rollback is a rollback, not an update.
 * - **Guess.** A channel that cannot be read produces `unknown` and no action. The alternative —
 *   reporting "already current" — is the same sentence a user reads as good news.
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
  COMPATIBILITY_ROWS,
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  admitManagedMutation,
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
  type PackageManagerInstallAction,
  type InstallationChannel,
  type ManagedIntegration,
  type ProviderUpdateRow,
  type UpdateReport,
} from '@token-harness/core';
import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';

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

/**
 * Reads only explicit product-level ownership from committed journals.
 *
 * A configured provider is not enough: RFC 0004 brownfield adoption means the same live hook can
 * be user-owned or Token-Harness-owned. Journals written before this field existed simply provide
 * no evidence here; they are never upgraded into ownership by inference.
 */
async function managedIntegrations(context: CommandContext): Promise<ManagedIntegration[]> {
  if (context.adapters === null || context.stateRoot === null) return [];

  const journalRoot = context.adapters.fs.join(context.stateRoot, 'journals');
  if ((await context.adapters.fs.stat(journalRoot)) === null) return [];

  const store = new FileJournalStore({
    fs: context.adapters.fs,
    journalRoot,
    backupRoot: context.adapters.fs.join(context.stateRoot, 'backups'),
  });
  const seen = new Set<string>();
  const result: ManagedIntegration[] = [];
  for (const journal of await store.list()) {
    if (journal.outcome !== 'committed') continue;
    for (const integration of journal.managedIntegrations ?? []) {
      const key = `${integration.providerId}\0${integration.harnessId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(integration);
    }
  }
  return result;
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
    // The same class the install action uses, for the same reason: an installed package is not
    // reversed by restoring a file.
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
    /**
     * `package-inventory` where the channel can report what is installed, `none` otherwise.
     *
     * An update replaces a binary. Rolling the transaction back restores files and leaves the new
     * version in place, so the executor's receipt is not boilerplate here — it is the difference
     * between the machine being restored and the *configuration* being restored. With an
     * inventory-capturing channel the rollback also reinstalls the previous version, and the
     * receipt says per package whether that reinstall took.
     */
    rollbackData: channelCanReportInventory(input.channel) ? 'package-inventory' : 'none',
    explanation: `Update ${input.packageName} from ${input.installed} to ${input.target} through ${input.channel}`,
    packageManager: input.channel,
    packageName: input.packageName,
    // Pinned to the exact version the channel reported, not left open. An unpinned upgrade would
    // install whatever is newest at execution time, which is not the version the dry run showed.
    version: input.target,
  };
}

export async function runUpdate(context: CommandContext): Promise<CommandResult<UpdateReport>> {
  const diagnostics: Diagnostic[] = [];
  const report: UpdateReport = { providers: [], network: [], execution: null };

  const finish = (exitCode: ExitCode, data: UpdateReport | null): CommandResult<UpdateReport> =>
    commandResult<UpdateReport>({
      command: 'update',
      exitCode,
      // RFC 0006: `data` is null when the status is `error`, and the human renderer must read the
      // same object it serializes — the defect `apply` already had to fix.
      data: statusForExitCode(exitCode) === 'error' ? null : data,
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

  const managed = await managedIntegrations(context);
  const managedHarnessIds = new Set(managed.map((entry) => entry.harnessId));
  const harnessVersions = new Map<string, string | null>();
  if (managedHarnessIds.size > 0) {
    const harnessContext = {
      fs: adapters.fs,
      runner: adapters.runner,
      facts: context.platform,
      paths: adapters.paths,
      projectRoot: context.projectRoot,
    };
    for (const harness of listHarnessAdapters()) {
      if (!managedHarnessIds.has(harness.manifest.id)) continue;
      const detection = await harness.detect(harnessContext);
      harnessVersions.set(harness.manifest.id, detection.version);
    }
  }

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
    harnessConfigs: [],
    now: context.now,
    localDatabase: adapters.localDatabase,
    projectIdFor: adapters.projectIdFor,
  };

  const actions: PackageManagerInstallAction[] = [];
  const blockedUpdates: Array<{
    providerId: string;
    target: string;
    harnessId: string;
    missing: string;
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
      // Two distinct states, not one. `unknown` means the channel answered and its answer was
      // unreadable; `unavailable` means it was never asked or would not run. The diagnostics from
      // the query carry the specific reason either way.
      row.verdict = query.status === 'unknown' ? 'unknown' : 'unavailable';
      report.providers.push(row);
      continue;
    }

    const installed = detection.version === null ? null : parseSemanticVersion(detection.version);
    const offered = parseSemanticVersion(query.version);
    if (installed === null || offered === null || compareVersions(offered, installed) <= 0) {
      /**
       * `current` covers "same" and "the channel is behind", deliberately.
       *
       * A channel offering something older than what is installed is not an update opportunity in
       * either direction: RFC 0004's binary rollback exists for going backwards and is a different
       * command. An unparseable installed version lands here too — it is not a version this build
       * can compare, so it is not one it will act on.
       */
      row.verdict = 'current';
      report.providers.push(row);
      continue;
    }

    const managedHarnesses = managed.filter((entry) => entry.providerId === adapter.manifest.id);
    let updateAdmitted = true;
    for (const integration of managedHarnesses) {
      const admission = admitManagedMutation(context.compatibilityRows ?? COMPATIBILITY_ROWS, {
        provider: adapter.manifest.id,
        providerVersion: query.version,
        harness: integration.harnessId,
        harnessVersion: harnessVersions.get(integration.harnessId) ?? null,
        os: context.platform.os,
        wsl: context.platform.isWsl,
      });
      if (admission.state === 'admitted') continue;
      updateAdmitted = false;
      blockedUpdates.push({
        providerId: adapter.manifest.id,
        target: query.version,
        harnessId: integration.harnessId,
        missing: admission.missing,
      });
    }

    if (!updateAdmitted) {
      row.verdict = 'blocked-unreviewed';
      report.providers.push(row);
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

  const blockedIsOutcome = blockedUpdates.length > 0 && actions.length === 0;
  for (const blocked of blockedUpdates) {
    diagnostics.push(
      diagnostic({
        severity: blockedIsOutcome ? 'error' : 'warning',
        code: 'managed-update-blocked',
        message: `update refuses ${blocked.providerId} ${blocked.target} on managed ${blocked.harnessId}: ${blocked.missing}`,
        remediation:
          'Record a compatibility row and fixture for the target version before updating this managed integration',
      }),
    );
  }

  if (pins.unhonoredProjectPinPath !== null) {
    // Already carried as a diagnostic by `readPins`; nothing more to add here, and adding a
    // second one would make the same fact look like two findings.
  }

  if (actions.length === 0 && blockedUpdates.length > 0) {
    report.execution = emptyExecution('rejected');
    return finish(EXIT_CODES['unsupported-environment'], report);
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
        // In the message and not only in `data`: exit 8 is an `error` status, so `data` is null.
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

  /**
   * An update runs through the transaction engine even though it touches no file.
   *
   * Nothing here needs a snapshot — a package is not a file — so the engine's restore machinery
   * has nothing to do. What it does supply is the journal: RFC 0004 requires the record to be
   * written before the work, and a provider version that changed with no journal entry is a
   * change `status` and `rollback` cannot see. Running the install outside the engine would have
   * been simpler and would have made the update the one mutation with no history.
   */
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
    // Mapped the way `apply` maps it: `in-progress` is not a terminal outcome a report may
    // carry, and anything that is not one of the three known ends is a rejection.
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
