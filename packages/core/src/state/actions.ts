/**
 * Action execution — PLAN §2.3, RFC 0004 §Transaction lifecycle.
 *
 * ## What an action does, and what it refuses to do
 *
 * Every mutating action here snapshots before it writes, so the transaction engine
 * (PLAN §15 issue 7) can reverse it by restoring rather than by inventing an inverse
 * operation. That is not a shortcut: restore-from-snapshot is what makes "a
 * simulated mid-plan failure restores the initial fixture byte-for-byte" true for an
 * action whose inverse would otherwise have to reconstruct a file it only partly
 * wrote.
 *
 * Every action also states what it expects to find, and stops when it does not find
 * it. RFC 0006 §Plan persistence rejects a plan when "a recorded precondition digest
 * no longer matches", and this is where that happens: a file the user created since
 * planning, an owned block the user edited, a marker fence somebody removed. The
 * outcome is `precondition-drift`, which the CLI reports as exit 5 — never a write.
 *
 * Seven action families are implemented: the four that touch files without a parser (PLAN §15
 * issue 6), `merge-json` (issue 7), `package-manager-install`, and the containment-bounded
 * `delegated-provider-install`. The rest report `action-not-implemented` rather than silently
 * succeeding.
 */

import { runPackageManagerInstall } from './install.js';
import { processSucceeded, type ProcessRunner } from '../domain/process.js';
import type {
  CreateDirectoryAction,
  DelegatedProviderInstallAction,
  MergeJsonAction,
  PackageManagerInstallAction,
  PatchMarkerBlockAction,
  PlannedAction,
  PlannedActionKind,
  RemoveOwnedChangeAction,
  WriteOwnedFileAction,
} from '../domain/actions.js';
import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import { digestBytes, digestText } from '../domain/digest.js';
import {
  mayRemoveAutomatically,
  verifyOwnership,
  type FileSnapshot,
  type OwnedArtifact,
  type OwnershipVerdict,
} from '../domain/ownership.js';

import type { FileSystemPort } from './filesystem.js';
import {
  formatJsonDocument,
  jsonValueDigest,
  mergeJsonEntries,
  parseJsonDocumentText,
  parseJsonPointer,
  removeJsonEntry,
  resolveJsonPointer,
} from './json-merge.js';
import { findMarkerBlock, removeMarkerBlock, upsertMarkerBlock } from './marker-block.js';
import type { SnapshotStore } from './snapshots.js';

export interface ActionContext {
  fs: FileSystemPort;
  snapshots: SnapshotStore;
  /**
   * Needed only by `package-manager-install`, so it is optional rather than required.
   *
   * The file-touching families genuinely have no business spawning anything, and a required
   * runner would hand every one of them a capability RFC 0004 §Process policy keeps scarce. An
   * install with no runner reports why instead of silently doing nothing.
   */
  runner?: ProcessRunner | null;
  /** Working directory for an installer. The project root; nothing relative is read from it. */
  cwd?: string;
}

export type ActionStatus =
  /** The action ran and changed something. */
  | 'applied'
  /** The desired state was already in place. Applying again is a no-op, not an error. */
  | 'already-satisfied'
  /** The environment no longer matches what the plan recorded. RFC 0006 exit 5. */
  | 'precondition-drift'
  /** The action is well-formed but must not run: doing so would destroy the user's work. */
  | 'refused'
  /** An I/O failure, or an action family this build does not implement. */
  | 'failed';

export interface ActionOutcome {
  actionId: string;
  kind: PlannedActionKind;
  status: ActionStatus;
  /** Captured before any write, in the order captured. Rollback restores in reverse. */
  snapshots: FileSnapshot[];
  /** What Token Harness owns as a result. Empty unless the status is `applied`. */
  ownership: OwnedArtifact[];
  diagnostics: Diagnostic[];
}

function outcome(
  action: PlannedAction,
  status: ActionStatus,
  parts: Partial<Pick<ActionOutcome, 'snapshots' | 'ownership' | 'diagnostics'>> = {},
): ActionOutcome {
  return {
    actionId: action.id,
    kind: action.kind,
    status,
    snapshots: parts.snapshots ?? [],
    ownership: parts.ownership ?? [],
    diagnostics: parts.diagnostics ?? [],
  };
}

function drift(action: PlannedAction, path: string, message: string): ActionOutcome {
  return outcome(action, 'precondition-drift', {
    diagnostics: [
      diagnostic({
        severity: 'error',
        code: 'action-precondition-drift',
        message,
        path,
        remediation: 'Run `token-harness plan` again to compute a plan against the current state',
      }),
    ],
  });
}

function refusal(
  action: PlannedAction,
  code: string,
  path: string,
  message: string,
  remediation: string,
): ActionOutcome {
  return outcome(action, 'refused', {
    diagnostics: [diagnostic({ severity: 'error', code, message, path, remediation })],
  });
}

const UTF8 = new TextEncoder();

async function readText(fs: FileSystemPort, path: string): Promise<string> {
  return new TextDecoder().decode(await fs.readFile(path));
}

/**
 * `create-directory`.
 *
 * The absence is captured even though creating a directory looks harmless, because
 * rollback has to be able to remove it again — RFC 0004 §Backup policy, "absence is
 * the state rollback must restore".
 */
async function applyCreateDirectory(
  action: CreateDirectoryAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const stat = await context.fs.stat(action.path);
  if (stat !== null) {
    if (stat.kind === 'directory') return outcome(action, 'already-satisfied');
    return refusal(
      action,
      'path-is-not-a-directory',
      action.path,
      'A file already exists where Token Harness needs a directory',
      'Move or remove the file, then run the command again',
    );
  }

  const snapshot = await context.snapshots.capture(action.path);
  await context.fs.createDirectory(action.path);
  return outcome(action, 'applied', { snapshots: [snapshot] });
}

/**
 * `write-owned-file`.
 *
 * The precondition is the whole safety story. `expectedDigest: null` means the file
 * must not exist, so a file the user put there in the meantime produces drift rather
 * than being overwritten; a digest means the file must be exactly what Token Harness
 * last wrote, so a file the user edited produces drift too.
 */
async function applyWriteOwnedFile(
  action: WriteOwnedFileAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const { fs } = context;
  const content = UTF8.encode(action.content);
  const targetDigest = digestBytes(content);
  const stat = await fs.stat(action.path);

  if (stat !== null && stat.kind !== 'file') {
    return refusal(
      action,
      'path-is-not-a-file',
      action.path,
      'A directory exists where Token Harness needs to write a file',
      'Move or remove the directory, then run the command again',
    );
  }

  const liveDigest = stat === null ? null : digestBytes(await fs.readFile(action.path));

  if (action.expectedDigest === null && liveDigest !== null) {
    if (liveDigest === targetDigest) {
      // Byte-identical to what this action would write. Almost certainly a re-run
      // whose receipt was lost, and overwriting identical bytes is not worth an error.
      return outcome(action, 'already-satisfied', {
        ownership: [
          { kind: 'owned-file', path: action.path, digest: targetDigest, mode: action.mode },
        ],
      });
    }
    return drift(
      action,
      action.path,
      'The plan expected to create this file, but a different file already exists there',
    );
  }

  if (action.expectedDigest !== null && liveDigest === null) {
    return drift(
      action,
      action.path,
      'The plan expected to update this file, but it no longer exists',
    );
  }

  if (action.expectedDigest !== null && liveDigest !== action.expectedDigest) {
    return drift(
      action,
      action.path,
      'This file has changed since the plan was computed, so Token Harness will not overwrite it',
    );
  }

  const record: OwnedArtifact = {
    kind: 'owned-file',
    path: action.path,
    digest: targetDigest,
    mode: action.mode,
  };

  if (liveDigest === targetDigest) {
    return outcome(action, 'already-satisfied', { ownership: [record] });
  }

  const snapshot = await context.snapshots.capture(action.path);
  await fs.writeFile(action.path, content, action.mode);
  return outcome(action, 'applied', { snapshots: [snapshot], ownership: [record] });
}

/**
 * `patch-marker-block`.
 *
 * Only the body between the fences is written. Everything outside is the user's, and
 * the round-trip property in `marker-block.ts` is what makes "configuration the user
 * wrote is preserved byte-for-byte" (RFC 0004 §Brownfield adoption, clause 5) a
 * property rather than an intention.
 */
async function applyPatchMarkerBlock(
  action: PatchMarkerBlockAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const { fs } = context;
  const fence = { begin: action.markerBegin, end: action.markerEnd };
  const stat = await fs.stat(action.path);

  if (stat !== null && stat.kind !== 'file') {
    return refusal(
      action,
      'path-is-not-a-file',
      action.path,
      'A directory exists where Token Harness needs to patch a file',
      'Move or remove the directory, then run the command again',
    );
  }

  if (stat === null && !action.createIfMissing) {
    return drift(
      action,
      action.path,
      'The file this plan patches no longer exists, and the plan does not permit creating it',
    );
  }

  const original = stat === null ? '' : await readText(fs, action.path);
  const lookup = findMarkerBlock(original, fence);

  if (lookup.state === 'malformed') {
    return refusal(
      action,
      'marker-block-malformed',
      action.path,
      `The Token Harness marker block in this file cannot be located safely: ${lookup.reason}`,
      'Repair the marker lines by hand, or remove them so Token Harness can write a fresh block',
    );
  }

  if (lookup.state === 'absent' && action.expectedBodyDigest !== null) {
    // RFC 0004 §Post-apply drift: "an owned marker block that was edited or removed".
    return drift(
      action,
      action.path,
      'The Token Harness marker block this plan updates has been removed from the file',
    );
  }

  if (lookup.state === 'found' && action.expectedBodyDigest === null) {
    return drift(
      action,
      action.path,
      'A Token Harness marker block already exists in this file, but the plan expected none',
    );
  }

  if (
    lookup.state === 'found' &&
    action.expectedBodyDigest !== null &&
    lookup.block.bodyDigest !== action.expectedBodyDigest
  ) {
    return drift(
      action,
      action.path,
      'The Token Harness marker block in this file has been edited since the plan was computed',
    );
  }

  const upsert = upsertMarkerBlock({
    text: original,
    fence,
    syntax: { prefix: action.commentPrefix, suffix: action.commentSuffix },
    body: action.body,
  });
  if (!upsert.ok) {
    return refusal(
      action,
      'marker-block-malformed',
      action.path,
      `The marker block could not be written: ${upsert.reason}`,
      'Repair the marker lines by hand',
    );
  }

  const record: OwnedArtifact = {
    kind: 'owned-marker-block',
    path: action.path,
    markerBegin: action.markerBegin,
    markerEnd: action.markerEnd,
    bodyDigest: upsert.bodyDigest,
  };

  if (!upsert.changed) return outcome(action, 'already-satisfied', { ownership: [record] });

  const snapshot = await context.snapshots.capture(action.path);
  await fs.writeFile(action.path, UTF8.encode(upsert.text), stat?.mode ?? null);
  return outcome(action, 'applied', { snapshots: [snapshot], ownership: [record] });
}

/**
 * `merge-json`.
 *
 * The declared `ownedPointers` are checked against the operations before anything is
 * read. RFC 0004 §Ownership scopes removal to the entries recorded in the journal, so
 * an action whose operations reach outside what it claimed is a plan a reviewer did
 * not approve — and it is rejected as such rather than trusted because it came from
 * our own planner.
 */
async function applyMergeJson(
  action: MergeJsonAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const { fs } = context;

  const declared = new Set(action.ownedPointers);
  const undeclared = action.operations
    .map((operation) => operation.pointer)
    .filter((pointer) => !declared.has(pointer));
  if (undeclared.length > 0) {
    return refusal(
      action,
      'action-claims-undeclared-pointer',
      action.path,
      `This action edits ${undeclared.join(', ')}, which it does not declare in ownedPointers`,
      'Recompute the plan; an action may only touch what it declares',
    );
  }
  for (const pointer of action.ownedPointers) {
    if (parseJsonPointer(pointer) === null) {
      return refusal(
        action,
        'json-pointer-invalid',
        action.path,
        `The pointer ${JSON.stringify(pointer)} is not a valid dotted path`,
        'Use dot-separated keys, escaping a literal dot as \\.',
      );
    }
  }

  const stat = await fs.stat(action.path);
  if (stat !== null && stat.kind !== 'file') {
    return refusal(
      action,
      'path-is-not-a-file',
      action.path,
      'A directory exists where Token Harness needs to merge a JSON document',
      'Move or remove the directory, then run the command again',
    );
  }
  if (stat === null && !action.createIfMissing) {
    return drift(
      action,
      action.path,
      'The document this plan merges into no longer exists, and the plan does not permit creating it',
    );
  }

  const original = stat === null ? '{}\n' : await readText(fs, action.path);
  const parsed = parseJsonDocumentText(original);

  if (parsed.state === 'comments') {
    // RFC 0004: "When comment-preserving mutation is not reliable, the planner reports
    // that limitation before apply." PLAN §17.1 keeps the comment-preserving strategy
    // open; destroying the user's comments while waiting for it is not an interim.
    return refusal(
      action,
      'json-comments-unsupported',
      action.path,
      'This document contains comments, and Token Harness cannot edit it without deleting them',
      'Remove the comments, or configure this integration by hand',
    );
  }
  if (parsed.state === 'malformed') {
    return refusal(
      action,
      'json-malformed',
      action.path,
      `This document is not valid JSON: ${parsed.reason}`,
      'Repair the JSON syntax, then run the command again',
    );
  }

  const merged = mergeJsonEntries(parsed.document, action.operations);
  if (merged.state === 'drift') {
    return drift(action, action.path, `\`${merged.pointer}\`: ${merged.reason}`);
  }
  if (merged.state === 'unmergeable') {
    return refusal(
      action,
      'json-pointer-unmergeable',
      action.path,
      `\`${merged.pointer}\`: ${merged.reason}`,
      'Adjust the document by hand, or recompute the plan against its current shape',
    );
  }

  const ownership: OwnedArtifact[] = merged.entries.map((entry) => ({
    kind: 'owned-json-entry',
    path: action.path,
    pointer: entry.pointer,
    placement: entry.placement,
    valueDigest: entry.valueDigest,
  }));

  const text = formatJsonDocument(merged.document, parsed.formatting);
  if (text === original) return outcome(action, 'already-satisfied', { ownership });

  const diagnostics: Diagnostic[] = [];
  // RFC 0004 §Shared config merges preserves "user formatting when practical", and
  // "when comment-preserving mutation is not reliable, the planner reports that
  // limitation before apply". Indentation, line ending, and key order survive a
  // `JSON.stringify` round trip; per-node compactness does not — a hand-written
  // `{ "matcher": "Read" }` on one line comes back expanded. Detected by
  // re-serializing the *unmodified* document and comparing, so the report is about
  // this file rather than about JSON in general.
  if (formatJsonDocument(parsed.document, parsed.formatting) !== original) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'json-formatting-not-preserved',
        message:
          'Editing this document reformats parts of it that Token Harness cannot reproduce exactly, such as an object written on a single line',
        path: action.path,
        remediation:
          'Review the diff after apply; rollback restores the original bytes if the result is unacceptable',
      }),
    );
  }

  const snapshot = await context.snapshots.capture(action.path);
  await fs.writeFile(action.path, UTF8.encode(text), stat?.mode ?? null);
  return outcome(action, 'applied', { snapshots: [snapshot], ownership, diagnostics });
}

/** Reads back enough of the live file to judge an ownership claim. */
async function observeOwnership(
  target: OwnedArtifact,
  context: ActionContext,
): Promise<OwnershipVerdict> {
  const { fs } = context;
  const stat = await fs.stat(target.path);
  if (stat === null || stat.kind !== 'file') {
    return verifyOwnership(target, { exists: false });
  }
  if (target.kind === 'owned-file') {
    return verifyOwnership(target, {
      exists: true,
      fileDigest: digestBytes(await fs.readFile(target.path)),
    });
  }
  if (target.kind === 'owned-json-entry') {
    const parsed = parseJsonDocumentText(await readText(fs, target.path));
    if (parsed.state !== 'parsed') return 'unowned';
    const segments = parseJsonPointer(target.pointer);
    if (segments === null) return 'unowned';
    if (target.placement === 'array-element') {
      const lookup = resolveJsonPointer(parsed.document, segments);
      const array = Array.isArray(lookup.value) ? lookup.value : null;
      const present =
        array !== null && array.some((element) => jsonValueDigest(element) === target.valueDigest);
      return verifyOwnership(target, {
        exists: true,
        entryDigest: present ? target.valueDigest : null,
        // An array that no longer holds our element is a removal, not an edit: the
        // element we wrote is not there in any form we can recognise.
        entryPresent: false,
      });
    }
    const lookup = resolveJsonPointer(parsed.document, segments);
    return verifyOwnership(target, {
      exists: true,
      entryDigest:
        lookup.found && lookup.value !== undefined ? jsonValueDigest(lookup.value) : null,
      entryPresent: lookup.found,
    });
  }
  const lookup = findMarkerBlock(await readText(fs, target.path), {
    begin: target.markerBegin,
    end: target.markerEnd,
  });
  return verifyOwnership(target, {
    exists: true,
    bodyDigest: lookup.state === 'found' ? lookup.block.bodyDigest : null,
  });
}

/**
 * `remove-owned-change`.
 *
 * The destructive one, and the only place RFC 0004 §Ownership's limits are enforced:
 * "Token Harness can remove only files it created and whose digest or ownership
 * marker still matches" and "user edits inside an owned file ... block automatic
 * deletion until the user reviews the new uninstall plan".
 *
 * A modified artifact is a refusal, not a warning, and the diagnostic names the path.
 */
async function applyRemoveOwnedChange(
  action: RemoveOwnedChangeAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const { fs, snapshots } = context;
  const verdict = await observeOwnership(action.target, context);

  if (verdict === 'missing') {
    // Already gone. Uninstall is idempotent: someone removing our file by hand is not
    // a failure of uninstall, it is uninstall's goal reached by another route.
    return outcome(action, 'already-satisfied');
  }

  if (!mayRemoveAutomatically(verdict)) {
    return refusal(
      action,
      'owned-artifact-modified',
      action.target.path,
      verdict === 'owned-modified'
        ? 'This has been edited since Token Harness wrote it, so it will not be removed automatically'
        : 'Nothing here is marked as owned by Token Harness, so it will not be removed',
      'Review the change and remove it by hand, or re-run uninstall after reverting it',
    );
  }

  const snapshot = await snapshots.capture(action.target.path);

  if (action.target.kind === 'owned-file') {
    await fs.remove(action.target.path);
    return outcome(action, 'applied', { snapshots: [snapshot] });
  }

  if (action.target.kind === 'owned-json-entry') {
    const parsed = parseJsonDocumentText(await readText(fs, action.target.path));
    if (parsed.state !== 'parsed') {
      return refusal(
        action,
        parsed.state === 'comments' ? 'json-comments-unsupported' : 'json-malformed',
        action.target.path,
        'This document can no longer be edited without damaging it, so the entry was left in place',
        'Remove the entry by hand',
      );
    }
    const removal = removeJsonEntry(parsed.document, {
      pointer: action.target.pointer,
      placement: action.target.placement,
      valueDigest: action.target.valueDigest,
    });
    if (removal.state !== 'removed') {
      return refusal(
        action,
        'owned-artifact-modified',
        action.target.path,
        `The owned entry \`${action.target.pointer}\` could not be removed: it is ${removal.state}`,
        'Review the entry and remove it by hand',
      );
    }
    await fs.writeFile(
      action.target.path,
      UTF8.encode(formatJsonDocument(removal.document, parsed.formatting)),
      null,
    );
    return outcome(action, 'applied', { snapshots: [snapshot] });
  }

  const removal = removeMarkerBlock(await readText(fs, action.target.path), {
    begin: action.target.markerBegin,
    end: action.target.markerEnd,
  });
  if (!removal.ok) {
    return refusal(
      action,
      'marker-block-malformed',
      action.target.path,
      `The owned marker block could not be removed: ${removal.reason}`,
      'Remove the marker lines by hand',
    );
  }
  await fs.writeFile(action.target.path, UTF8.encode(removal.text), null);
  return outcome(action, 'applied', { snapshots: [snapshot] });
}

interface TreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'other';
  digest: string | null;
  byteLength: number;
}

async function scanTree(
  fs: FileSystemPort,
  path: string,
  entries: TreeEntry[] = [],
): Promise<TreeEntry[]> {
  const stat = await fs.stat(path);
  if (stat === null) return entries;
  const digest = stat.kind === 'file' ? digestBytes(await fs.readFile(path)) : null;
  entries.push({ path, kind: stat.kind, digest, byteLength: stat.byteLength });
  if (stat.kind === 'directory') {
    for (const child of await fs.readDirectory(path)) {
      await scanTree(fs, fs.join(path, child), entries);
    }
  }
  return entries;
}

function equalTreeEntry(left: TreeEntry, right: TreeEntry | undefined): boolean {
  return right !== undefined && left.kind === right.kind && left.digest === right.digest;
}

async function applyDelegatedProviderInstall(
  action: DelegatedProviderInstallAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  if (context.runner === null || context.runner === undefined || context.cwd === undefined) {
    return refusal(
      action,
      'process-runner-unavailable',
      action.executable,
      'A delegated provider install requires a process runner and working directory',
      'Run this command through the Token Harness CLI',
    );
  }

  const before = new Map<string, TreeEntry>();
  const expectedDirectory = action.affectedPaths.at(-1);
  if (expectedDirectory !== undefined && (await context.fs.stat(expectedDirectory)) !== null) {
    return outcome(action, 'already-satisfied');
  }

  for (const boundary of action.containmentBoundary) {
    for (const entry of await scanTree(context.fs, boundary)) before.set(entry.path, entry);
  }
  const bytes = [...before.values()].reduce((total, entry) => total + entry.byteLength, 0);
  if (bytes > action.snapshotSizeCapBytes) {
    return refusal(
      action,
      'delegated-install-snapshot-too-large',
      action.containmentBoundary[0] ?? action.executable,
      `The delegated install boundary is ${String(bytes)} bytes, above its ${String(action.snapshotSizeCapBytes)} byte snapshot cap`,
      'Narrow the provider containment boundary before applying this plan',
    );
  }

  const snapshots = [];
  for (const boundary of action.containmentBoundary) {
    for (const entry of await scanTree(context.fs, boundary)) {
      snapshots.push(await context.snapshots.capture(entry.path));
    }
    if (!before.has(boundary)) snapshots.push(await context.snapshots.capture(boundary));
  }
  for (const path of action.affectedPaths) {
    if (!before.has(path)) snapshots.push(await context.snapshots.capture(path));
  }

  const result = await context.runner.run({
    executable: action.executable,
    args: action.args,
    cwd: context.cwd,
    timeoutMs: 30_000,
  });
  if (!processSucceeded(result)) {
    return outcome(action, 'failed', {
      snapshots,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'delegated-install-failed',
          message: `${action.executable} did not complete its delegated install successfully`,
          remediation: 'Review the provider output and rerun the plan after correcting the problem',
        }),
      ],
    });
  }

  const after = new Map<string, TreeEntry>();
  for (const boundary of action.containmentBoundary) {
    for (const entry of await scanTree(context.fs, boundary)) after.set(entry.path, entry);
  }
  const undeclared = [...after.values()].find(
    (entry) =>
      !action.affectedPaths.some((path) => context.fs.isInside(entry.path, path)) &&
      !equalTreeEntry(entry, before.get(entry.path)),
  );
  if (undeclared !== undefined) {
    return outcome(action, 'failed', {
      snapshots,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'delegated-install-undeclared-write',
          message: `The delegated installer changed an undeclared path inside its containment boundary: ${undeclared.path}`,
          path: undeclared.path,
          remediation: 'Do not apply this provider until its reviewed write set is updated',
        }),
      ],
    });
  }

  return outcome(action, 'applied', { snapshots });
}
/**
 * The action families PLAN §15 issue 6 does not cover.
 *
 * They report rather than no-op, because an executor that silently skips an action it
 * does not understand produces a plan that claims to have been applied and was not.
 */
function notImplemented(action: PlannedAction): ActionOutcome {
  return outcome(action, 'failed', {
    diagnostics: [
      diagnostic({
        severity: 'error',
        code: 'action-not-implemented',
        message: `This build cannot execute a ${JSON.stringify(action.kind)} action`,
        remediation: 'Upgrade Token Harness, or remove the provider that planned this action',
      }),
    ],
  });
}

export async function applyAction(
  action: PlannedAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  switch (action.kind) {
    case 'create-directory':
      return applyCreateDirectory(action, context);
    case 'write-owned-file':
      return applyWriteOwnedFile(action, context);
    case 'patch-marker-block':
      return applyPatchMarkerBlock(action, context);
    case 'remove-owned-change':
      return applyRemoveOwnedChange(action, context);
    case 'merge-json':
      return applyMergeJson(action, context);
    case 'package-manager-install':
      return applyPackageManagerInstall(action, context);
    case 'delegated-provider-install':
      return applyDelegatedProviderInstall(action, context);
    case 'download-artifact':
    case 'run-installer-command':
    case 'merge-toml':
    case 'merge-yaml':
    case 'register-mcp-server':
    case 'register-hook':
      return notImplemented(action);
  }
}

/**
 * Installs a package, and owns nothing afterwards.
 *
 * The three departures from every other family here, each required by RFC 0004:
 *
 * - **no snapshot.** A package is not a file, so there is nothing to capture and nothing a
 *   rollback can restore. `install.ts` emits `install-not-reversible` on success so a later
 *   rollback does not read as "the machine is as it was".
 * - **no ownership.** Token Harness did not compose the installed files and will not remove them;
 *   `uninstall` leaves a provider installed for the same reason.
 * - **`refused`, not `failed`, when elevation is required.** Nothing is broken, and RFC 0004 says
 *   the user runs that step explicitly. The outcome carries the exact command.
 */
async function applyPackageManagerInstall(
  action: PackageManagerInstallAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const result = await runPackageManagerInstall({
    action,
    runner: context.runner ?? null,
    cwd: context.cwd ?? '',
  });

  const status: ActionStatus =
    result.status === 'installed' ? 'applied' : result.status === 'refused' ? 'refused' : 'failed';
  return outcome(action, status, { diagnostics: result.diagnostics });
}

/** The families this build can execute, exported so a planner can refuse to plan the rest. */
export const EXECUTABLE_ACTION_KINDS: readonly PlannedActionKind[] = [
  'create-directory',
  'write-owned-file',
  'patch-marker-block',
  'merge-json',
  'remove-owned-change',
  'package-manager-install',
  'delegated-provider-install',
];

export function isExecutableActionKind(kind: PlannedActionKind): boolean {
  return EXECUTABLE_ACTION_KINDS.includes(kind);
}

/**
 * The digest a `write-owned-file` action should record as its precondition when it is
 * planned as an update. Exported so a planner and the executor agree by construction
 * rather than by coincidence.
 */
export function ownedFileDigest(content: string): string {
  return digestText(content);
}
