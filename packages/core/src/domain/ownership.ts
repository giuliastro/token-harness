/**
 * Ownership and snapshots — RFC 0004 §Ownership and §Backup policy.
 *
 * ## What ownership is for
 *
 * "Token Harness can remove only: files it created and whose digest or ownership
 * marker still matches; marker-fenced blocks it owns; exact JSON/TOML/YAML entries
 * recorded in its journal; packages it installed when no external ownership is
 * detected."
 *
 * So ownership is not a label Token Harness applies to things it likes. It is a
 * claim that has to survive being checked against the live file, and the check has
 * to be able to come back *no*. "User edits inside an owned file change its digest
 * and block automatic deletion until the user reviews the new uninstall plan."
 *
 * Two of the four mechanisms are implemented here — owned files and owned marker
 * blocks. Structured-entry ownership (`ownedPointers` on the merge actions) needs a
 * parser and lands with PLAN §15 issue 7. Package ownership is a provider concern.
 *
 * These are records, not behaviour: they serialize into the transaction journal and
 * the verification receipt, and nothing here touches a filesystem.
 */

import { digestsMatch } from './digest.js';

export interface OwnedFileRecord {
  kind: 'owned-file';
  /** Absolute path. */
  path: string;
  /** Digest of the content Token Harness wrote. */
  digest: string;
  /** Four-digit octal POSIX mode, or null where the platform has none that means anything. */
  mode: string | null;
}

export interface OwnedMarkerBlockRecord {
  kind: 'owned-marker-block';
  /** Absolute path of the file the block lives in. Token Harness does not own the file. */
  path: string;
  markerBegin: string;
  markerEnd: string;
  /**
   * Digest of the block body only.
   *
   * The body, not the whole file: the user owns everything outside the fence and is
   * expected to change it. A whole-file digest would report every unrelated edit as
   * drift, which trains people to ignore drift reports.
   */
  bodyDigest: string;
}

export type OwnedArtifact = OwnedFileRecord | OwnedMarkerBlockRecord;

/**
 * What a live artifact turned out to be.
 *
 * RFC 0004 §Post-apply drift asks for two of these to be distinguishable — "an
 * owned marker block that was edited or removed" — which is why `modified` and
 * `missing` are separate, and why `unowned` exists as a third: a file that is
 * present and carries no ownership evidence at all is neither ours nor gone, and
 * treating it as either would be wrong.
 */
export type OwnershipVerdict =
  /** Present, and byte-identical to what Token Harness wrote. */
  | 'owned-unchanged'
  /** Present and still identifiably ours, but edited since. */
  | 'owned-modified'
  /** The file, or the fenced block inside it, is gone. */
  | 'missing'
  /** Present, but nothing marks it as Token Harness's. */
  | 'unowned';

export interface OwnershipObservation {
  /** Null when the file does not exist. */
  fileDigest?: string | null;
  /** For a marker block: the digest of the body found between the fences, or null when no fence was found. */
  bodyDigest?: string | null;
  /** Whether the path exists at all. */
  exists: boolean;
}

export function verifyOwnership(
  record: OwnedArtifact,
  observed: OwnershipObservation,
): OwnershipVerdict {
  if (!observed.exists) return 'missing';

  if (record.kind === 'owned-file') {
    const live = observed.fileDigest ?? null;
    if (live === null) return 'missing';
    return digestsMatch(live, record.digest) ? 'owned-unchanged' : 'owned-modified';
  }

  const body = observed.bodyDigest ?? null;
  // The file survives but the fence is gone: the block was removed, not edited. The
  // file itself was never ours, so `unowned` would be the wrong answer here.
  if (body === null) return 'missing';
  return digestsMatch(body, record.bodyDigest) ? 'owned-unchanged' : 'owned-modified';
}

/**
 * RFC 0004 §Ownership: removal is permitted only while the claim still holds.
 *
 * `owned-modified` deliberately returns false. The user changed something inside an
 * artifact Token Harness wrote, and deleting it would destroy that work — so
 * uninstall stops and asks, which is what "block automatic deletion until the user
 * reviews the new uninstall plan" means.
 */
export function mayRemoveAutomatically(verdict: OwnershipVerdict): boolean {
  return verdict === 'owned-unchanged';
}

/**
 * A captured file state — RFC 0004 §Backup policy: "capture path, digest,
 * permissions, and content" and "record the *absence* of a file that does not yet
 * exist, because absence is the state rollback must restore".
 *
 * That second clause is the one that is easy to get wrong. A rollback that only
 * knows how to put content back cannot undo a file's creation, so every action that
 * might create a file captures the absence first and rollback deletes on the way
 * out.
 */
export interface FileSnapshot {
  schemaVersion: 1;
  /** Absolute path that was captured. */
  path: string;
  /** False records an absence. `digest`, `mode`, and `contentRef` are then null. */
  existed: boolean;
  /** True when the path was a directory rather than a file. */
  wasDirectory: boolean;
  digest: string | null;
  /** Four-digit octal POSIX mode, or null on a platform where it carries no access information. */
  mode: string | null;
  byteLength: number | null;
  /**
   * Name of the file holding the captured bytes, relative to the transaction's
   * backup directory. Null for an absence and for a directory.
   *
   * The bytes live beside the record rather than inside it: a base64 blob in JSON
   * would make a backup unreviewable, and RFC 0004 expects a human to be able to
   * look at what would be restored.
   */
  contentRef: string | null;
  /** ISO 8601 instant. */
  capturedAt: string;
}

export function snapshotIsAbsence(snapshot: FileSnapshot): boolean {
  return !snapshot.existed;
}
