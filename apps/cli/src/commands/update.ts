/**
 * `token-harness update` coordinator.
 *
 * Ordinary provider updates stay in `update-base.ts` and retain the existing package-manager
 * transaction. Native Windows gets one additional RTK-only route: when WinGet is behind the newest
 * provider release Token Harness has already source-reviewed, the exact official GitHub release can
 * replace the currently resolved `rtk.exe` after SHA-256 verification. That replacement has its own
 * byte-for-byte rollback and never authorizes a harness configuration write.
 */

import {
  EXIT_CODES,
  commandResult,
  diagnostic,
  digestText,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type UpdateReport,
} from '@token-harness/core';
import { RTK_RELEASE_ASSET_DESTINATION } from '@token-harness/platform';

import type { CommandContext } from './context.js';
import { runPackageChannelUpdate, runPackageChannelUpdateCheck } from './update-base.js';
import {
  planDirectRtkWindowsRelease,
  type DirectRtkWindowsReleasePlan,
} from './rtk-release-update.js';

interface PreparedDirectUpdate {
  ordinary: CommandResult<UpdateReport>;
  report: UpdateReport;
  plan: DirectRtkWindowsReleasePlan;
  diagnostics: Diagnostic[];
}

function directTransactionId(plan: DirectRtkWindowsReleasePlan, at: string): string {
  const digest = digestText(`rtk github-release ${plan.id} ${at}`);
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 13);
}

function execution(input: {
  transactionId: string | null;
  outcome: ApplyReport['outcome'];
  directPlan: DirectRtkWindowsReleasePlan;
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
    receiptId: input.base?.receiptId ?? null,
  };
}

function withDirectRow(
  report: UpdateReport,
  plan: DirectRtkWindowsReleasePlan,
  destinations: readonly string[],
): UpdateReport {
  return {
    providers: report.providers.map((row) =>
      row.providerId === plan.providerId
        ? {
            ...row,
            available: plan.target,
            channel: 'github-release',
            verdict: 'upgradable' as const,
          }
        : row,
    ),
    network: [...new Set([...report.network, ...destinations])].sort(),
    execution: report.execution,
  };
}

async function prepareDirectRtkUpdate(
  context: CommandContext,
): Promise<PreparedDirectUpdate | null> {
  if (context.adapters === null) return null;
  if (context.platform.os !== 'windows' || context.platform.isWsl) return null;
  if (context.provider !== null && context.provider !== 'rtk') return null;

  const ordinary = await runPackageChannelUpdateCheck(context);
  if (ordinary.data === null) return null;
  const row = ordinary.data.providers.find((entry) => entry.providerId === 'rtk');
  if (row === undefined || row.installed === null || row.pin !== null) return null;

  const resolved = context.adapters.resolveExecutables?.('rtk') ?? [];
  const executablePath = resolved[0]?.path ?? null;
  const direct = await planDirectRtkWindowsRelease({
    providerId: row.providerId,
    installedVersion: row.installed,
    executablePath,
    channelAvailableVersion: row.available,
    platform: context.platform,
    fs: context.adapters.fs,
    runner: context.adapters.runner,
  });
  if (direct.plan === null) return null;

  return {
    ordinary,
    report: withDirectRow(ordinary.data, direct.plan, direct.destinations),
    plan: direct.plan,
    diagnostics: [
      ...ordinary.diagnostics.filter((entry) => entry.code !== 'nothing-to-update'),
      ...direct.diagnostics,
    ],
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

function result(
  exitCode: ExitCode,
  data: UpdateReport | null,
  diagnostics: readonly Diagnostic[],
): CommandResult<UpdateReport> {
  return commandResult({ command: 'update', exitCode, data, diagnostics: [...diagnostics] });
}

/** Public mutating update path. */
export async function runUpdate(context: CommandContext): Promise<CommandResult<UpdateReport>> {
  const prepared = await prepareDirectRtkUpdate(context);
  if (prepared === null) return runPackageChannelUpdate(context);

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
    return result(EXIT_CODES['confirmation-required'], null, [
      ...prepared.diagnostics,
      confirmationDiagnostic(report),
    ]);
  }

  if (context.stateRoot === null) {
    return result(EXIT_CODES['unsupported-environment'], null, [
      ...prepared.diagnostics,
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No transactional state directory is available, so RTK was not updated',
      }),
    ]);
  }

  const transactionId = directTransactionId(prepared.plan, context.now());
  const installed = await prepared.plan.runtime.install({
    asset: prepared.plan.asset,
    targetPath: prepared.plan.targetPath,
    previousVersion: prepared.plan.installed,
    stateRoot: context.stateRoot,
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
    report.execution = execution({
      transactionId,
      outcome,
      directPlan: prepared.plan,
      directStatus: installed.status,
      unrestored: installed.status === 'dirty' ? [prepared.plan.targetPath] : [],
    });
    return result(exitCode, exitCode === EXIT_CODES['internal-error'] ? null : report, [
      ...prepared.diagnostics,
      diagnostic({
        severity: 'error',
        code: installed.code,
        subject: 'rtk',
        path: prepared.plan.targetPath,
        message: installed.message,
        remediation:
          installed.status === 'dirty'
            ? `Recovery backup: ${installed.backupPath ?? 'unavailable'}. Do not retry until the executable path is inspected.`
            : 'Correct the reported release or Windows application-control problem, then retry the update',
      }),
    ]);
  }

  const directResult = execution({
    transactionId,
    outcome: 'committed',
    directPlan: prepared.plan,
    directStatus: 'applied',
  });
  const base = await runPackageChannelUpdate(context);
  const combinedDiagnostics = [
    ...prepared.diagnostics,
    ...base.diagnostics.filter((entry) => entry.code !== 'nothing-to-update'),
  ];

  if (base.exitCode !== EXIT_CODES.ok) {
    const rollback = await prepared.plan.runtime.rollback(installed.handle, context.projectRoot);
    if (rollback.status === 'dirty') {
      report.execution = execution({
        transactionId,
        outcome: 'dirty',
        directPlan: prepared.plan,
        directStatus: 'rollback-failed',
        base: base.data?.execution ?? null,
        unrestored: [prepared.plan.targetPath, ...(base.data?.execution?.unrestored ?? [])],
      });
      return result(EXIT_CODES['apply-failed-dirty'], report, [
        ...combinedDiagnostics,
        diagnostic({
          severity: 'error',
          code: 'rtk-release-coordinated-rollback-failed',
          subject: 'rtk',
          path: prepared.plan.targetPath,
          message: `A later provider update failed and RTK could not be restored: ${rollback.message}`,
          remediation: `Restore the retained RTK backup manually from ${installed.backupPath}`,
        }),
      ]);
    }

    report.execution = execution({
      transactionId,
      outcome: base.data?.execution?.outcome === 'dirty' ? 'dirty' : 'rolled-back',
      directPlan: prepared.plan,
      directStatus: 'rolled-back',
      base: base.data?.execution ?? null,
      unrestored: base.data?.execution?.unrestored ?? [],
    });
    const finalExit =
      base.exitCode === EXIT_CODES['apply-failed-dirty']
        ? EXIT_CODES['apply-failed-dirty']
        : EXIT_CODES['apply-failed-rolled-back'];
    return result(finalExit, report, [
      ...combinedDiagnostics,
      diagnostic({
        severity: 'info',
        code: 'rtk-release-coordinated-rollback',
        subject: 'rtk',
        message: rollback.message,
      }),
    ]);
  }

  report.execution = execution({
    transactionId,
    outcome: 'committed',
    directPlan: prepared.plan,
    directStatus: directResult.results[0]?.status ?? 'applied',
    base: base.data?.execution ?? null,
  });
  return result(EXIT_CODES.ok, report, [
    ...combinedDiagnostics,
    diagnostic({
      severity: 'info',
      code: 'rtk-release-backup-retained',
      subject: 'rtk',
      path: installed.backupPath,
      message: `RTK ${prepared.plan.target} was verified after replacement; exact previous bytes remain at ${installed.backupPath}`,
      remediation: null,
    }),
  ]);
}

/** Dashboard/read-only update observation, with the same RTK release preference but no mutation. */
export async function runUpdateCheck(
  context: CommandContext,
): Promise<CommandResult<UpdateReport>> {
  const prepared = await prepareDirectRtkUpdate({ ...context, confirmed: false });
  if (prepared === null) return runPackageChannelUpdateCheck(context);
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
    prepared.diagnostics,
  );
}
