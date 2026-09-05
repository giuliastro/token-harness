/**
 * Snapshots — RFC 0004 §Backup policy.
 *
 * "Before each file mutation: capture path, digest, permissions, and content;
 * record the *absence* of a file that does not yet exist, because absence is the
 * state rollback must restore; store the backup under the transaction ID; never
 * place backups in the project repository."
 *
 * All four clauses are properties of this module. The third one is why the store is
 * constructed per transaction, and the fourth is checked rather than assumed: a
 * backup written into the repository would be committed by the next `git add -A`,
 * which is how a configuration backup containing an API key ends up on a remote.
 *
 * The bytes are stored beside the record, not inside it. RFC 0004 expects a human
 * to be able to look at what would be restored, and a base64 blob in JSON is not
 * something anyone looks at.
 */

import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import { digestBytes } from '../domain/digest.js';
import type { FileSnapshot } from '../domain/ownership.js';

import type { FileSystemPort } from './filesystem.js';

export interface SnapshotStore {
  /** Captures the current state of a path, including its absence. */
  capture(path: string): Promise<FileSnapshot>;
  /** Records an absence established by a pre-invocation tree scan. */
  captureAbsent(path: string): FileSnapshot;
  /** Puts the captured state back, byte-for-byte, including putting nothing back. */
  restore(snapshot: FileSnapshot): Promise<void>;
  /** Restores in reverse order, so a directory created last is removed first. */
  restoreAll(snapshots: readonly FileSnapshot[]): Promise<void>;
  /**
   * Every snapshot taken through this store, in capture order.
   *
   * The store is the authority on what to roll back, not the action outcomes. An
   * action that captures a snapshot and then fails while writing throws instead of
   * returning an outcome, and a rollback driven by returned outcomes would not know
   * that snapshot existed — which is precisely the case where rollback matters most.
   */
  readonly captured: readonly FileSnapshot[];
}

export interface TransactionSnapshotStoreInput {
  fs: FileSystemPort;
  /** Machine-local backup root, normally `<state>/backups`. */
  backupRoot: string;
  /** RFC 0006 §Plan persistence gives transactions an ID; backups are stored under it. */
  transactionId: string;
  /** The project being operated on, used only to refuse to write backups inside it. */
  projectRoot: string;
  /** ISO 8601 instant. Injected so a snapshot record is deterministic in tests. */
  now(): string;
}

export type SnapshotStoreCreation =
  | { readonly ok: true; readonly store: TransactionSnapshotStore }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export class TransactionSnapshotStore implements SnapshotStore {
  private readonly input: TransactionSnapshotStoreInput;
  private readonly taken: FileSnapshot[] = [];
  private counter = 0;

  private constructor(input: TransactionSnapshotStoreInput) {
    this.input = input;
  }

  get captured(): readonly FileSnapshot[] {
    return this.taken;
  }

  /**
   * The only way to build one, so the RFC 0004 location rule cannot be skipped by
   * calling a constructor directly.
   */
  static create(input: TransactionSnapshotStoreInput): SnapshotStoreCreation {
    if (input.fs.isInside(input.backupRoot, input.projectRoot)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'backup-root-inside-project',
            message:
              'The configuration backup directory is inside the project, where it would be committed with the repository',
            path: input.backupRoot,
            remediation:
              'Backups belong under the machine-local state directory; do not override it to a project path',
          }),
        ],
      };
    }
    return { ok: true, store: new TransactionSnapshotStore(input) };
  }

  /** `<backupRoot>/<transactionId>`. Created lazily, on the first capture. */
  get directory(): string {
    return this.input.fs.join(this.input.backupRoot, this.input.transactionId);
  }

  private remember(snapshot: FileSnapshot): FileSnapshot {
    this.taken.push(snapshot);
    return snapshot;
  }
  captureAbsent(path: string): FileSnapshot {
    return this.remember({
      schemaVersion: 1,
      path,
      existed: false,
      wasDirectory: false,
      digest: null,
      mode: null,
      byteLength: null,
      contentRef: null,
      capturedAt: this.input.now(),
    });
  }
  async capture(path: string): Promise<FileSnapshot> {
    const { fs } = this.input;
    const stat = await fs.stat(path);
    const capturedAt = this.input.now();

    if (stat === null) return this.captureAbsent(path);

    if (stat.kind === 'directory') {
      return this.remember({
        schemaVersion: 1,
        path,
        existed: true,
        wasDirectory: true,
        digest: null,
        mode: stat.mode,
        byteLength: null,
        contentRef: null,
        capturedAt,
      });
    }

    this.counter += 1;
    const contentRef = `${String(this.counter).padStart(4, '0')}.content`;
    const content = await fs.readFile(path);
    await fs.createDirectory(this.directory);
    await fs.writeFile(fs.join(this.directory, contentRef), content);

    const snapshot: FileSnapshot = this.remember({
      schemaVersion: 1,
      path,
      existed: true,
      wasDirectory: false,
      digest: digestBytes(content),
      mode: stat.mode,
      byteLength: content.byteLength,
      contentRef,
      capturedAt,
    });

    // The record is written next to the bytes, so a backup directory explains itself
    // without the journal. The journal (PLAN §15 issue 7) references these; it is not
    // what makes them readable.
    await fs.writeFile(
      fs.join(this.directory, `${String(this.counter).padStart(4, '0')}.json`),
      new TextEncoder().encode(`${JSON.stringify(snapshot, null, 2)}\n`),
    );

    return snapshot;
  }

  async restore(snapshot: FileSnapshot): Promise<void> {
    const { fs } = this.input;

    if (!snapshot.existed) {
      await fs.remove(snapshot.path);
      return;
    }

    if (snapshot.wasDirectory) {
      await fs.createDirectory(snapshot.path);
      return;
    }

    if (snapshot.contentRef === null) {
      throw new Error(
        `snapshot of ${snapshot.path} records a file but carries no content reference`,
      );
    }

    const content = await fs.readFile(fs.join(this.directory, snapshot.contentRef));
    const live = digestBytes(content);
    if (live !== snapshot.digest) {
      // The backup itself was tampered with or truncated. Restoring it would write
      // bytes nobody captured, which is worse than reporting that rollback failed —
      // RFC 0004 requires exit 7 to name the paths rather than paper over them.
      throw new Error(
        `the backup of ${snapshot.path} no longer matches its recorded digest; it will not be restored`,
      );
    }
    await fs.writeFile(snapshot.path, content, snapshot.mode);
  }

  async restoreAll(snapshots: readonly FileSnapshot[]): Promise<void> {
    // Reverse order: a directory captured as absent before its children were written
    // must be removed after them, and RFC 0004 §Transaction lifecycle reverses
    // completed actions rather than replaying them.
    for (const snapshot of [...snapshots].reverse()) {
      await this.restore(snapshot);
    }
  }
}
