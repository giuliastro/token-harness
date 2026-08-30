/**
 * Read-only local coding-agent history imported from ccusage.
 *
 * Historical token usage is deliberately separate from live subscription quota. Nothing in this
 * model converts local tokens into provider allowance percentages or subscription spend.
 */

import type { Diagnostic } from './diagnostics.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';

export type HistorySourceState = 'available' | 'absent' | 'incompatible' | 'unavailable';

export interface HistoryTokenTotals {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface DailyHistoryRow extends HistoryTokenTotals {
  harnessId: HarnessId;
  period: string;
  modelsUsed: string[];
}

export interface SessionHistoryRow extends HistoryTokenTotals {
  harnessId: HarnessId;
  sessionId: string;
  firstActivity: string | null;
  lastActivity: string | null;
  modelsUsed: string[];
}

export type BurnTrendState = 'rising' | 'stable' | 'falling' | 'unknown';

export interface LocalBurnTrend {
  harnessId: HarnessId;
  state: BurnTrendState;
  recentAverageTokensPerDay: number | null;
  previousAverageTokensPerDay: number | null;
  changePercent: number | null;
  recentDays: number;
  previousDays: number;
  reason: string;
}

export interface HarnessHistorySummary extends HistoryTokenTotals {
  harnessId: HarnessId;
  days: number;
  sessions: number;
  modelsUsed: string[];
  burnTrend: LocalBurnTrend;
}

export interface HistorySource {
  name: 'ccusage';
  state: HistorySourceState;
  version: string | null;
  supportedMajor: number;
  mode: 'local-read-only-offline';
  costsIncluded: false;
}

export interface HistoryReport {
  platform: PlatformFacts;
  projectRoot: string;
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  source: HistorySource;
  daily: DailyHistoryRow[];
  sessions: SessionHistoryRow[];
  harnesses: HarnessHistorySummary[];
  diagnostics: Diagnostic[];
}

export function emptyHistoryTotals(): HistoryTokenTotals {
  return {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function assessLocalBurnTrend(
  harnessId: HarnessId,
  rows: readonly DailyHistoryRow[],
): LocalBurnTrend {
  const matching = rows
    .filter((row) => row.harnessId === harnessId)
    .slice()
    .sort((left, right) => left.period.localeCompare(right.period));

  if (matching.length < 4) {
    return {
      harnessId,
      state: 'unknown',
      recentAverageTokensPerDay: null,
      previousAverageTokensPerDay: null,
      changePercent: null,
      recentDays: Math.min(3, matching.length),
      previousDays: 0,
      reason: 'at least four daily observations are required for a local burn trend',
    };
  }

  const split = Math.min(3, Math.floor(matching.length / 2));
  const recent = matching.slice(-split);
  const previous = matching.slice(-(split * 2), -split);
  const average = (values: readonly DailyHistoryRow[]): number =>
    values.reduce((total, row) => total + row.totalTokens, 0) / values.length;
  const recentAverage = average(recent);
  const previousAverage = average(previous);

  if (previousAverage === 0) {
    return {
      harnessId,
      state: recentAverage === 0 ? 'stable' : 'rising',
      recentAverageTokensPerDay: Math.round(recentAverage),
      previousAverageTokensPerDay: 0,
      changePercent: null,
      recentDays: recent.length,
      previousDays: previous.length,
      reason:
        recentAverage === 0
          ? 'both comparison windows recorded zero local tokens'
          : 'recent local token usage is non-zero after a zero-token comparison window',
    };
  }

  const changePercent = ((recentAverage - previousAverage) / previousAverage) * 100;
  const state: BurnTrendState =
    changePercent > 20 ? 'rising' : changePercent < -20 ? 'falling' : 'stable';

  return {
    harnessId,
    state,
    recentAverageTokensPerDay: Math.round(recentAverage),
    previousAverageTokensPerDay: Math.round(previousAverage),
    changePercent: Math.round(changePercent * 10) / 10,
    recentDays: recent.length,
    previousDays: previous.length,
    reason:
      state === 'rising'
        ? 'recent local token volume is more than 20% above the preceding comparison window'
        : state === 'falling'
          ? 'recent local token volume is more than 20% below the preceding comparison window'
          : 'recent local token volume is within a 20% deadband of the preceding window',
  };
}
