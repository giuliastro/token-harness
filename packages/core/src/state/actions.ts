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
 * Eight action families are implemented: the four that touch files without a parser (PLAN §15
 * issue 6), `merge-json`, the deliberately narrow `merge-yaml`, `package-manager-install`,
 * and the containment-bounded `delegated-provider-install`. The rest report
 * `action-not-implemented` rather than silently
 * succeeding.
 */

import {
  queryPackageInventory,
  runPackageManagerInstall,
  type PackageInventoryCapture,
} from './install.js';
import { processSucceeded, type ProcessRunner } from '../domain/process.js';
import type {
  CodexConfigBatchWriteAction,
  CreateDirectoryAction,
  DelegatedProviderInstallAction,
  MergeJsonAction,
  MergeYamlAction,
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
import {
  findYamlStringArrayEntry,
  mergeYamlStringArrayEntry,
  removeYamlStringArrayEntry,
} from './yaml-array.js';
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
  /**
   * The package inventory captured before a `package-inventory` install ran.
   *
   * Non-null only for a `package-manager-install` whose action declared `rollbackData:
   * 'package-inventory'`. The journal entry carries it, which is what lets a rollback later
   * restore the package it was captured for — and, when it is null, lets the rollback say the
   * package was not restored instead of implying it was.
   */
  packageInventory: PackageInventoryCapture | null;
}

function outcome(
  action: PlannedAction,
  status: ActionStatus,
  parts: Partial<
    Pick<ActionOutcome, 'snapshots' | 'ownership' | 'diagnostics' | 'packageInventory'>
  > = {},
): ActionOutcome {
  return {
    actionId: action.id,
    kind: action.kind,
    status,
    snapshots: parts.snapshots ?? [],
    ownership: parts.ownership ?? [],
    diagnostics: parts.diagnostics ?? [],
    packageInventory: parts.packageInventory ?? null,
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

/**
 * `merge-yaml`, intentionally limited to owned string entries in block sequences.
 *
 * The pure editor refuses YAML it cannot preserve safely. Unlike a general parser/serializer it
 * never rewrites unrelated keys or comments, which is the important property for a shared harness
 * config file.
 */
async function applyMergeYaml(
  action: MergeYamlAction,
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

  const stat = await fs.stat(action.path);
  if (stat !== null && stat.kind !== 'file') {
    return refusal(
      action,
      'path-is-not-a-file',
      action.path,
      'A directory exists where Token Harness needs to merge a YAML document',
      'Move or remove the directory, then run the command again',
    );
  }
  if (stat === null && !action.createIfMissing) {
    return drift(
      action,
      action.path,
      'The YAML document this plan merges into no longer exists, and the plan does not permit creating it',
    );
  }

  let text = stat === null ? '' : await readText(fs, action.path);
  const ownership: OwnedArtifact[] = [];
  let changed = false;

  for (const operation of action.operations) {
    if (operation.kind !== 'append-string') {
      return refusal(
        action,
        'yaml-operation-unsupported',
        action.path,
        `This build cannot execute YAML operation ${JSON.stringify(operation.kind)}`,
        'Recompute the plan with a supported Token Harness build',
      );
    }

    if (operation.expectedValueDigest !== null) {
      const live = findYamlStringArrayEntry({
        text,
        pointer: operation.pointer,
        valueDigest: operation.expectedValueDigest,
      });
      if (live.state !== 'found') {
        return drift(
          action,
          action.path,
          `${operation.pointer}: the owned YAML entry is no longer present in the stored-plan shape`,
        );
      }
      if (
        operation.expectedLineDigest !== null &&
        live.lineDigest !== operation.expectedLineDigest
      ) {
        return drift(
          action,
          action.path,
          `${operation.pointer}: the owned YAML line has been edited since the plan was computed`,
        );
      }
    }

    const merged = mergeYamlStringArrayEntry({
      text,
      pointer: operation.pointer,
      value: operation.value,
    });
    if (merged.state === 'unmergeable') {
      return refusal(
        action,
        'yaml-shape-unsupported',
        action.path,
        `${operation.pointer}: ${merged.reason}`,
        'Keep this YAML entry in block-sequence form, or configure the integration by hand',
      );
    }

    if (
      operation.expectedValueDigest !== null &&
      merged.entry.valueDigest !== operation.expectedValueDigest
    ) {
      return drift(
        action,
        action.path,
        `${operation.pointer}: the owned YAML value no longer matches the stored plan`,
      );
    }

    text = merged.text;
    changed ||= merged.changed;
    // Brownfield rule: an initial plan whose desired value is already present did not write that
    // entry, so it must not turn the user's byte-identical configuration into Token Harness
    // ownership. A persisted update carries expectedValueDigest/expectedLineDigest and may retain
    // an ownership claim; a fresh append earns ownership only when it actually adds the line.
    if (merged.changed || operation.expectedValueDigest !== null) {
      ownership.push({
        kind: 'owned-yaml-entry',
        path: action.path,
        pointer: merged.entry.pointer,
        placement: 'array-element',
        valueDigest: merged.entry.valueDigest,
        lineDigest: merged.entry.lineDigest,
      });
    }
  }

  if (!changed) return outcome(action, 'already-satisfied', { ownership });

  const snapshot = await context.snapshots.capture(action.path);
  await fs.writeFile(action.path, UTF8.encode(text), stat?.mode ?? null);
  return outcome(action, 'applied', { snapshots: [snapshot], ownership });
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
  if (target.kind === 'owned-yaml-entry') {
    const lookup = findYamlStringArrayEntry({
      text: await readText(fs, target.path),
      pointer: target.pointer,
      valueDigest: target.valueDigest,
    });
    if (lookup.state === 'unmergeable') return 'unowned';
    return verifyOwnership(target, {
      exists: true,
      entryDigest: lookup.state === 'found' ? lookup.lineDigest : null,
      entryPresent: lookup.state === 'found',
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

  if (action.target.kind === 'owned-yaml-entry') {
    const removal = removeYamlStringArrayEntry({
      text: await readText(fs, action.target.path),
      pointer: action.target.pointer,
      valueDigest: action.target.valueDigest,
      lineDigest: action.target.lineDigest,
    });
    if (removal.state !== 'removed') {
      return refusal(
        action,
        removal.state === 'unmergeable' ? 'yaml-shape-unsupported' : 'owned-artifact-modified',
        action.target.path,
        removal.state === 'unmergeable'
          ? `The owned YAML entry could not be removed safely: ${removal.reason}`
          : `The owned YAML entry \`${action.target.pointer}\` is ${removal.state}`,
        'Review the entry and remove it by hand',
      );
    }
    await fs.writeFile(action.target.path, UTF8.encode(removal.text), null);
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

/**
 * Whether a path is in the same state on both sides of a delegated install.
 *
 * Absent on both sides counts as equal, and that is the whole point of this comment. It used to
 * require both entries to be defined, which made a path that never existed read as *changed* — and
 * the protected-path check below is a `find` over exactly such paths. HarnessTrim's skills-only
 * install names `.claude/settings.json` and `CLAUDE.md` as protected precisely because the installer
 * must not create them, so the check failed every time the installer behaved correctly. The
 * flagship delegated install could not succeed on any machine at any version; the exact-version gate
 * in the provider kept anyone from reaching it and finding out.
 *
 * The other caller iterates the union of the before and after keys, so at least one side is defined
 * there and this case cannot arise — which is why the fix belongs here rather than at one call site.
 */
function equalTreeEntry(left: TreeEntry | undefined, right: TreeEntry | undefined): boolean {
  if (left === undefined && right === undefined) return true;
  return (
    left !== undefined &&
    right !== undefined &&
    left.kind === right.kind &&
    left.digest === right.digest
  );
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
  for (const boundary of action.containmentBoundary) {
    for (const entry of await scanTree(context.fs, boundary)) before.set(entry.path, entry);
  }
  if (
    action.expectedArtifacts.every(
      (artifact) =>
        before.get(artifact.path)?.kind === 'file' &&
        before.get(artifact.path)?.digest === artifact.digest,
    )
  ) {
    return outcome(action, 'already-satisfied');
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
  const capturedPaths = new Set<string>();
  for (const boundary of action.containmentBoundary) {
    const entries = await scanTree(context.fs, boundary);
    if (entries.length === 0) {
      snapshots.push(await context.snapshots.capture(boundary));
      capturedPaths.add(boundary);
      continue;
    }
    for (const entry of entries) {
      snapshots.push(await context.snapshots.capture(entry.path));
      capturedPaths.add(entry.path);
    }
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
  for (const entry of after.values()) {
    if (!before.has(entry.path) && !capturedPaths.has(entry.path)) {
      snapshots.push(context.snapshots.captureAbsent(entry.path));
      capturedPaths.add(entry.path);
    }
  }

  const protectedPath = action.protectedPaths.find(
    (path) => !equalTreeEntry(before.get(path), after.get(path)),
  );
  if (protectedPath !== undefined) {
    return outcome(action, 'failed', {
      snapshots,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'delegated-install-protected-path-changed',
          message: `The delegated installer changed the protected path ${protectedPath}`,
          path: protectedPath,
          remediation: 'Do not apply this provider until its reviewed write set is updated',
        }),
      ],
    });
  }

  const changed = new Set([...before.keys(), ...after.keys()]);
  const undeclared = [...changed]
    .map((path) => after.get(path) ?? before.get(path))
    .find(
      (entry) =>
        entry !== undefined &&
        !equalTreeEntry(before.get(entry.path), after.get(entry.path)) &&
        !action.expectedArtifacts.some(
          (artifact) =>
            artifact.path === entry.path ||
            (entry.kind === 'directory' && context.fs.isInside(artifact.path, entry.path)),
        ),
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

  const missing = action.expectedArtifacts.find(
    (artifact) =>
      after.get(artifact.path)?.kind !== 'file' ||
      after.get(artifact.path)?.digest !== artifact.digest,
  );
  if (missing !== undefined) {
    return outcome(action, 'failed', {
      snapshots,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'delegated-install-artifact-mismatch',
          message: `The delegated installer did not produce the reviewed artifact ${missing.path}`,
          path: missing.path,
          remediation: 'Do not apply this provider until its reviewed artifact digests are updated',
        }),
      ],
    });
  }

  const ownership: OwnedArtifact[] = [];
  for (const artifact of action.expectedArtifacts) {
    ownership.push({
      kind: 'owned-file',
      path: artifact.path,
      digest: artifact.digest,
      mode: (await context.fs.stat(artifact.path))?.mode ?? null,
    });
  }
  return outcome(action, 'applied', { snapshots, ownership });
}

/**
 * `codex-config-batch-write`.
 *
 * Codex is the TOML editor. Token Harness supplies the exact user config path and the version
 * observed while planning, snapshots the file before the RPC, and lets the surrounding transaction
 * restore that snapshot on any later failure. A configVersionConflict is drift, never a retry
 * against bytes the user did not review.
 */
async function applyCodexConfigBatchWrite(
  action: CodexConfigBatchWriteAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  if (context.runner === null || context.runner === undefined) {
    return refusal(
      action,
      'codex-config-runner-unavailable',
      action.path,
      'Codex config mutation requires the Codex app-server process runner',
      'Run apply in an environment where Codex is installed and available on PATH',
    );
  }

  if (action.affectedPaths.length !== 1 || action.affectedPaths[0] !== action.path) {
    return refusal(
      action,
      'codex-config-path-mismatch',
      action.path,
      'This action does not declare exactly the config.toml path it asks Codex to mutate',
      'Recompute the plan with a current Token Harness build',
    );
  }

  if (action.edits.length === 0) return outcome(action, 'already-satisfied');

  const snapshot = await context.snapshots.capture(action.path);
  const stdin = [
    JSON.stringify({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'token_harness',
          title: 'Token Harness',
          version: '0.1',
        },
      },
    }),
    JSON.stringify({ method: 'initialized', params: {} }),
    JSON.stringify({
      method: 'config/batchWrite',
      id: 2,
      params: {
        edits: action.edits,
        filePath: action.path,
        expectedVersion: action.expectedVersion,
        reloadUserConfig: action.reloadUserConfig,
      },
    }),
    '',
  ].join('\n');

  const result = await context.runner.run({
    executable: 'codex',
    args: ['app-server', '--stdio'],
    cwd: context.cwd ?? context.fs.dirname(action.path),
    stdin,
    timeoutMs: 15_000,
    maxOutputBytes: 1024 * 1024,
  });

  if (result.failure !== null) {
    return outcome(action, 'failed', {
      snapshots: [snapshot],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'codex-config-write-unavailable',
          message:
            'Codex app-server could not apply the reviewed config batch: ' +
            result.failure.message,
          path: action.path,
          remediation: 'Check the installed Codex CLI, then run token-harness plan again',
        }),
      ],
    });
  }

  const messages: unknown[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      messages.push(JSON.parse(line) as unknown);
    } catch {
      // Tracing belongs on stderr; unrelated stdout is ignored rather than treated as success.
    }
  }
  const response = messages.find(
    (message): message is Record<string, unknown> =>
      typeof message === 'object' &&
      message !== null &&
      !Array.isArray(message) &&
      (message as Record<string, unknown>)['id'] === 2,
  );

  const error =
    response !== undefined &&
    typeof response['error'] === 'object' &&
    response['error'] !== null &&
    !Array.isArray(response['error'])
      ? (response['error'] as Record<string, unknown>)
      : null;

  const errorText =
    error === null
      ? ''
      : [error['message'], error['data']]
          .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
          .filter((value) => value !== undefined && value !== '')
          .join(' ');

  if (/configVersionConflict/i.test(errorText)) {
    return drift(
      action,
      action.path,
      'Codex reports that config.toml changed after this plan observed its config version',
    );
  }

  if (
    result.exitCode !== 0 ||
    response === undefined ||
    error !== null ||
    !('result' in response)
  ) {
    return outcome(action, 'failed', {
      snapshots: [snapshot],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'codex-config-write-failed',
          message:
            errorText !== ''
              ? 'Codex rejected the reviewed config batch: ' + errorText
              : 'Codex app-server returned no successful config/batchWrite response',
          path: action.path,
          remediation: 'Run token-harness plan again against the current Codex configuration',
        }),
      ],
    });
  }

  return outcome(action, 'applied', { snapshots: [snapshot] });
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
    case 'merge-yaml':
      return applyMergeYaml(action, context);
    case 'codex-config-batch-write':
      return applyCodexConfigBatchWrite(action, context);
    case 'package-manager-install':
      return applyPackageManagerInstall(action, context);
    case 'delegated-provider-install':
      return applyDelegatedProviderInstall(action, context);
    case 'download-artifact':
    case 'run-installer-command':
    case 'merge-toml':
    case 'register-mcp-server':
    case 'register-hook':
      return notImplemented(action);
  }
}

/**
 * Installs a package, capturing the inventory when the action asked for one.
 *
 * The three departures from every other family here, each required by RFC 0004, plus the capture
 * that RFC 0009 §Initial delivery order item 1 adds:
 *
 * - **no snapshot.** A package is not a file, so there is nothing to capture and nothing a
 *   rollback can restore from the filesystem. Instead, when the action declares `rollbackData:
 *   'package-inventory'`, the channel is asked what it has installed *before* the install runs,
 *   and that capture travels with the outcome into the journal.
 * - **no ownership.** Token Harness did not compose the installed files and will not remove them;
 *   `uninstall` leaves a provider installed for the same reason.
 * - **`refused`, not `failed`, when elevation is required.** Nothing is broken, and RFC 0004 says
 *   the user runs that step explicitly. The outcome carries the exact command.
 *
 * The success receipt follows the capture: `install-inventory-captured` when the channel reported
 * a prior version (a rollback can restore it), `install-not-reversible` when it did not (a
 * rollback will say the package stayed).
 */
async function applyPackageManagerInstall(
  action: PackageManagerInstallAction,
  context: ActionContext,
): Promise<ActionOutcome> {
  const wantsInventory = action.rollbackData === 'package-inventory' && !action.requiresElevation;
  const packageInventory =
    wantsInventory && context.runner !== undefined
      ? await queryPackageInventory({
          channel: action.packageManager,
          packageName: action.packageName,
          runner: context.runner,
          cwd: context.cwd ?? '',
        })
      : null;

  const result = await runPackageManagerInstall({
    action,
    runner: context.runner ?? null,
    cwd: context.cwd ?? '',
  });

  const status: ActionStatus =
    result.status === 'installed' ? 'applied' : result.status === 'refused' ? 'refused' : 'failed';

  const diagnostics = [...result.diagnostics];
  if (status === 'applied') {
    if (packageInventory?.status === 'captured' && packageInventory.version !== null) {
      // RFC 0009: the rollback may now restore this package and verify the restore, so the
      // receipt says so instead of the old "rollback will not uninstall it".
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'install-inventory-captured',
          message: `${action.packageName} was installed through ${action.packageManager}; the prior state (${packageInventory.version}) was captured, so a rollback can restore it`,
          remediation: null,
        }),
      );
    } else {
      // The pre-0009 contract, kept for every case without a captured prior version: a package
      // is not a file, so it survives a rollback, and the receipt says so rather than letting
      // the report imply the machine is as it was.
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'install-not-reversible',
          message: `${action.packageName} was installed through ${action.packageManager}; a rollback restores files and will not uninstall it`,
          remediation: null,
        }),
      );
    }
  }

  return outcome(action, status, { diagnostics, packageInventory });
}

/** The families this build can execute, exported so a planner can refuse to plan the rest. */
export const EXECUTABLE_ACTION_KINDS: readonly PlannedActionKind[] = [
  'create-directory',
  'write-owned-file',
  'patch-marker-block',
  'merge-json',
  'merge-yaml',
  'codex-config-batch-write',
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
