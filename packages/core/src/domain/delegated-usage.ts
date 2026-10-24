/**
 * Delegated usage: how many tokens each coding agent spent on the main conversation
 * ("root") versus on subagents ("delegated"), per model, over a trailing window.
 *
 * Only model ids and numbers appear here. Transcript text, prompts, paths and tool
 * payloads never leave the adapter that read them.
 */

export type DelegatedUsageHarnessId = 'claude' | 'codex';
export type DelegatedUsageState = 'observed' | 'no-data' | 'unavailable';

export interface DelegatedUsageModelRow {
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /** input + cacheWrite + cacheRead + output. */
  total: number;
}

export interface DelegatedUsageSplit {
  total: number;
  /** Sorted by `total`, descending. */
  byModel: DelegatedUsageModelRow[];
}

export interface DelegatedUsageHarness {
  harnessId: DelegatedUsageHarnessId;
  state: DelegatedUsageState;
  /** Log files read (those inside the window by modification time). */
  files: number;
  /** Lines that could not be parsed, plus files that could not be read. */
  errors: number;
  root: DelegatedUsageSplit;
  delegated: DelegatedUsageSplit;
}

export interface DelegatedUsageReport {
  windowStart: string;
  windowEnd: string;
  days: number;
  harnesses: DelegatedUsageHarness[];
}

/** A log file found beneath a root, with its modification time. */
export interface UsageLogEntry {
  path: string;
  mtimeMs: number;
}

/**
 * What the usage readers need from the machine. Separate from `FileSystemPort` because
 * transcripts are large: reading is line-by-line, and listing is recursive without ever
 * following a symlink out of the root.
 */
export interface UsageLogPort {
  join(...segments: string[]): string;
  /** Every `.jsonl` file beneath `root`, symlinks not followed. Null when `root` is absent. */
  listJsonl(root: string): Promise<UsageLogEntry[] | null>;
  /** Lines of a file, streamed. May throw when the file cannot be read. */
  readLines(path: string): AsyncIterable<string>;
}
