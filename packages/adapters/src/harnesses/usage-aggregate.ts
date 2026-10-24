/** Shared accumulation for the delegated-usage readers. Numbers and model ids only. */

import type {
  DelegatedUsageHarness,
  DelegatedUsageHarnessId,
  DelegatedUsageModelRow,
  DelegatedUsageSplit,
  UsageLogPort,
} from '@token-harness/core';

export interface DelegatedUsageInput {
  /** The user's home directory. */
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  now: Date;
  /** Trailing window length in days. Defaults to 30. */
  days?: number | undefined;
  fs: UsageLogPort;
}

export interface TokenCounts {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const DEFAULT_USAGE_DAYS = 30;
const DAY_MS = 86_400_000;

export function windowStartMs(input: DelegatedUsageInput): number {
  return input.now.getTime() - (input.days ?? DEFAULT_USAGE_DAYS) * DAY_MS;
}

export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the record's timestamp is present, parseable, and before the window. */
export function beforeWindow(timestamp: unknown, startMs: number): boolean {
  if (typeof timestamp !== 'string') return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed < startMs;
}

export class ModelTotals {
  private readonly rows = new Map<string, TokenCounts>();

  add(model: string, counts: TokenCounts): void {
    const row = this.rows.get(model) ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    row.input += counts.input;
    row.cacheWrite += counts.cacheWrite;
    row.cacheRead += counts.cacheRead;
    row.output += counts.output;
    this.rows.set(model, row);
  }

  merge(other: ModelTotals): void {
    for (const [model, counts] of other.rows) this.add(model, counts);
  }

  split(): DelegatedUsageSplit {
    const byModel: DelegatedUsageModelRow[] = [...this.rows]
      .map(([model, c]) => ({
        model,
        ...c,
        total: c.input + c.cacheWrite + c.cacheRead + c.output,
      }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || (a.model < b.model ? -1 : 1));
    return { total: byModel.reduce((sum, row) => sum + row.total, 0), byModel };
  }
}

export function emptyHarness(
  harnessId: DelegatedUsageHarnessId,
  state: DelegatedUsageHarness['state'],
): DelegatedUsageHarness {
  return {
    harnessId,
    state,
    files: 0,
    errors: 0,
    root: { total: 0, byModel: [] },
    delegated: { total: 0, byModel: [] },
  };
}

export function finishHarness(
  harnessId: DelegatedUsageHarnessId,
  files: number,
  errors: number,
  root: ModelTotals,
  delegated: ModelTotals,
): DelegatedUsageHarness {
  const rootSplit = root.split();
  const delegatedSplit = delegated.split();
  return {
    harnessId,
    state: rootSplit.total + delegatedSplit.total > 0 ? 'observed' : 'no-data',
    files,
    errors,
    root: rootSplit,
    delegated: delegatedSplit,
  };
}

/** Parse one JSON line. Null means malformed; undefined means blank (ignored). */
export function parseLine(line: string): Record<string, unknown> | null | undefined {
  if (line.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
