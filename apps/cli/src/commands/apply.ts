/**
 * `token-harness apply` — RFC 0004 §Transaction lifecycle, RFC 0006 §Plan persistence.
 *
 * The first command that changes anything on the machine. Everything below it was built and
 * tested in Phase 2.3 and called from nowhere; this is what reaches it.
 *
 * ## Two forms, and why the stored one is the point
 *
 * RFC 0006:
 *
 * | `apply` | Recompute the plan, display it, require confirmation, then execute |
 * | `apply --plan <id>` | Load the stored plan, revalidate preconditions, then execute |
 *
 * > `apply --plan <id>` is what makes review-then-execute possible: the artifact a human or a
 * > reviewer approved is the artifact that runs.
 *
 * ## Confirmation is a refusal, not a prompt
 *
 * "Mutating commands are dry-run by default … then require either an interactive confirmation
 * or `--yes`." Without `--yes` this displays the plan and exits 8. It does not read stdin: the
 * process runner deliberately has no writable stdin, `--json` mode has no channel for a
 * question, and a prompt that appears in one mode and not another is a contract that depends on
 * how the command was invoked. Exit 8 is `confirmation-required`, which is precisely the state.
 *
 * ## The exit codes are the transaction's, not this module's
 *
 * 5 for drift, 6 for a verified rollback, 7 for a rollback that did not fully restore. They
 * come from `executeTransaction`, which is the only thing that knows which happened — and 7 is
 * distinguished from 6 by reading the filesystem back, not by whether a write threw.
 */

import {
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  buildStoredPlan,
  commandResult,
  diagnostic,
  statusForExitCode,
  digestText,
  executeTransaction,
  storedPlanFileName,
  providerId,
  validateStoredPlan,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type PlanReport,
  type StoredPlan,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { computePlan } from './plan.js';

/** Where plans live inside the state root. */
export const PLANS_DIRECTORY = 'plans';

/**
 * The transaction ID.
 *
 * Derived from the plan and the instant rather than random, so two runs of the same plan at the
 * same instant are the same transaction and a journal is reproducible in a test. RFC 0006
 * requires it on stderr for exit 7, which is the one case where a user has to be able to quote
 * it back.
 */
function transactionIdFor(planId: string, at: string): string {
  const digest = digestText(`${planId} ${at}`);
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 13);
}

function emptyReport(outcome: ApplyReport['outcome']): ApplyReport {
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

async function loadStoredPlan(
  context: CommandContext,
  planId: string,
): Promise<{ stored: StoredPlan | null; diagnostic: Diagnostic | null }> {
  if (context.adapters === null || context.stateRoot === null) {
    return {
      stored: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'plan-not-found',
        message: 'No state directory is available, so no stored plan can be read',
        remediation: null,
      }),
    };
  }

  const path = context.adapters.fs.join(
    context.stateRoot,
    PLANS_DIRECTORY,
    storedPlanFileName(planId),
  );
  if ((await context.adapters.fs.stat(path)) === null) {
    return {
      stored: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'plan-not-found',
        message: `No stored plan with id ${planId}`,
        path,
        remediation: 'Run `token-harness plan` to compute one',
      }),
    };
  }

  try {
    const text = new TextDecoder().decode(await context.adapters.fs.readFile(path));
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('A stored plan must be a JSON object');
    }
    return { stored: parsed as StoredPlan, diagnostic: null };
  } catch (error) {
    return {
      stored: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'plan-unreadable',
        message: `The stored plan could not be read: ${error instanceof Error ? error.message : String(error)}`,
        path,
        remediation: 'Run `token-harness plan` to compute a new one',
      }),
    };
  }
}

export async function runApply(context: CommandContext): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];

  let stored: StoredPlan | null = null;
  let planningContext = context;
  const rejectedReport = (): ApplyReport => ({
    ...emptyReport('rejected'),
    planId: context.planId,
    fromStoredPlan: stored !== null,
  });

  if (context.planId !== null) {
    const loaded = await loadStoredPlan(context, context.planId);
    stored = loaded.stored;
    if (stored === null) {
      if (loaded.diagnostic !== null) diagnostics.push(loaded.diagnostic);
      return finish('rejected', EXIT_CODES['usage-error'], rejectedReport(), diagnostics);
    }

    // Validate the artifact and project binding BEFORE trusting its selectors. The live
    // version/ownership checks still run below; using the recorded values here checks only
    // identity, schema and project, without probing an unrelated harness first.
    try {
      const identity = validateStoredPlan({
        stored,
        projectRoot: context.projectRoot,
        projectId: context.adapters?.projectIdFor(context.projectRoot) ?? null,
        versions: stored.versions,
        ownership: stored.ownership,
      });
      for (const rejection of identity.rejections) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: rejection.reason,
            message: rejection.detail,
            remediation: 'Run `token-harness plan` and review the new plan before applying it',
          }),
        );
      }
      if (stored.planId !== context.planId) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'plan-digest-mismatch',
            message: 'The stored plan does not match the requested plan id',
            remediation: 'Run `token-harness plan` and review the new plan before applying it',
          }),
        );
      }
      if (diagnostics.length > 0) {
        return finish('rejected', EXIT_CODES['precondition-drift'], rejectedReport(), diagnostics);
      }

      // Schema 1 already records the harness filter and every selected provider's version,
      // including null for absent providers. Thus an empty provider inventory means none,
      // one key means a focused provider, and multiple keys mean the unfiltered registry.
      // Recover that scope, not just the owners: an absent provider must still be checked
      // for version drift. No schema migration or re-approval is needed for existing plans.
      const providers = Object.keys(stored.versions.providers);
      const provider =
        providers.length === 0
          ? providerId('none')
          : providers.length === 1
            ? providerId(providers[0]!)
            : null;
      if (
        (context.harness !== null && context.harness !== stored.harness) ||
        (context.provider !== null && context.provider !== provider)
      ) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'plan-selection-mismatch',
            message: 'The supplied harness/provider selector differs from the reviewed plan',
            remediation: `Use token-harness apply --plan ${stored.planId} to review that stored plan without overriding its selectors`,
          }),
        );
        return finish('rejected', EXIT_CODES['precondition-drift'], rejectedReport(), diagnostics);
      }
      planningContext = { ...context, harness: stored.harness, provider };
    } catch {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'plan-unreadable',
          message: 'The stored plan has an invalid structure',
          remediation: 'Run `token-harness plan` and review a new plan before applying it',
        }),
      );
      return finish('rejected', EXIT_CODES['usage-error'], rejectedReport(), diagnostics);
    }
  }

  // Resolve live state in the SAME scope as the reviewed plan. A bare `apply --plan ID`
  // must not expand a Claude-only plan to Codex or introduce an excluded provider.
  // Only the stored actions execute; this computation still enforces the normal gates.
  const computed = await computePlan(planningContext);
  diagnostics.push(...computed.diagnostics);

  if (computed.blocked.length > 0 && computed.report.actions.length === 0) {
    /**
     * RFC 0009: a refused managed mutation is "cannot do this safely", not "nothing to do".
     * Checked before any stored action executes: an uncovered combination must not
     * silently drop a recomputed plan (exit 0) or run an approved one whose environment no row has
     * ever admitted.
     *
     * The refusal is now conditional on there being nothing else to apply, matching `plan`. It used
     * to fire on any blocked combination, and with rows shipped that made a covered install
     * unreachable because an unrelated one is not covered: `plan` would show the actions and
     * `apply` would refuse them. Nothing is loosened — a blocked combination still produces no
     * action, so applying what remains applies exactly what the plan displayed and nothing a row
     * has not admitted.
     */
    return finish('rejected', EXIT_CODES['unsupported-environment'], rejectedReport(), diagnostics);
  }

  if (computed.report.conflicts.length > 0) {
    // RFC 0006: 4 is "planning succeeded but a hard conflict prevents apply".
    return finish('rejected', EXIT_CODES['blocked-by-conflict'], rejectedReport(), diagnostics);
  }

  let actions = computed.report.actions;
  let planId = computed.report.planId;
  let fromStoredPlan = false;

  if (stored !== null) {
    const validation = validateStoredPlan({
      stored,
      projectRoot: context.projectRoot,
      projectId: computed.report.projectId,
      versions: computed.versions,
      ownership: computed.report.ownership,
    });

    if (!validation.ok) {
      for (const rejection of validation.rejections) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: rejection.reason,
            message: rejection.detail,
            remediation: 'Run `token-harness plan` and review the new plan before applying it',
          }),
        );
      }
      // RFC 0006: 5 is "the environment no longer matches the plan or journal", and staleness
      // "is checked before any action executes".
      return finish('rejected', EXIT_CODES['precondition-drift'], rejectedReport(), diagnostics);
    }

    // The stored actions run, not the recomputed ones. This is the whole mechanism: a
    // revalidated plan executes the bytes that were approved.
    actions = stored.actions;
    planId = stored.planId;
    fromStoredPlan = true;
  }

  if (actions.length === 0) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'nothing-to-apply',
        message: 'The plan has no actions, so nothing was changed',
        remediation: null,
      }),
    );
    return finish('nothing-to-do', EXIT_CODES.ok, emptyReport('nothing-to-do'), diagnostics);
  }

  if (!context.confirmed) {
    const touched = new Set(actions.flatMap((action) => action.affectedPaths)).size;
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        // The plan id goes in the message, not only in `data`: exit 8 is an `error` status, so
        // `data` is null, and a refusal a user cannot act on is not much of a refusal.
        message: `${planId === null ? 'This plan' : `Plan ${planId}`} would run ${String(actions.length)} action${actions.length === 1 ? '' : 's'} against ${String(touched)} file${touched === 1 ? '' : 's'}`,
        remediation: 'Re-run with `--yes` to apply it',
      }),
    );
    const report = emptyReport('confirmation-required');
    report.planId = planId;
    report.fromStoredPlan = fromStoredPlan;
    return finish(
      'confirmation-required',
      EXIT_CODES['confirmation-required'],
      report,
      diagnostics,
    );
  }

  if (context.adapters === null || context.stateRoot === null) {
    // Not a silent no-op: a caller that asked to apply and got nothing must be told why.
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No transactional state directory is available, so nothing was applied',
        remediation: null,
      }),
    );
    return finish('rejected', EXIT_CODES['unsupported-environment'], rejectedReport(), diagnostics);
  }

  const fs = context.adapters.fs;
  const startedAt = context.now();
  const transactionId = transactionIdFor(planId ?? 'unsaved', startedAt);

  /**
   * The stores are built here, not injected, because both are scoped to *this* transaction:
   * backups live under its id, and the journal is written under it. A caller could not
   * construct them earlier without already knowing the id this function derives.
   */
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId,
    projectRoot: context.projectRoot,
    now: context.now,
  });
  if (!creation.ok) {
    // The refusal `TransactionSnapshotStore` exists to make: a backup root inside the project
    // would put the copies inside the thing being changed.
    diagnostics.push(...creation.diagnostics);
    return finish('rejected', EXIT_CODES['unsupported-environment'], rejectedReport(), diagnostics);
  }

  const journal = new FileJournalStore({
    fs,
    journalRoot: fs.join(context.stateRoot, 'journals'),
    backupRoot: fs.join(context.stateRoot, 'backups'),
  });

  const transaction = await executeTransaction({
    transactionId,
    planId,
    projectId: computed.report.projectId,
    projectRoot: context.projectRoot,
    actions,
    managedIntegrations: computed.managedIntegrations,
    ...(computed.report.pipelineId === null
      ? {}
      : {
          appliedPipeline: {
            pipelineId: computed.report.pipelineId,
            owners: computed.report.ownership,
          },
        }),
    fs,
    snapshots: creation.store,
    journal,
    // RFC 0004 §Process policy: an installer reaches the machine through the runner or not at all.
    runner: context.adapters.runner,
    now: context.now,
  });
  diagnostics.push(...transaction.diagnostics);

  const report: ApplyReport = {
    planId,
    transactionId,
    fromStoredPlan,
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
      // The snapshot paths are what this action actually touched, which is a stronger statement
      // than the paths the plan said it would.
      path: entry.snapshots[0]?.path ?? null,
    })),
    unrestored: transaction.unrestored,
    receiptId: null,
  };

  // RFC 0006's exit-7 requirements — the affected paths and the transaction ID on stderr, and a
  // failure receipt in the state directory — are met by `executeTransaction` itself: it emits the
  // `rollback-incomplete` diagnostic, and the journal it writes before the work and after each
  // action *is* the receipt. Repeating either here would print the same failure twice.

  return finish(report.outcome, transaction.exitCode as ExitCode, report, diagnostics);
}

/**
 * Builds the result, and drops the report when the envelope would drop it anyway.
 *
 * RFC 0006 says two things that meet here: rule 3, "a field visible in human output but absent
 * from `data` is a defect", and, of the envelope, "`data` … null when status is `error`". Exit
 * codes 6 through 9 are `error`, so their `data` is null in JSON — while the human renderer reads
 * `result.data`, which was *not* null, and printed a header the JSON did not have.
 *
 * Nulling it here rather than leaving the envelope to do it keeps the two renderings identical by
 * construction. Everything a user needs on those paths is in the diagnostics, which is where
 * RFC 0006 puts it: exit 7 "always names the exact affected paths and the transaction ID on
 * stderr".
 */
function finish(
  _outcome: ApplyReport['outcome'],
  exitCode: ExitCode,
  data: ApplyReport,
  diagnostics: Diagnostic[],
): CommandResult<ApplyReport> {
  const visible = statusForExitCode(exitCode) !== 'error';
  return commandResult<ApplyReport>({
    command: 'apply',
    exitCode,
    data: visible ? data : null,
    diagnostics,
  });
}

/** Re-exported so `plan` and `apply` agree on where a plan is written. */
export { buildStoredPlan, type PlanReport };
