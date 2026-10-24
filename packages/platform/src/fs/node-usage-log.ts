/**
 * The real filesystem behind `UsageLogPort`: recursive `.jsonl` listing that never follows
 * symlinks, and streamed line reading for files too large to load whole.
 */

import { createReadStream } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { createInterface } from 'node:readline';

import type { UsageLogEntry, UsageLogPort } from '@token-harness/core';

export class NodeUsageLog implements UsageLogPort {
  private readonly flavor: typeof win32 | typeof posix;

  constructor(nativeWindows: boolean = process.platform === 'win32') {
    this.flavor = nativeWindows ? win32 : posix;
  }

  join(...segments: string[]): string {
    return this.flavor.join(...segments);
  }

  async listJsonl(root: string): Promise<UsageLogEntry[] | null> {
    try {
      const rootStat = await lstat(root);
      if (!rootStat.isDirectory()) return null;
    } catch {
      return null;
    }
    const found: UsageLogEntry[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop() as string;
      let handle;
      try {
        handle = await opendir(directory);
      } catch {
        continue;
      }
      for await (const entry of handle) {
        const path = this.flavor.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          pending.push(path);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try {
            found.push({ path, mtimeMs: (await lstat(path)).mtimeMs });
          } catch {
            // Vanished between listing and stat: not an entry.
          }
        }
      }
    }
    return found.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async *readLines(path: string): AsyncIterable<string> {
    const stream = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) yield line;
    } finally {
      lines.close();
      stream.destroy();
    }
  }
}
