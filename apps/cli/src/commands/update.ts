/**
 * `token-harness update` coordinator.
 *
 * Provider package updates and Token Harness' own npm update stay in `update-base.ts` and retain
 * the existing package-manager transaction. RTK uses an exact official GitHub release on
 * Linux/macOS, where the Cargo registry package name collides with another project, and as a
 * fallback on native Windows when WinGet is behind.
 *
 * The direct route still participates in Token Harness' normal durability contract: the exact
 * pre-update binary is snapshotted under a transaction id and an in-progress journal is persisted
 * before mutation. The journal records the release URL/digest and can later drive the ordinary
 * `rollback` command after a committed update. `--yes` is the explicit adoption boundary for the
 * existing binary; multiple PATH candidates are refused rather than guessed.
 */

import {
  EXIT_CODES,
  FileJournalStore,
  JOURNAL_SCHEMA_VERSION,
  TransactionSnapshotStore,
  commandResult,
  diagnostic,
  digestText,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type TransactionJournal,
  type TransactionOutcomeKind,
  type UpdateReport,
} from '@token-harness/core';
import { RTK_RELEASE_ASSET_DESTINATION } from '@token-harness/platform';

import type { CommandContext } from './context.js';
import { repositoryRootForBackupSafety } from './snapshot-safety.js';
import { runPackageChannelUpdate, runPackageChannelUpdateCheck } from './update-base.js';
import {
  planDirectRtkRelease,
  type DirectRtkReleasePlan,
  type DirectRtkReleasePlanningResult,
} from './rtk-release-update.js';

interface PreparedDirectUpdate {
  ordinary: CommandResult<UpdateReport>;
  report: UpdateReport;
  plan: DirectRtkReleasePlan | null;
  directDiagnostics: Diagnostic[];
}

function directTransactionId(plan: DirectRtkReleasePlan, at: string): string {
  const digest = digestText(`rtk github-release ${plan.id} ${at}`);
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 13);
}

function execution(input: {
  transactionId: string | null;
  outcome: ApplyReport['outcome'];
  directPlan: DirectRtkReleasePlan;
  directStatus: string;
  base?: ApplyReport | null;
  unrestored?: string[];
}): ApplyReport {
  const direct = {
    actionId: input.directPlan.id,
    kind: 'download-artifact',
    status: input.directStatus,
    path: input.directPlan.targetPath,
  };
  return {
    planId: null,
    transactionId: input.base?.transactionId ?? input.transactionId,
    fromStoredPlan: false,
    outcome: input.outcome,
    results: [direct, ...(input.base?.results ?? [])],
    unrestored: input.unrestored ?? input.base?.unrestored ?? [],
    receiptId:
      input.base?.receiptId ??
      (input.outcome === 'committed' && input.transactionId !== null ? input.transactionId : null),
  };
}

function withDirectRow(report: UpdateReport, direct: DirectRtkReleasePlanningResult): UpdateReport {
  return {
    providers: report.providers.map((row) =>
      row.providerId === 'rtk'
        ? {
            ...row,
            available: direct.availableVersion,
            channel: 'github-release',
            verdict:
              direct.verdict === 'current' ? 'current' : direct.plan ? 'upgradable' : 'unavailable',
          }
        : row,
    ),
    ...(report.application === undefined ? {} : { application: report.application }),
    network: [...new Set([...report.network, ...direct.destinations])].sort(),
    execution: report.execution,
  };
}

async function prepareDirectRtkUpdate(
  context: CommandContext,
): Promise<PreparedDirectUpdate | null> {
  if (context.adapters === null) return null;
  if (!['windows', 'linux', 'macos'].includes(context.platform.os)) return null;
  if (context.provider !== null && context.provider !== 'rtk') return null;
  if (context.adapters.resolveExecutables === undefined) return null;

  const ordinary = await runPackageChannelUpdateCheck(context);
  if (ordinary.data === null) return null;
  const row = ordinary.data.providers.find((entry) => entry.providerId === 'rtk');
  if (row === undefined || row.installed === null || row.pin !== null) return null;

  const executables = context.adapters.resolveExecutables('rtk');
  const direct = await planDirectRtkRelease({
    providerId: row.providerId,
    installedVersion: row.installed,
    executables,
    channelAvailableVersion: row.available,
    platform: context.platform,
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    ...(context.adapters.rtkReleaseFetch === undefined
      ? {}
      : { releaseFetch: context.adapters.rtkReleaseFetch }),
  });

  if (direct.verdict === 'defer' || direct.verdict === 'unsupported') return null;
  return {
    ordinary,
    report: withDirectRow(ordinary.data, direct),
    plan: direct.plan,
    directDiagnostics: direct.diagnostics,
  };
}

function confirmationDiagnostic(report: UpdateReport): Diagnostic {
  const summary = report.providers
    .filter((entry) => entry.verdict === 'upgradable')
    .map((entry) => `${entry.providerId} ${String(entry.installed)} → ${String(entry.available)}`)
    .join(', ');
  return diagnostic({
    severity: 'error',
    code: 'confirmation-required',
    message: `Would update ${summary}`,
    remediation: 'Re-run with `--yes` to apply it',
  });
}

function adoptionConfirmationDiagnostic(plan: DirectRtkReleasePlan): Diagnostic {
  return diagnostic({
    severity: 'error',
    code: 'rtk-release-existing-binary-adoption-required',
    subject: 'rtk',
    path: plan.targetPath,
    message: `The GitHub release fallback would replace the existing RTK executable at ${plan.targetPath}. This exact path will be snapshotted and adopted for this confirmed update only.`,
    remediation:
      'Re-run with `--yes` only if this is the RTK executable you intend Token Harness to replace; otherwise fix PATH first',
  });
}

function provenanceDiagnostic(plan: DirectRtkReleasePlan): Diagnostic {
  return diagnostic({
    severity: 'info',
    code: 'rtk-release-provenance',
    subject: 'rtk',
    path: plan.targetPath,
    message: `Confirmed RTK ${plan.installed} → ${plan.target} replacement of ${plan.targetPath} from ${plan.asset.tag} asset ${plan.asset.downloadUrl}; published archive sha256:${plan.asset.sha256}; ${String(plan.asset.sizeBytes)} bytes`,
    remediation: null,
  });
}

function result(
  exitCode: ExitCode,
  data: UpdateReport | null,
  diagnostics: readonly Diagnostic[],
): CommandResult<UpdateReport> {
  return commandResult({ command: 'update', exitCode, data, diagnostics: [...diagnostics] });
}

function mergePreparedRtkRow(
  report: UpdateReport | null,
  prepared: UpdateReport,
): UpdateReport | null {
  if (report === null) return null;
  const rtk = prepared.providers.find((row) => row.providerId === 'rtk');
  if (rtk === undefined) return report;
  return {
    ...report,
    providers: report.providers.some((row) => row.providerId === 'rtk')
      ? report.providers.map((row) => (row.providerId === 'rtk' ? rtk : row))
      : [...report.providers, rtk],
    ...(report.application === undefined && prepared.application !== undefined
      ? { application: prepared.application }
      : {}),
    network: [...new Set([...report.network, ...prepared.network])].sort(),
  };
}

/** Public mutating update path. */
export async function runUpdate(context: CommandContext): Promise<CommandResult<UpdateReport>> {
  const prepared = await prepareDirectRtkUpdate(context);
  if (prepared === null) return runPackageChannelUpdate(context);

  if (prepared.plan === null) {
    const ordinary = await runPackageChannelUpdate(context);
    const report = mergePreparedRtkRow(ordinary.data, prepared.report);
    return result(ordinary.exitCode, report, [
      ...ordinary.diagnostics,
      ...prepared.directDiagnostics,
    ]);
  }
  const plan = prepared.plan;
  const preparedDiagnostics = [
    ...prepared.ordinary.diagnostics.filter((entry) => entry.code !== 'nothing-to-update'),
    ...prepared.directDiagnostics,
  ];

  if (!context.confirmed) {
    const report: UpdateReport = {
      ...prepared.report,
      execution: {
        planId: null,
        transactionId: null,
        fromStoredPlan: false,
        outcome: 'confirmation-required',
        results: [],
        unrestored: [],
        receiptId: null,
      },
    };
    return result(EXIT_CODES['confirmation-required'], report, [
      ...preparedDiagnostics,
      adoptionConfirmationDiagnostic(plan),
      confirmationDiagnostic(report),
    ]);
  }

  if (context.stateRoot === null || context.adapters === null) {
    return result(EXIT_CODES['unsupported-environment'], null, [
      ...preparedDiagnostics,
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No transactional state directory is available, so RTK was not updated',
      }),
    ]);
  }

  const fs = context.adapters.fs;
  const journalStore = new FileJournalStore({
    fs,
    journalRoot: fs.join(context.stateRoot, 'journals'),
    backupRoot: fs.join(context.stateRoot, 'backups'),
  });
  const unfinished = (await journalStore.list()).find(
    (journal) =>
      journal.outcome === 'in-progress' &&
      journal.entries.some(
        (entry) =>
          entry.kind === 'download-artifact' &&
          entry.snapshots.some((snapshot) => snapshot.path === plan.targetPath),
      ),
  );
  if (unfinished !== undefined) {
    return result(EXIT_CODES['apply-failed-dirty'], null, [
      ...preparedDiagnostics,
      diagnostic({
        severity: 'error',
        code: 'rtk-release-unfinished-transaction',
        subject: 'rtk',
        path: plan.targetPath,
        message: `RTK was not touched because transaction ${unfinished.transactionId} is still recorded in-progress for the same executable`,
        remediation: `Inspect transaction ${unfinished.transactionId} and its backups before retrying; Token Harness will not overwrite uncertain recovery state`,
      }),
    ]);
  }

  const startedAt = context.now();
  const transactionId = directTransactionId(plan, startedAt);
  const snapshotCreation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId,
    projectRoot: await repositoryRootForBackupSafety(context),
    now: context.now,
  });
  if (!snapshotCreation.ok) {
    return result(EXIT_CODES['unsupported-environment'], null, [
      ...preparedDiagnostics,
      ...snapshotCreation.diagnostics,
    ]);
  }

  const provenance = provenanceDiagnostic(plan);
  let snapshot;
  try {
    snapshot = await snapshotCreation.store.capture(plan.targetPath);
  } catch (error) {
    return result(EXIT_CODES['internal-error'], null, [
      ...preparedDiagnostics,
      diagnostic({
        severity: 'error',
        code: 'rtk-release-snapshot-failed',
        subject: 'rtk',
        path: plan.targetPath,
        message: `RTK was not touched because its pre-update snapshot could not be captured: ${error instanceof Error ? error.message : String(error)}`,
        remediation: 'Check the state directory and executable permissions, then retry',
      }),
    ]);
  }

  const directJournal: TransactionJournal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    transactionId,
    planId: null,
    projectId: context.adapters.projectIdFor(context.projectRoot),
    projectRoot: context.projectRoot,
    startedAt,
    finishedAt: null,
    outcome: 'in-progress',
    entries: [
      {
        actionId: plan.id,
        kind: 'download-artifact',
        // Until the verified replacement completes, this entry is deliberately not credited as
        // applied. The snapshot is still persisted here so an interrupted run leaves exact recovery
        // evidence rather than an orphan backup directory.
        status: 'failed',
        snapshots: [snapshot],
        ownership: [],
        diagnostics: [provenance],
        packageInventory: null,
      },
    ],
    ownership: [],
    pinned: false,
    diagnostics: [provenance],
  };

  try {
    await journalStore.write(directJournal);
  } catch (error) {
    return result(EXIT_CODES['internal-error'], null, [
      ...preparedDiagnostics,
      diagnostic({
        severity: 'error',
        code: 'rtk-release-journal-failed',
        subject: 'rtk',
        path: plan.targetPath,
        message: `RTK was not touched because its in-progress transaction journal could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
        remediation: 'Check the Token Harness state directory, then retry',
      }),
    ]);
  }

  const finishDirectJournal = async (
    outcome: TransactionOutcomeKind,
    status: 'applied' | 'failed',
    extraDiagnostics: readonly Diagnostic[] = [],
  ): Promise<void> => {
    directJournal.outcome = outcome;
    directJournal.finishedAt = context.now();
    directJournal.entries[0]!.status = status;
    directJournal.entries[0]!.diagnostics.push(...extraDiagnostics);
    directJournal.diagnostics.push(...extraDiagnostics);
    if (outcome === 'dirty') directJournal.pinned = true;
    await journalStore.write(directJournal);
  };

  const markDirectAppliedInProgress = async (): Promise<void> => {
    directJournal.entries[0]!.status = 'applied';
    // Keep `outcome: in-progress` until any package updates have either committed or
    // failed and the coordinated RTK rollback has finished.
    await journalStore.write(directJournal);
  };

  const installed = await plan.runtime.install({
    asset: plan.asset,
    targetPath: plan.targetPath,
    previousVersion: plan.installed,
    // Keep the runtime's immediate-recovery copy inside this transaction's retained backup tree.
    // Journal eviction therefore removes both copies together rather than leaking one indefinitely.
    stateRoot: fs.join(context.stateRoot, 'backups', transactionId),
    cwd: context.projectRoot,
  });
  const network = [...new Set([...prepared.report.network, RTK_RELEASE_ASSET_DESTINATION])].sort();
  const report: UpdateReport = { ...prepared.report, network };

  if (installed.status !== 'installed') {
    const exitCode: ExitCode =
      installed.status === 'dirty'
        ? EXIT_CODES['apply-failed-dirty']
        : installed.status === 'rolled-back'
          ? EXIT_CODES['apply-failed-rolled-back']
          : EXIT_CODES['internal-error'];
    const outcome: ApplyReport['outcome'] =
      installed.status === 'dirty'
        ? 'dirty'
        : installed.status === 'rolled-back'
          ? 'rolled-back'
          : 'rejected';
    const failureDiagnostic = diagnostic({
      severity: 'error',
      code: installed.code,
      subject: 'rtk',
      path: plan.targetPath,
      message: installed.message,
      remediation:
        installed.status === 'dirty'
          ? `Recovery backup: ${installed.backupPath ?? 'unavailable'}. Do not retry until the executable path is inspected.`
          : 'Correct the reported release or executable policy problem, then retry the update',
    });
    try {
      await finishDirectJournal(installed.status === 'dirty' ? 'dirty' : 'rolled-back', 'failed', [
        failureDiagnostic,
      ]);
    } catch (error) {
      return result(EXIT_CODES['apply-failed-dirty'], null, [
        ...preparedDiagnostics,
        failureDiagnostic,
        diagnostic({
          severity: 'error',
          code: 'rtk-release-failure-journal-write-failed',
          subject: 'rtk',
          path: plan.targetPath,
          message: `RTK update failed and its final journal state could not be persisted: ${error instanceof Error ? error.message : String(error)}`,
          remediation: `Inspect transaction ${transactionId} and its backups before retrying`,
        }),
      ]);
    }
    report.execution = execution({
      transactionId,
      outcome,
      directPlan: plan,
      directStatus: installed.status,
      unrestored: installed.status === 'dirty' ? [plan.targetPath] : [],
    });
    return result(exitCode, exitCode === EXIT_CODES['internal-error'] ? null : report, [
      ...preparedDiagnostics,
      failureDiagnostic,
    ]);
  }

  try {
    await markDirectAppliedInProgress();
  } catch (error) {
    const rollback = await plan.runtime.rollback(installed.handle, context.projectRoot);
    const dirty = rollback.status === 'dirty';
    const persistenceDiagnostic = diagnostic({
      severity: 'error',
      code: 'rtk-release-applied-journal-write-failed',
      subject: 'rtk',
      path: plan.targetPath,
      message: `RTK ${plan.target} was installed but Token Harness could not persist the applied journal state: ${error instanceof Error ? error.message : String(error)}. ${rollback.message}`,
      remediation: `Inspect transaction ${transactionId} and its backups before retrying`,
    });
    try {
      await finishDirectJournal(dirty ? 'dirty' : 'rolled-back', 'failed', [persistenceDiagnostic]);
    } catch {
      // The original in-progress journal is intentionally left in place. That is safer than
      // pretending a final state was recorded when the state directory itself is failing.
    }
    return result(
      dirty ? EXIT_CODES['apply-failed-dirty'] : EXIT_CODES['apply-failed-rolled-back'],
      null,
      [...preparedDiagnostics, persistenceDiagnostic],
    );
  }

  const directResult = execution({
    transactionId,
    outcome: 'committed',
    directPlan: plan,
    directStatus: 'applied',
  });
  const base = await runPackageChannelUpdate(context);
  const combinedDiagnostics = [
    ...preparedDiagnostics,
    ...base.diagnostics.filter((entry) => entry.code !== 'nothing-to-update'),
  ];

  if (base.exitCode !== EXIT_CODES.ok) {
    const rollback = await plan.runtime.rollback(installed.handle, context.projectRoot);
    if (rollback.status === 'dirty') {
      const rollbackDiagnostic = diagnostic({
        severity: 'error',
        code: 'rtk-release-coordinated-rollback-failed',
        subject: 'rtk',
        path: plan.targetPath,
        message: `A later provider update failed and RTK could not be restored: ${rollback.message}`,
        remediation: `Restore the retained RTK backup manually from ${installed.backupPath}`,
      });
      await finishDirectJournal('dirty', 'failed', [rollbackDiagnostic]).catch(() => undefined);
      report.execution = execution({
        transactionId,
        outcome: 'dirty',
        directPlan: plan,
        directStatus: 'rollback-failed',
        base: base.data?.execution ?? null,
        unrestored: [plan.targetPath, ...(base.data?.execution?.unrestored ?? [])],
      });
      return result(EXIT_CODES['apply-failed-dirty'], report, [
        ...combinedDiagnostics,
        rollbackDiagnostic,
      ]);
    }

    const rollbackDiagnostic = diagnostic({
      severity: 'info',
      code: 'rtk-release-coordinated-rollback',
      subject: 'rtk',
      path: plan.targetPath,
      message: rollback.message,
      remediation: null,
    });
    await finishDirectJournal('rolled-back', 'failed', [rollbackDiagnostic]).catch(() => undefined);
    report.execution = execution({
      transactionId,
      outcome: base.data?.execution?.outcome === 'dirty' ? 'dirty' : 'rolled-back',
      directPlan: plan,
      directStatus: 'rolled-back',
      base: base.data?.execution ?? null,
      unrestored: base.data?.execution?.unrestored ?? [],
    });
    const finalExit =
      base.exitCode === EXIT_CODES['apply-failed-dirty']
        ? EXIT_CODES['apply-failed-dirty']
        : EXIT_CODES['apply-failed-rolled-back'];
    return result(finalExit, report, [...combinedDiagnostics, rollbackDiagnostic]);
  }

  if (base.data?.application !== undefined) report.application = base.data.application;

  const committedDiagnostic = diagnostic({
    severity: 'info',
    code: 'rtk-release-transaction-committed',
    subject: 'rtk',
    path: plan.targetPath,
    message: `RTK ${plan.target} was verified and transaction ${transactionId} now records the exact previous executable snapshot plus GitHub release provenance`,
    remediation: `Use token-harness rollback --transaction ${transactionId} to review reversal of this committed update`,
  });
  try {
    await finishDirectJournal('committed', 'applied', [committedDiagnostic]);
  } catch (error) {
    const rollback = await plan.runtime.rollback(installed.handle, context.projectRoot);
    const dirty = rollback.status === 'dirty';
    const persistenceDiagnostic = diagnostic({
      severity: 'error',
      code: 'rtk-release-commit-journal-write-failed',
      subject: 'rtk',
      path: plan.targetPath,
      message: `RTK ${plan.target} was installed but the committed journal could not be persisted: ${error instanceof Error ? error.message : String(error)}. ${rollback.message}`,
      remediation: `Inspect transaction ${transactionId} and its backups before retrying`,
    });
    await finishDirectJournal(dirty ? 'dirty' : 'rolled-back', 'failed', [
      persistenceDiagnostic,
    ]).catch(() => undefined);
    return result(
      dirty ? EXIT_CODES['apply-failed-dirty'] : EXIT_CODES['apply-failed-rolled-back'],
      null,
      [...combinedDiagnostics, persistenceDiagnostic],
    );
  }

  report.execution = execution({
    transactionId,
    outcome: 'committed',
    directPlan: plan,
    directStatus: directResult.results[0]?.status ?? 'applied',
    base: base.data?.execution ?? null,
  });
  return result(EXIT_CODES.ok, report, [...combinedDiagnostics, provenance, committedDiagnostic]);
}

/** Dashboard/read-only update observation, with the same RTK release preference but no mutation. */
export async function runUpdateCheck(
  context: CommandContext,
): Promise<CommandResult<UpdateReport>> {
  const prepared = await prepareDirectRtkUpdate({ ...context, confirmed: false });
  if (prepared === null) return runPackageChannelUpdateCheck(context);
  if (prepared.plan === null) {
    return result(prepared.ordinary.exitCode, prepared.report, [
      ...prepared.ordinary.diagnostics,
      ...prepared.directDiagnostics,
    ]);
  }
  return result(
    EXIT_CODES.ok,
    {
      ...prepared.report,
      execution: {
        planId: null,
        transactionId: null,
        fromStoredPlan: false,
        outcome: 'confirmation-required',
        results: [],
        unrestored: [],
        receiptId: null,
      },
    },
    [
      ...prepared.ordinary.diagnostics.filter((entry) => entry.code !== 'nothing-to-update'),
      ...prepared.directDiagnostics,
      diagnostic({
        severity: 'info',
        code: 'rtk-release-target',
        subject: 'rtk',
        path: prepared.plan.targetPath,
        message: `The verified GitHub fallback would target the single resolved RTK executable at ${prepared.plan.targetPath}`,
        remediation: null,
      }),
    ],
  );
}
