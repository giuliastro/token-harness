/**
 * The real filesystem, behind the `FileSystemPort` from `core`.
 *
 * Everything platform-specific about files is confined here, and there are three
 * such things worth naming:
 *
 * - the path grammar, which is `win32` or `posix` depending on the facts;
 * - the POSIX mode, reported as null on native Windows so that no core module can
 *   mistake a Windows mode for access information — the same trap RFC 0004 §State
 *   directory permissions describes for `fs.chmod`;
 * - case sensitivity, which `isInside` gets from `pathsEqual`'s rules rather than by
 *   guessing.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import type { FileStat, FileSystemPort, PlatformFacts } from '@token-harness/core';

import { isInsideDirectory } from '../platform/paths.js';

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

export class NodeFileSystem implements FileSystemPort {
  private readonly facts: PlatformFacts;
  private readonly flavor: typeof win32 | typeof posix;
  private readonly nativeWindows: boolean;

  constructor(facts: PlatformFacts) {
    this.facts = facts;
    this.nativeWindows = facts.os === 'windows' && !facts.isWsl;
    this.flavor = this.nativeWindows ? win32 : posix;
  }

  join(...segments: string[]): string {
    return this.flavor.join(...segments);
  }

  dirname(path: string): string {
    return this.flavor.dirname(path);
  }

  basename(path: string): string {
    return this.flavor.basename(path);
  }

  isInside(candidate: string, parent: string): boolean {
    return isInsideDirectory(candidate, parent, this.facts);
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const info = await stat(path);
      return {
        kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
        byteLength: info.isFile() ? info.size : 0,
        // On native Windows the mode bits are not an access control mechanism, so
        // reporting them would invite a caller to treat them as one.
        mode: this.nativeWindows ? null : octal(info.mode),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(path));
  }

  async writeFile(path: string, content: Uint8Array, mode?: string | null): Promise<void> {
    await mkdir(this.dirname(path), { recursive: true });
    const parsed = mode == null || this.nativeWindows ? null : Number.parseInt(mode, 8);
    await writeFile(path, content, parsed === null || Number.isNaN(parsed) ? {} : { mode: parsed });
  }

  async createDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    // `force` makes a missing path a success, which is what the port promises: the
    // caller wants the path gone, and it already is.
    await rm(path, { recursive: true, force: true });
  }

  async readDirectory(path: string): Promise<string[]> {
    try {
      return (await readdir(path)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
