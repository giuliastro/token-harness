/**
 * `token-harness rollback` and `token-harness uninstall` — PLAN §2 criterion 7:
 * "uninstall or roll back without damaging unrelated configuration".
 *
 * Two commands in one file because they are two answers to the same question, and the difference
 * between them is the point:
 *
 * - **rollback** puts the files back as they were, from the snapshots a transaction recorded. It
 *   is time travel for the whole file. Anything the user changed in that file since the apply goes
 *   back too, because their edit is inside the snapshot.
 * - **uninstall** removes what Token Harness recorded as its own and leaves the rest alone. It is
 *   surgical, it plans `remove-owned-change`, and RFC 0004 §Ownership lets it refuse when the
 *   entry no longer matches what was written — "user edits block automatic deletion".
 *
 * A user who wants the last five minutes undone wants the first. A user who wants Token Harness
 * out of a file they have been editing for a week wants the second. Collapsing them into one
 * command would have to guess which.
 */

import { listProviderAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  FileJournalStore,
  TransactionSnapshotStore,
  commandResult,
  committedOwnership,
  diagnostic,
  executeTransaction,
  providerRemovalOrder,
  rollbackTransaction,
  statusForExitCode,
  type ApplyReport,
  type CommandResult,
  type Diagnostic,
  type ExitCode,
  type OwnedArtifact,
  type PlannedAction,
  type ProviderId,
  type ResolvedCapability,
  type TransactionJournal,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { computePlan } from './plan.js';

/**
 * A stable identity for an owned artifact.
 *
 * Compared as a string rather than structurally, so a journal written by an earlier build with
 * extra fields still matches on the parts that decide identity: which file, which place inside it,
 * and the digest of what was written there.
 */
function ownershipKey(artifact: OwnedArtifact): string {
  if (artifact.kind === 'owned-json-entry') {
    return `json ${artifact.path} ${artifact.pointer} ${artifact.placement} ${artifact.valueDigest}`;
  }
  if (artifact.kind === 'owned-marker-block') {
    return `marker ${artifact.path} ${artifact.markerBegin} ${artifact.bodyDigest}`;
  }
  return `file ${artifact.path} ${artifact.digest}`;
}

/**
 * The newest applied topology for each harness.
 *
 * Journals are newest-first. One later harness-scoped apply must replace the older topology for
 * that harness without erasing the still-relevant topology of another harness from an earlier
 * all-harness apply. Historical uninstall/update journals carry no `appliedPipeline` and are
 * intentionally skipped.
 */
function latestAppliedOwnership(journals: readonly TransactionJournal[]): ResolvedCapability[] {
  const seenHarnesses = new Set<string>();
  const ownership: ResolvedCapability[] = [];

  for (const journal of journals) {
    if (journal.outcome !== 'committed' || journal.appliedPipeline === undefined) continue;
    const harnesses = [
      ...new Set(journal.appliedPipeline.owners.map((owner) => owner.scope.harness)),
    ];
    for (const harness of harnesses) {
      if (seenHarnesses.has(harness)) continue;
      ownership.push(
        ...journal.appliedPipeline.owners.filter((owner) => owner.scope.harness === harness),
      );
      seenHarnesses.add(harness);
    }
  }

  return ownership;
}

function empty(outcome: ApplyReport['outcome']): ApplyReport {
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

function finish(
  exitCode: ExitCode,
  command: string,
  data: ApplyReport,
  diagnostics: Diagnostic[],
): CommandResult<ApplyReport> {
  // Same rule as `apply`: RFC 0006 nulls `data` on an error status, so the human rendering must
  // not carry a report the JSON does not have.
  const visible = statusForExitCode(exitCode) !== 'error';
  return commandResult<ApplyReport>({
    command,
    exitCode,
    data: visible ? data : null,
    diagnostics,
  });
}

function stores(context: CommandContext, transactionId: string) {
  if (context.adapters === null || context.stateRoot === null) return null;
  const fs = context.adapters.fs;
  const creation = TransactionSnapshotStore.create({
    fs,
    backupRoot: fs.join(context.stateRoot, 'backups'),
    transactionId,
    projectRoot: context.projectRoot,
    now: context.now,
  });
  if (!creation.ok) return { fs, failure: creation.diagnostics };
  return {
    fs,
    store: creation.store,
    journal: new FileJournalStore({
      fs,
      journalRoot: fs.join(context.stateRoot, 'journals'),
      backupRoot: fs.join(context.stateRoot, 'backups'),
    }),
  };
}

/**
 * `rollback` — reverse a committed transaction.
 *
 * With no `--plan`, the most recent committed transaction. Chosen rather than asked for, because a
 * user who has just seen an apply go wrong should not have to find an identifier first; and
 * *committed* rather than latest, because a transaction that already rolled itself back is not
 * something to reverse again.
 */
export async function runRollback(context: CommandContext): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];

  if (context.adapters === null || context.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No state directory is available, so no transaction can be reversed',
        remediation: null,
      }),
    );
    return finish(
      EXIT_CODES['unsupported-environment'],
      'rollback',
      empty('rejected'),
      diagnostics,
    );
  }

  const fs = context.adapters.fs;
  const journals = new FileJournalStore({
    fs,
    journalRoot: fs.join(context.stateRoot, 'journals'),
    backupRoot: fs.join(context.stateRoot, 'backups'),
  });

  const all = await journals.list();
  const committed = all
    .filter((journal) => journal.outcome === 'committed')
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  const target = committed[0];
  if (target === undefined) {
    // Not a failure. A machine where nothing has been applied has nothing to reverse, and RFC
    // 0006 keeps "an empty environment is a state, not a problem".
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'nothing-to-roll-back',
        message: 'No committed transaction is recorded on this machine',
        remediation: null,
      }),
    );
    return finish(EXIT_CODES.ok, 'rollback', empty('nothing-to-do'), diagnostics);
  }

  if (!context.confirmed) {
    const paths = new Set(
      target.entries.flatMap((entry) => entry.snapshots.map((snapshot) => snapshot.path)),
    );
    /**
     * The confirmation names *what* the target transaction did, not only its id.
     *
     * Running `rollback` twice found the reason. The second run reversed the *uninstall* from the
     * first — correct, because that was then the most recent committed transaction, and its
     * reversal genuinely restores the state before it. But "Reversing transaction a8e9eb…" gave a
     * user no way to notice they were walking further back through history rather than undoing
     * their last apply, and the effect was to put a hook back that they had just removed.
     *
     * Repeated rollbacks are meant to walk backwards; what was missing was any way to see it.
     */
    const did = [...new Set(target.entries.map((entry) => entry.kind))].join(', ');
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        message: `Reversing transaction ${target.transactionId}${did === '' ? '' : ` (${did})`} would restore ${String(paths.size)} file${paths.size === 1 ? '' : 's'} to the state they were in before it ran`,
        // Said out loud, because it is the surprising half: a rollback is not a removal of our
        // entry, it is a restoration of the whole file.
        remediation:
          'Re-run with `--yes`. Any change you made to those files since then will be lost; `uninstall` removes only what Token Harness owns',
      }),
    );
    return finish(
      EXIT_CODES['confirmation-required'],
      'rollback',
      empty('confirmation-required'),
      diagnostics,
    );
  }

  const built = stores(context, target.transactionId);
  if (built === null || built.store === undefined) {
    diagnostics.push(...(built?.failure ?? []));
    return finish(
      EXIT_CODES['unsupported-environment'],
      'rollback',
      empty('rejected'),
      diagnostics,
    );
  }

  const result = await rollbackTransaction({
    transactionId: target.transactionId,
    fs,
    snapshots: built.store,
    journal: built.journal,
    now: context.now,
    // Package inventories, when the transaction captured any: restoring a package needs the same
    // process runner the install used. Absent, the rollback reports those packages as not
    // restored instead of attempting a silent reinstall.
    runner: context.adapters.runner,
    cwd: context.projectRoot,
  });
  diagnostics.push(...result.diagnostics);

  const report = empty(result.exitCode === 0 ? 'rolled-back' : 'dirty');
  report.transactionId = target.transactionId;
  report.planId = target.planId;
  report.unrestored = result.unrestored;
  // What was reversed, so the report says which point in time it went back to rather than only
  // which transaction it named.
  report.results = target.entries.map((entry) => ({
    actionId: entry.actionId,
    kind: entry.kind,
    status: 'reversed',
    path: entry.snapshots[0]?.path ?? null,
  }));

  return finish(result.exitCode as ExitCode, 'rollback', report, diagnostics);
}

/**
 * `uninstall` — remove what Token Harness owns, and nothing else.
 *
 * The plan comes from the same `plan` method as an install, with `desiredState: 'absent'` — RFC
 * 0004 requires removal to be as reviewable as installation, and a separate uninstall path would
 * be a second implementation of ownership free to disagree about what is owned.
 *
 * It runs through the same transaction, so a failed removal rolls back like anything else, and a
 * `remove-owned-change` whose target no longer matches refuses rather than deleting.
 */
export async function runUninstall(context: CommandContext): Promise<CommandResult<ApplyReport>> {
  const diagnostics: Diagnostic[] = [];
  const computed = await computePlan(context);
  /**
   * The planner's own commentary is dropped here.
   *
   * `computePlan` is shared with `apply`, so its diagnostics are written for installing:
   * `already-in-desired-state` printed during an uninstall reads as "already configured" while the
   * command is removing that very configuration. What matters to a removal is what it removed,
   * which the actions below report.
   */
  const planningProblems = computed.diagnostics.filter((entry) => entry.severity === 'error');
  diagnostics.push(...planningProblems);

  if (context.adapters === null || context.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'state-directory-unavailable',
        message: 'No state directory is available, so nothing can be removed transactionally',
        remediation: null,
      }),
    );
    return finish(
      EXIT_CODES['unsupported-environment'],
      'uninstall',
      empty('rejected'),
      diagnostics,
    );
  }

  const providerContext = {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
    harnessConfigs: computed.harnessConfigs,
    now: context.now,
    localDatabase: context.adapters.localDatabase,
    projectIdFor: context.adapters.projectIdFor,
  };

  /**
   * What Token Harness actually recorded as its own.
   *
   * Read before anything is planned, because it is the gate on the whole command. RFC 0004 scopes
   * removal to what Token Harness owns, and ownership is established by a committed transaction —
   * not by the entry happening to look like one we would have written.
   *
   * This is not a theoretical safeguard. On the machine this was developed against, RTK's hook was
   * added by hand, and its command is byte-identical to the one Token Harness would write. Without
   * this gate `uninstall --yes` planned a removal for it, the digest precondition matched, and the
   * user's own hand-written hook would have been deleted — the exact "damaging unrelated
   * configuration" that PLAN §2 criterion 7 forbids.
   */
  const fsPort = context.adapters.fs;
  const journals = new FileJournalStore({
    fs: fsPort,
    journalRoot: fsPort.join(context.stateRoot, 'journals'),
    backupRoot: fsPort.join(context.stateRoot, 'backups'),
  });
  const journalHistory = await journals.list();
  const owned = new Set(
    journalHistory
      .flatMap((journal) => committedOwnership(journal))
      .map((artifact) => ownershipKey(artifact)),
  );

  const actionsByProvider = new Map<ProviderId, PlannedAction[]>();
  for (const adapter of listProviderAdapters()) {
    if (context.provider !== null && adapter.manifest.id !== context.provider) continue;
    /**
     * Every provider is asked, not only the ones that own a scope now.
     *
     * A provider excluded by today's resolution may still have an entry from an earlier apply,
     * and asking only current owners would leave exactly that entry behind. The adapter plans a
     * removal only for what it actually finds registered, so asking widely costs nothing.
     */
    const providerPlan = await adapter.plan(providerContext, {
      ownership: computed.report.ownership.filter((entry) => entry.owner === adapter.manifest.id),
      harnesses: computed.present,
      desiredState: 'absent',
    });

    for (const action of providerPlan.actions) {
      // The gate. A removal is kept only when a committed transaction recorded that exact artifact
      // as ours; anything else is somebody's own configuration that merely resembles ours.
      if (action.kind === 'remove-owned-change' && !owned.has(ownershipKey(action.target))) {
        diagnostics.push(
          diagnostic({
            severity: 'info',
            code: 'not-owned-by-token-harness',
            message: `${adapter.manifest.displayName} is configured here, but Token Harness did not write that entry, so it will not remove it`,
            path: action.affectedPaths[0] ?? null,
            remediation: 'Remove it by hand if you no longer want it',
          }),
        );
        continue;
      }
      const accepted = actionsByProvider.get(adapter.manifest.id) ?? [];
      accepted.push(action);
      actionsByProvider.set(adapter.manifest.id, accepted);
    }
  }

  const removalOrder = providerRemovalOrder(latestAppliedOwnership(journalHistory), [
    ...actionsByProvider.keys(),
  ]);
  if (!removalOrder.ok) {
    const providers = removalOrder.providers.join(', ');
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'pipeline-removal-order-conflict',
        message:
          removalOrder.reason === 'dependency-cycle'
            ? `The applied pipeline records contradictory removal dependencies between ${providers}`
            : `The applied pipeline records an ambiguous chain position for ${providers}`,
        remediation:
          'Inspect the applied pipeline receipt and remove the conflicting providers manually; ' +
          'Token Harness will not guess a dependency order',
      }),
    );
    return finish(EXIT_CODES['blocked-by-conflict'], 'uninstall', empty('rejected'), diagnostics);
  }

  const actions = removalOrder.order.flatMap((provider) => actionsByProvider.get(provider) ?? []);

  if (actions.length === 0) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'nothing-to-remove',
        message: 'Token Harness owns nothing on this machine, so there is nothing to remove',
        remediation: null,
      }),
    );
    return finish(EXIT_CODES.ok, 'uninstall', empty('nothing-to-do'), diagnostics);
  }

  if (!context.confirmed) {
    const touched = new Set(actions.flatMap((action) => action.affectedPaths)).size;
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'confirmation-required',
        message: `This would remove ${String(actions.length)} owned change${actions.length === 1 ? '' : 's'} from ${String(touched)} file${touched === 1 ? '' : 's'}`,
        remediation: 'Re-run with `--yes` to remove them',
      }),
    );
    return finish(
      EXIT_CODES['confirmation-required'],
      'uninstall',
      empty('confirmation-required'),
      diagnostics,
    );
  }

  const fs = context.adapters.fs;
  const transactionId = `uninstall-${context
    .now()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)}`;
  const built = stores(context, transactionId);
  if (built === null || built.store === undefined) {
    diagnostics.push(...(built?.failure ?? []));
    return finish(
      EXIT_CODES['unsupported-environment'],
      'uninstall',
      empty('rejected'),
      diagnostics,
    );
  }

  const transaction = await executeTransaction({
    transactionId,
    planId: null,
    projectId: computed.report.projectId,
    projectRoot: context.projectRoot,
    actions,
    fs,
    snapshots: built.store,
    journal: built.journal,
    runner: context.adapters.runner,
    now: context.now,
  });
  diagnostics.push(...transaction.diagnostics);

  const report = empty(
    transaction.journal.outcome === 'committed'
      ? 'committed'
      : transaction.journal.outcome === 'rolled-back'
        ? 'rolled-back'
        : transaction.journal.outcome === 'dirty'
          ? 'dirty'
          : 'rejected',
  );
  report.transactionId = transactionId;
  report.unrestored = transaction.unrestored;
  report.results = transaction.journal.entries.map((entry) => ({
    actionId: entry.actionId,
    kind: entry.kind,
    status: entry.status,
    path: entry.snapshots[0]?.path ?? null,
  }));

  return finish(transaction.exitCode as ExitCode, 'uninstall', report, diagnostics);
}
