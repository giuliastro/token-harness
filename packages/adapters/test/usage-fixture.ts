import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { UsageLogEntry, UsageLogPort } from '@token-harness/core';

export const NOW = new Date('2026-06-30T12:00:00.000Z');
export const DAY = 86_400_000;

export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'th-usage-'));
}

/** Writes a jsonl file (lines are objects or raw strings) and sets its mtime. */
export function writeJsonl(
  path: string,
  lines: readonly (object | string)[],
  mtime: Date = NOW,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n',
  );
  utimesSync(path, mtime, mtime);
}

function walk(directory: string, out: UsageLogEntry[]): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(path, out);
    else if (name.endsWith('.jsonl')) out.push({ path, mtimeMs: stat.mtimeMs });
  }
}

/** A real-filesystem port for tests: adapters cannot import the platform package. */
export const testUsageLog: UsageLogPort = {
  join: (...segments) => join(...segments),
  listJsonl: async (root) => {
    try {
      lstatSync(root);
    } catch {
      return null;
    }
    const out: UsageLogEntry[] = [];
    walk(root, out);
    return out;
  },
  readLines: async function* (path) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) yield line;
  },
};
