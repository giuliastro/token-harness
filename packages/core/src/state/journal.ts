/**
 * The transaction journal — RFC 0004 §Transaction lifecycle, RFC 0006 §Expiry.
 *
 * ## Why it is written before the work, not after
 *
 * "Rollback failure is reported as a critical diagnostic with exact affected paths.
 * Token Harness never hides a partial installation."
 *
 * A journal written only on success cannot honour that. If the process is killed
 * halfway through an apply — a lost SSH session, a laptop lid, a `taskkill` — the only
 * evidence that a partial installation exists is what was already on disk. So the
 * journal is written as `in-progress` before the first action and updated after each
 * one, and a later invocation can find it and roll it back.
 *
 * ## Retention
 *
 * RFC 0006 §Expiry: journals last 90 days or 20 transactions, backups are "tied to
 * their journal", and pinning exempts a transaction from both limits. Evicting a
 * journal therefore evicts its backup directory too — a configuration backup that
 * outlives every record of why it exists is a directory of the user's settings, and
 * possibly their credentials, that nothing will ever clean up.
 */

import type { PlannedActionKind } from '../domain/actions.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import type { FileSnapshot, OwnedArtifact } from '../domain/ownership.js';

import type { FileSystemPort } from './filesystem.js';
import type { ActionStatus } from './actions.js';

export const JOURNAL_SCHEMA_VERSION = 1;

/** RFC 0006 §Expiry: "Transaction journals | 90 days | 20 most recent | pinning exempts". */
export const JOURNAL_RETENTION_DAYS = 90;
export const JOURNAL_RETENTION_COUNT = 20;

export type TransactionOutcomeKind =
  /** Written before the first action, and left behind by a process that died mid-apply. */
  | 'in-progress'
  /** Every action succeeded and the postconditions verified. */
  | 'committed'
  /** Something failed and the reversal was verified. RFC 0006 exit 6. */
  | 'rolled-back'
  /** Something failed and the reversal did not fully restore state. RFC 0006 exit 7. */
  | 'dirty';

export interface TransactionJournalEntry {
  actionId: string;
  kind: PlannedActionKind;
  status: ActionStatus;
  /** What was captured before this action wrote, in capture order. */
  snapshots: FileSnapshot[];
  ownership: OwnedArtifact[];
  diagnostics: Diagnostic[];
}

export interface TransactionJournal {
  schemaVersion: number;
  transactionId: string;
  /** RFC 0006 §Plan persistence: the plan this transaction executed, when there was one. */
  planId: string | null;
  projectId: string | null;
  projectRoot: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: TransactionOutcomeKind;
  entries: TransactionJournalEntry[];
  /** Everything Token Harness owns as a result. Empty after a verified rollback. */
  ownership: OwnedArtifact[];
  /** RFC 0004 §Backup policy: a pinned transaction is exempt from both retention limits. */
  pinned: boolean;
  diagnostics: Diagnostic[];
}

export interface JournalStore {
  write(journal: TransactionJournal): Promise<void>;
  read(transactionId: string): Promise<TransactionJournal | null>;
  list(): Promise<TransactionJournal[]>;
  /** Applies the RFC 0006 §Expiry limits and returns the transaction IDs removed. */
  evict(now: Date): Promise<string[]>;
}

export interface FileJournalStoreInput {
  fs: FileSystemPort;
  /** `<state>/journals`. */
  journalRoot: string;
  /** `<state>/backups`, so eviction can remove a journal's backups with it. */
  backupRoot: string;
}

const JOURNAL_SUFFIX = '.json';
const UTF8 = new TextEncoder();

export class FileJournalStore implements JournalStore {
  private readonly input: FileJournalStoreInput;

  constructor(input: FileJournalStoreInput) {
    this.input = input;
  }

  private pathFor(transactionId: string): string {
    return this.input.fs.join(this.input.journalRoot, `${transactionId}${JOURNAL_SUFFIX}`);
  }

  async write(journal: TransactionJournal): Promise<void> {
    await this.input.fs.createDirectory(this.input.journalRoot);
    await this.input.fs.writeFile(
      this.pathFor(journal.transactionId),
      UTF8.encode(`${JSON.stringify(journal, null, 2)}\n`),
    );
  }

  async read(transactionId: string): Promise<TransactionJournal | null> {
    const path = this.pathFor(transactionId);
    if ((await this.input.fs.stat(path)) === null) return null;
    const text = new TextDecoder().decode(await this.input.fs.readFile(path));
    const parsed = JSON.parse(text) as TransactionJournal;
    // A journal from a future build is not partially interpreted; RFC 0006 rule 1
    // applies to every document with a schemaVersion, not only to the envelope.
    if (parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION) return null;
    return parsed;
  }

  async list(): Promise<TransactionJournal[]> {
    const names = await this.input.fs.readDirectory(this.input.journalRoot);
    const journals: TransactionJournal[] = [];
    for (const name of names) {
      if (!name.endsWith(JOURNAL_SUFFIX)) continue;
      const journal = await this.read(name.slice(0, -JOURNAL_SUFFIX.length));
      if (journal !== null) journals.push(journal);
    }
    // Newest first, so the count limit keeps the most recent.
    return journals.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async evict(now: Date): Promise<string[]> {
    const journals = await this.list();
    const cutoff = now.getTime() - JOURNAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    let kept = 0;

    for (const journal of journals) {
      if (journal.pinned) continue;
      // An unfinished journal is the record of a partial installation. Evicting it
      // would delete the only evidence that something needs rolling back.
      if (journal.outcome === 'in-progress' || journal.outcome === 'dirty') continue;

      kept += 1;
      const startedAt = Date.parse(journal.startedAt);
      const tooOld = !Number.isNaN(startedAt) && startedAt < cutoff;
      const tooMany = kept > JOURNAL_RETENTION_COUNT;
      if (!tooOld && !tooMany) continue;

      await this.input.fs.remove(this.pathFor(journal.transactionId));
      // "Configuration backups | 90 days | tied to their journal".
      await this.input.fs.remove(this.input.fs.join(this.input.backupRoot, journal.transactionId));
      removed.push(journal.transactionId);
    }
    return removed;
  }
}
