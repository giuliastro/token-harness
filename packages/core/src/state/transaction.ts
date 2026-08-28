/**
 * The transaction engine — RFC 0004 §Transaction lifecycle.
 *
 * ```text
 * snapshot affected state -> apply actions -> verify postconditions -> commit journal
 * ```
 *
 * and, when anything fails:
 *
 * ```text
 * stop -> reverse completed actions -> restore owned configuration
 *      -> verify restoration -> retain failure receipt
 * ```
 *
 * Four clauses in that second sequence are easy to implement as three. The one that
 * gets dropped is **verify restoration**, and it is the one that decides between RFC
 * 0006 exit 6 and exit 7 — "a mutation failed and the rollback was verified" versus
 * "rollback did not fully restore state". A rollback that is assumed to have worked
 * always reports 6, which means exit 7 never fires and the only code the RFC calls
 * critical is dead. So restoration is read back from disk here, per snapshot, and a
 * mismatch names the exact paths and the transaction ID as RFC 0006 requires.
 */

import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import { digestBytes } from '../domain/digest.js';
import type { PlannedAction, PlannedActionKind } from '../domain/actions.js';
import { snapshotIsAbsence, type FileSnapshot, type OwnedArtifact } from '../domain/ownership.js';

import {
  applyAction,
  type ActionContext,
  type ActionOutcome,
  type ActionStatus,
} from './actions.js';
import type { ProcessRunner } from '../domain/process.js';
import { restorePackageInventory, type PackageInventoryCapture } from './install.js';
import type { FileSystemPort } from './filesystem.js';
import type {
  JournalStore,
  TransactionJournal,
  TransactionJournalEntry,
  TransactionOutcomeKind,
  type ManagedIntegration,
} from './journal.js';
import { JOURNAL_SCHEMA_VERSION } from './journal.js';
import type { SnapshotStore } from './snapshots.js';

/**
 * The exit codes a transaction can produce, from the RFC 0006 table. Named rather than
 * imported, because `state` sits below `envelope` in the layer order.
 */
export const TRANSACTION_EXIT_CODES = {
  ok: 0,
  preconditionDrift: 5,
  appliedFailedRolledBack: 6,
  applyFailedDirty: 7,
} as const;

export type TransactionExitCode =
  (typeof TRANSACTION_EXIT_CODES)[keyof typeof TRANSACTION_EXIT_CODES];

export interface TransactionRequest {
  transactionId: string;
  planId: string | null;
  projectId: string | null;
  projectRoot: string;
  actions: readonly PlannedAction[];
  /**
   * Product-level ownership established by these actions. Optional so older callers and tests keep
   * their exact journal shape; when present it is persisted before the first mutation.
   */
  managedIntegrations?: readonly ManagedIntegration[];
  fs: FileSystemPort;
  snapshots: SnapshotStore;
  journal: JournalStore;
  /**
   * Needed only by `package-manager-install`. Absent, that action reports why rather than
   * silently doing nothing; every other family never asks for it.
   */
  runner?: ProcessRunner | null;
  /** ISO 8601 instants, injected so a journal is deterministic in tests. */
  now(): string;
  /**
   * RFC 0004 §Transaction lifecycle: "verify postconditions" before committing.
   *
   * Injected because what a postcondition *is* belongs to the provider and harness
   * adapters (RFC 0002 §Verification), not to the engine. Returning any `error`
   * diagnostic rolls the transaction back.
   */
  verifyPostconditions?(applied: readonly ActionOutcome[]): Promise<readonly Diagnostic[]>;
}

export interface TransactionResult {
  journal: TransactionJournal;
  exitCode: TransactionExitCode;
  /** Everything worth showing the user, in the order it was produced. */
  diagnostics: Diagnostic[];
  /**
   * Paths a rollback failed to restore. Non-empty only on exit 7.
   *
   * Returned structurally as well as in the diagnostic, because RFC 0006 rule 3 makes human and
   * JSON output "two renderings of the same result object" — a path named on stderr and absent
   * from `data` is a defect, and a caller should not have to read a message to find out which
   * files were left behind.
   */
  unrestored: string[];
}

function terminal(status: ActionOutcome['status']): boolean {
  return status !== 'applied' && status !== 'already-satisfied';
}

/**
 * Reads the filesystem back and reports which snapshots did not take.
 *
 * This is the check that makes exit 7 reachable. It compares against the recorded
 * digest, not against "the write did not throw".
 */
export async function verifyRestoration(
  fs: FileSystemPort,
  snapshots: readonly FileSnapshot[],
): Promise<string[]> {
  const unrestored: string[] = [];
  for (const snapshot of snapshots) {
    const stat = await fs.stat(snapshot.path);
    if (snapshotIsAbsence(snapshot)) {
      if (stat !== null) unrestored.push(snapshot.path);
      continue;
    }
    if (stat === null) {
      unrestored.push(snapshot.path);
      continue;
    }
    if (snapshot.wasDirectory) {
      if (stat.kind !== 'directory') unrestored.push(snapshot.path);
      continue;
    }
    if (stat.kind !== 'file') {
      unrestored.push(snapshot.path);
      continue;
    }
    if (digestBytes(await fs.readFile(snapshot.path)) !== snapshot.digest) {
      unrestored.push(snapshot.path);
    }
  }
  return unrestored;
}

/**
 * Restores every package a transaction installed and captured the inventory for.
 *
 * Takes the action records because both rollback paths pass a different shape: the in-flight
 * rollback has the action outcomes, the committed one has the journal entries. The filter is the
 * ownership test, and it comes straight from RFC 0009 §Initial delivery order item 1: ownership is
 * decided from the journal — an applied `package-manager-install` with a capture — never from
 * presence. A package that was already on PATH when the transaction ran does not matter; the
 * journal says this transaction installed it.
 *
 * Returns the package's receipt diagnostics. Whether each package was restored or stayed is in the
 * diagnostic codes (`package-inventory-restored` / `package-inventory-unrestored` /
 * `package-restore-failed`), never guessed from the recorder's state afterwards.
 */
async function restorePackageInventories(
  records: readonly {
    kind: PlannedActionKind;
    status: ActionStatus;
    packageInventory: PackageInventoryCapture | null;
  }[],
  runner: ProcessRunner | null,
  cwd: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const record of records) {
    if (record.kind !== 'package-manager-install') continue;
    if (record.status !== 'applied') continue;
    if (record.packageInventory === null || record.packageInventory === undefined) continue;
    const outcome = await restorePackageInventory({
      capture: record.packageInventory,
      runner,
      cwd,
    });
    diagnostics.push(...outcome.diagnostics);
  }
  return diagnostics;
}

export async function executeTransaction(request: TransactionRequest): Promise<TransactionResult> {
  const startedAt = request.now();
  const entries: TransactionJournalEntry[] = [];
  const applied: ActionOutcome[] = [];
  const diagnostics: Diagnostic[] = [];

  const journal: TransactionJournal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    transactionId: request.transactionId,
    planId: request.planId,
    projectId: request.projectId,
    projectRoot: request.projectRoot,
    startedAt,
    finishedAt: null,
    outcome: 'in-progress',
    entries,
    ownership: [],
    ...(request.managedIntegrations !== undefined && request.managedIntegrations.length > 0
      ? { managedIntegrations: [...request.managedIntegrations] }
      : {}),
    pinned: false,
    diagnostics,
  };

  // Written before the first action, so a process that dies mid-apply leaves the
  // record a later rollback needs.
  await request.journal.write(journal);

  const context: ActionContext = {
    fs: request.fs,
    snapshots: request.snapshots,
    runner: request.runner ?? null,
    cwd: request.projectRoot,
  };

  const finish = async (
    outcome: TransactionOutcomeKind,
    exitCode: TransactionExitCode,
    unrestored: readonly string[] = [],
  ): Promise<TransactionResult> => {
    journal.outcome = outcome;
    journal.finishedAt = request.now();
    journal.ownership =
      outcome === 'committed' ? applied.flatMap((entry) => [...entry.ownership]) : [];
    await request.journal.write(journal);
    return { journal, exitCode, diagnostics, unrestored: [...unrestored] };
  };

  /** Reverses what ran, then checks that the reversal actually took. */
  const rollback = async (cause: Diagnostic[]): Promise<TransactionResult> => {
    diagnostics.push(...cause);
    // The store's own record, not the action outcomes: an action that captured a
    // snapshot and then threw while writing returns no outcome at all.
    const snapshots = request.snapshots.captured;

    let restoreError: string | null = null;
    try {
      await request.snapshots.restoreAll(snapshots);
    } catch (error) {
      restoreError = error instanceof Error ? error.message : String(error);
    }

    const unrestored = await verifyRestoration(request.fs, snapshots);

    // The package half of the rollback, after the file half verified: a `package-inventory`
    // capture from this transaction means the transaction installed that package, so restoring
    // it is this rollback's job. Its receipts say per package whether it was restored or stayed.
    // An `error` receipt here means the restore was attempted and did not take, which is the
    // same "rollback did not fully restore" condition as an unrestored file.
    const packageDiagnostics = await restorePackageInventories(
      applied,
      request.runner ?? null,
      request.projectRoot,
    );
    diagnostics.push(...packageDiagnostics);
    const packageRestoreFailed = packageDiagnostics.some((entry) => entry.severity === 'error');

    if (restoreError === null && unrestored.length === 0 && !packageRestoreFailed) {
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'transaction-rolled-back',
          message: `Nothing was left behind: ${String(snapshots.length)} snapshot${snapshots.length === 1 ? '' : 's'} were restored and verified`,
        }),
      );
      return finish('rolled-back', TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    }

    // RFC 0006: exit 7 "always names the exact affected paths and the transaction ID
    // on stderr, and it always leaves a failure receipt in the state directory". The
    // journal is that receipt.
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'rollback-incomplete',
        message: `Transaction ${request.transactionId} failed and its rollback did not fully restore ${unrestored.length > 0 ? unrestored.join(', ') : 'the affected files'}${restoreError === null ? '' : `: ${restoreError}`}`,
        path: unrestored[0] ?? null,
        remediation: `Inspect the listed paths and the backups under the transaction id ${request.transactionId} before running any other command`,
      }),
    );
    // The paths travel with the result as well as in the diagnostic above; see
    // `TransactionResult.unrestored`.
    return finish('dirty', TRANSACTION_EXIT_CODES.applyFailedDirty, unrestored);
  };

  for (const action of request.actions) {
    let result: ActionOutcome;
    try {
      result = await applyAction(action, context);
    } catch (error) {
      // An I/O failure mid-write. Without this the exception would escape and the
      // transaction would never roll back — the one moment rollback exists for.
      result = {
        actionId: action.id,
        kind: action.kind,
        status: 'failed',
        snapshots: [],
        ownership: [],
        packageInventory: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'action-failed',
            message: `The action ${action.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            path: action.affectedPaths[0] ?? null,
            remediation: 'Check the path is writable, then run the command again',
          }),
        ],
      };
    }
    const entry: TransactionJournalEntry = {
      actionId: result.actionId,
      kind: result.kind,
      status: result.status,
      snapshots: result.snapshots,
      ownership: result.ownership,
      diagnostics: result.diagnostics,
      packageInventory: result.packageInventory,
    };
    entries.push(entry);
    applied.push(result);
    // Persisted per action rather than once at the end: the snapshots recorded here are
    // what a rollback after a crash has to work from.
    await request.journal.write(journal);

    if (!terminal(result.status)) {
      /**
       * A succeeding action can still have something to say, and until this line it was said
       * only to the journal.
       *
       * The case that found it: applying an owned hook entry to a hand-formatted
       * `settings.json` reformats the whole document, and `merge-json` reports that as
       * `json-formatting-not-preserved`. The warning reached the journal and never the user —
       * so Token Harness reformatted a file and told nobody. A change the user did not ask for
       * has to be visible, which is the entire premise of RFC 0004's ownership model.
       *
       * Only the non-terminal branch: a terminal status routes its diagnostics through
       * `rollback` or the drift return below, and pushing them here as well would report the
       * same failure twice.
       */
      diagnostics.push(...result.diagnostics);
      continue;
    }

    const mutated = applied.some((outcome) => outcome.status === 'applied');
    if (result.status === 'precondition-drift' && !mutated) {
      // Nothing was touched, so the honest report is the cause rather than a mutation
      // outcome. Once anything *has* been written, the operationally important fact is
      // that the machine was changed and put back, so the code below reports that.
      diagnostics.push(...result.diagnostics);
      return finish('rolled-back', TRANSACTION_EXIT_CODES.preconditionDrift);
    }
    return rollback([...result.diagnostics]);
  }

  const postconditions = (await request.verifyPostconditions?.(applied)) ?? [];
  const failures = postconditions.filter((entry) => entry.severity === 'error');
  if (failures.length > 0) return rollback([...postconditions]);
  diagnostics.push(...postconditions);

  return finish('committed', TRANSACTION_EXIT_CODES.ok);
}

/** Everything the transaction now owns, for the receipt RFC 0002 §Verification writes. */
export function committedOwnership(journal: TransactionJournal): OwnedArtifact[] {
  return journal.outcome === 'committed' ? [...journal.ownership] : [];
}

/**
 * Reverses a committed transaction — RFC 0004 §Transaction lifecycle, PLAN §2 criterion 7:
 * "uninstall or roll back without damaging unrelated configuration".
 *
 * Distinct from the rollback inside `executeTransaction`, and deliberately so. That one reverses
 * a transaction that is still running, from snapshots it is holding in memory. This one reverses
 * one that already finished, from the journal — which is the only record that survives the
 * process, and the reason the journal is written before the work and after every action.
 *
 * ## What it will and will not undo
 *
 * Only a `committed` transaction. A `rolled-back` one is already undone, and reversing it again
 * would restore snapshots on top of files that no longer correspond to them. A `dirty` one is
 * refused outright: its state is by definition not what the journal describes, so restoring more
 * bytes over it is the one action guaranteed to make a bad situation less recoverable.
 *
 * ## Why it does not consult ownership
 *
 * A snapshot is a record of what the file *was*, so restoring it puts back exactly the user's
 * bytes — including any edit they made to a part of the file Token Harness never owned, because
 * that edit is inside the snapshot too. That is the one case worth stating plainly: rollback is
 * time travel for the whole file, not a surgical removal of our entry. `remove-owned-change` is
 * the surgical form, and it is what `uninstall` plans.
 */
export interface RollbackRequest {
  transactionId: string;
  fs: FileSystemPort;
  snapshots: SnapshotStore;
  journal: JournalStore;
  now(): string;
  /**
   * Needed only when the transaction installed packages with captured inventories. Absent, those
   * packages are reported as not restored rather than being silently skipped.
   */
  runner?: ProcessRunner | null;
  /** Working directory for a restore install; defaults to the journal's project root. */
  cwd?: string;
}

export type RollbackRefusal =
  | 'transaction-not-found'
  | 'transaction-not-committed'
  | 'transaction-dirty';

export interface RollbackResult {
  journal: TransactionJournal | null;
  exitCode: TransactionExitCode;
  refusal: RollbackRefusal | null;
  /** Paths the restoration did not put back. Non-empty only on exit 7. */
  unrestored: string[];
  diagnostics: Diagnostic[];
}

export async function rollbackTransaction(request: RollbackRequest): Promise<RollbackResult> {
  const journal = await request.journal.read(request.transactionId);

  if (journal === null) {
    return {
      journal: null,
      exitCode: TRANSACTION_EXIT_CODES.preconditionDrift,
      refusal: 'transaction-not-found',
      unrestored: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'transaction-not-found',
          message: `No journal for transaction ${request.transactionId}`,
          remediation: 'Run `token-harness status` to see which transactions are recorded',
        }),
      ],
    };
  }

  if (journal.outcome === 'dirty') {
    return {
      journal,
      exitCode: TRANSACTION_EXIT_CODES.applyFailedDirty,
      refusal: 'transaction-dirty',
      unrestored: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'transaction-dirty',
          message: `Transaction ${request.transactionId} was left dirty, so its journal no longer describes the files on disk`,
          remediation: `Inspect the backups under ${request.transactionId} by hand; automatic restoration would write bytes over a state nobody recorded`,
        }),
      ],
    };
  }

  if (journal.outcome !== 'committed') {
    return {
      journal,
      exitCode: TRANSACTION_EXIT_CODES.preconditionDrift,
      refusal: 'transaction-not-committed',
      unrestored: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'transaction-not-committed',
          message: `Transaction ${request.transactionId} ended as ${journal.outcome}, so there is nothing committed to reverse`,
          remediation: null,
        }),
      ],
    };
  }

  const snapshots = journal.entries.flatMap((entry) => entry.snapshots);
  const diagnostics: Diagnostic[] = [];

  let restoreError: string | null = null;
  try {
    await request.snapshots.restoreAll(snapshots);
  } catch (error) {
    restoreError = error instanceof Error ? error.message : String(error);
  }

  // Read back rather than trusting that the writes threw nothing. This is the same check that
  // makes exit 7 reachable during an apply, and it is what separates "restored" from "attempted".
  const unrestored = await verifyRestoration(request.fs, snapshots);

  // The package half, from the journal the transaction left behind. Journal-derived ownership:
  // an applied `package-manager-install` entry with a capture is this transaction's package,
  // whether or not the binary is still where the install put it.
  const packageDiagnostics = await restorePackageInventories(
    journal.entries,
    request.runner ?? null,
    request.cwd ?? journal.projectRoot,
  );
  diagnostics.push(...packageDiagnostics);
  const packageRestoreFailed = packageDiagnostics.some((entry) => entry.severity === 'error');

  if (restoreError === null && unrestored.length === 0 && !packageRestoreFailed) {
    journal.outcome = 'rolled-back';
    journal.ownership = [];
    journal.finishedAt = request.now();
    await request.journal.write(journal);
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'transaction-rolled-back',
        message: `Transaction ${request.transactionId} was reversed: ${String(snapshots.length)} ${snapshots.length === 1 ? 'file was' : 'files were'} restored and verified`,
      }),
    );
    return {
      journal,
      exitCode: TRANSACTION_EXIT_CODES.ok,
      refusal: null,
      unrestored: [],
      diagnostics,
    };
  }

  // Left dirty, and recorded as such: the journal is the failure receipt RFC 0006 requires exit 7
  // to leave behind, and marking it stops a second rollback from writing over the mess.
  journal.outcome = 'dirty';
  journal.finishedAt = request.now();
  journal.pinned = true;
  await request.journal.write(journal);
  diagnostics.push(
    diagnostic({
      severity: 'error',
      code: 'rollback-incomplete',
      message: `Transaction ${request.transactionId} could not be fully reversed${unrestored.length > 0 ? `: ${unrestored.join(', ')}` : ''}${restoreError === null ? '' : ` (${restoreError})`}`,
      path: unrestored[0] ?? null,
      remediation: `Inspect the listed paths and the backups under transaction ${request.transactionId} before running any other command`,
    }),
  );
  return {
    journal,
    exitCode: TRANSACTION_EXIT_CODES.applyFailedDirty,
    refusal: null,
    unrestored,
    diagnostics,
  };
}
