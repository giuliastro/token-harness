/** Apply admitted local file actions to an overlay; never invoke a process or write the host. */
import { digestBytes, digestText } from '../domain/digest.js';
import type { PlannedAction } from '../domain/actions.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import type { FileSnapshot } from '../domain/ownership.js';
import { applyAction } from './actions.js';
import type { FileStat, FileSystemPort } from './filesystem.js';
import type { SnapshotStore } from './snapshots.js';

export interface FileFingerprint {
  path: string;
  kind: 'absent' | 'file' | 'directory';
  digest: string | null;
  mode: string | null;
}
export async function fileFingerprint(fs: FileSystemPort, path: string): Promise<FileFingerprint> {
  const stat = await fs.stat(path);
  if ((stat?.byteLength ?? 0) > 8 * 1024 * 1024)
    throw new Error('Configuration exceeds preview size limit');
  if (stat === null) return { path, kind: 'absent', digest: null, mode: null };
  if (stat.kind === 'other') throw new Error(`Non-file target: ${path}`);
  return {
    path,
    kind: stat.kind,
    mode: stat.mode,
    digest:
      stat.kind === 'file'
        ? digestBytes(await fs.readFile(path))
        : digestText(JSON.stringify((await fs.readDirectory(path)).sort())),
  };
}
export function fingerprintMatches(expected: FileFingerprint, actual: FileFingerprint): boolean {
  return (
    expected.kind === actual.kind &&
    expected.digest === actual.digest &&
    (expected.mode === null || expected.mode === actual.mode)
  );
}

interface OverlayEntry {
  content: Uint8Array | null;
  directory: boolean;
  mode: string | null;
}
export class FilePlanOverlay implements FileSystemPort {
  readonly entries = new Map<string, OverlayEntry>();
  readonly base: FileSystemPort;
  constructor(base: FileSystemPort) {
    this.base = base;
  }
  join(...parts: string[]): string {
    return this.base.join(...parts);
  }
  dirname(path: string): string {
    return this.base.dirname(path);
  }
  basename(path: string): string {
    return this.base.basename(path);
  }
  isInside(candidate: string, parent: string): boolean {
    return this.base.isInside(candidate, parent);
  }
  async stat(path: string): Promise<FileStat | null> {
    const entry = this.entries.get(path);
    if (entry !== undefined)
      return entry.content === null && !entry.directory
        ? null
        : {
            kind: entry.directory ? 'directory' : 'file',
            byteLength: entry.content?.byteLength ?? 0,
            mode: entry.mode,
          };
    for (const [parent, value] of this.entries)
      if (value.content === null && !value.directory && this.isInside(path, parent)) return null;
    return this.base.stat(path);
  }
  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (entry === undefined) {
      if (((await this.base.stat(path))?.byteLength ?? 0) > 8 * 1024 * 1024)
        throw new Error('Configuration exceeds preview size limit');
      return this.base.readFile(path);
    }
    if (entry.content === null) throw new Error('Preview file is absent');
    return new Uint8Array(entry.content);
  }
  async createDirectory(path: string): Promise<void> {
    const stat = await this.stat(path);
    if (stat?.kind === 'directory') return;
    if (stat !== null) throw new Error('Preview directory conflicts with a file');
    const parent = this.dirname(path);
    if (parent !== path) await this.createDirectory(parent);
    this.entries.set(path, { directory: true, content: null, mode: null });
  }
  async writeFile(path: string, content: Uint8Array, _mode?: string | null): Promise<void> {
    const previous = await this.stat(path);
    await this.createDirectory(this.dirname(path));
    this.entries.set(path, {
      directory: false,
      content: new Uint8Array(content),
      mode: previous?.mode ?? null,
    });
  }
  async appendFile(path: string, content: Uint8Array): Promise<void> {
    const before = (await this.stat(path)) === null ? new Uint8Array() : await this.readFile(path);
    const bytes = new Uint8Array(before.length + content.length);
    bytes.set(before);
    bytes.set(content, before.length);
    await this.writeFile(path, bytes);
  }
  async remove(path: string): Promise<void> {
    for (const child of this.entries.keys())
      if (this.isInside(child, path))
        this.entries.set(child, { content: null, directory: false, mode: null });
    this.entries.set(path, { content: null, directory: false, mode: null });
  }
  async readDirectory(path: string): Promise<string[]> {
    const names = new Set(await this.base.readDirectory(path));
    for (const [child, entry] of this.entries)
      if (this.dirname(child) === path) {
        if (entry.content === null && !entry.directory) names.delete(this.basename(child));
        else names.add(this.basename(child));
      }
    return [...names].sort();
  }
}

export interface FilePlanPreview {
  fs: FilePlanOverlay;
  before: FileFingerprint[];
  prefixes: FileFingerprint[][];
  diagnostics: Diagnostic[];
}
export async function previewFilePlan(
  fs: FileSystemPort,
  actions: readonly PlannedAction[],
  inventory: readonly string[] = [],
): Promise<FilePlanPreview> {
  const allowed = new Set([
    'merge-json',
    'patch-marker-block',
    'write-owned-file',
    'remove-owned-change',
    'create-directory',
  ]);
  if (
    actions.length > 256 ||
    actions.some(
      (action) => !allowed.has(action.kind) || action.requiresNetwork || action.requiresElevation,
    )
  )
    throw new Error(
      'Temporary benchmarks admit only reviewed local file actions; run ordinary setup first',
    );
  const overlay = new FilePlanOverlay(fs);
  const captured: FileSnapshot[] = [];
  const snapshots: SnapshotStore = {
    captured,
    capture: async (path) => {
      const s: FileSnapshot = {
        schemaVersion: 1,
        path,
        existed: (await overlay.stat(path)) !== null,
        wasDirectory: false,
        digest: null,
        mode: null,
        byteLength: null,
        contentRef: null,
        capturedAt: '2000-01-01T00:00:00Z',
      };
      captured.push(s);
      return s;
    },
    captureAbsent: (path) => ({
      schemaVersion: 1,
      path,
      existed: false,
      wasDirectory: false,
      digest: null,
      mode: null,
      byteLength: null,
      contentRef: null,
      capturedAt: '2000-01-01T00:00:00Z',
    }),
    restore: async () => {
      throw new Error('Preview does not restore');
    },
    restoreAll: async () => {
      throw new Error('Preview does not restore');
    },
  };
  const states: Array<Map<string, OverlayEntry>> = [];
  const diagnostics: Diagnostic[] = [];
  for (const action of actions) {
    const result = await applyAction(action, { fs: overlay, snapshots, runner: null });
    diagnostics.push(...result.diagnostics);
    if (result.status !== 'applied' && result.status !== 'already-satisfied')
      throw new Error(
        `Cannot preview ${action.id}: ${result.diagnostics.map((d) => d.message).join('; ')}`,
      );
    states.push(new Map(overlay.entries));
  }
  const paths = [
    ...new Set([
      ...inventory,
      ...actions.flatMap((a) => a.affectedPaths),
      ...overlay.entries.keys(),
    ]),
  ].sort((a, b) =>
    a !== b && fs.isInside(b, a) ? -1 : a !== b && fs.isInside(a, b) ? 1 : a.localeCompare(b),
  );
  const before = await Promise.all(paths.map((path) => fileFingerprint(fs, path)));
  if (paths.length > 256) throw new Error('Configuration path inventory exceeds preview limit');
  let bytes = 0;
  for (const path of paths) {
    bytes += (await fs.stat(path))?.byteLength ?? 0;
    if (bytes > 32 * 1024 * 1024)
      throw new Error('Configuration snapshot exceeds total size limit');
  }
  const prefixes: FileFingerprint[][] = [before];
  for (const state of states) {
    const view = new FilePlanOverlay(fs);
    for (const [path, entry] of state) view.entries.set(path, entry);
    prefixes.push(await Promise.all(paths.map((path) => fileFingerprint(view, path))));
  }
  return { fs: overlay, before, prefixes, diagnostics };
}
