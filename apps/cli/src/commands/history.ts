/**
 * `token-harness history` — RFC 0011 Phase 18.5.
 *
 * Read-only local usage history through ccusage. The child is forced offline and cost fields are
 * disabled so historical token observations cannot be mistaken for subscription spend.
 */

import {
  EXIT_CODES,
  assessLocalBurnTrend,
  commandResult,
  diagnostic,
  emptyHistoryTotals,
  harnessId,
  resolveMetricsWindow,
  type CommandResult,
  type DailyHistoryRow,
  type Diagnostic,
  type HarnessHistorySummary,
  type HistoryReport,
  type HistorySourceState,
  type HistoryTokenTotals,
  type SessionHistoryRow,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

const SUPPORTED_CCUSAGE_MAJOR = 20;
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const HISTORY_HARNESSES = new Set([CLAUDE, CODEX]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === 'string');
}

function normalizedHarness(value: unknown): typeof CLAUDE | null {
  return value === 'claude' ? CLAUDE : value === 'codex' ? CODEX : null;
}

function totals(row: Record<string, unknown>): HistoryTokenTotals {
  const inputTokens = number(row['inputTokens']);
  const cacheCreationTokens = number(row['cacheCreationTokens']);
  const cacheReadTokens = number(row['cacheReadTokens']);
  const outputTokens = number(row['outputTokens']);
  const providedTotal = number(row['totalTokens']);
  return {
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens:
      providedTotal > 0
        ? providedTotal
        : inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens,
  };
}

function dailyRows(payload: Record<string, unknown>): DailyHistoryRow[] {
  const rows: DailyHistoryRow[] = [];
  for (const raw of array(payload['daily'])) {
    const parent = object(raw);
    if (parent === null) continue;
    const period = text(parent['period']) ?? text(parent['date']);
    if (period === null) continue;

    const nested = array(parent['agents']);
    if (nested.length > 0) {
      for (const rawAgent of nested) {
        const agent = object(rawAgent);
        if (agent === null) continue;
        const harness = normalizedHarness(agent['agent']);
        if (harness === null) continue;
        rows.push({
          harnessId: harness,
          period,
          modelsUsed: stringArray(agent['modelsUsed']),
          ...totals(agent),
        });
      }
      continue;
    }

    const harness = normalizedHarness(parent['agent']);
    if (harness === null) continue;
    rows.push({
      harnessId: harness,
      period,
      modelsUsed: stringArray(parent['modelsUsed']),
      ...totals(parent),
    });
  }
  return rows;
}

function sessionRows(payload: Record<string, unknown>): SessionHistoryRow[] {
  const rows: SessionHistoryRow[] = [];
  const sourceRows = array(payload['session']).concat(array(payload['sessions']));
  for (const raw of sourceRows) {
    const row = object(raw);
    if (row === null) continue;
    const harness = normalizedHarness(row['agent']);
    if (harness === null) continue;
    const metadata = object(row['metadata']);
    const sessionId =
      text(row['period']) ?? text(row['sessionId']) ?? text(row['session']) ?? 'unknown';
    rows.push({
      harnessId: harness,
      sessionId,
      firstActivity: text(row['firstActivity']) ?? text(metadata?.['firstActivity']),
      lastActivity: text(row['lastActivity']) ?? text(metadata?.['lastActivity']),
      modelsUsed: stringArray(row['modelsUsed']),
      ...totals(row),
    });
  }
  return rows;
}

function summarize(
  harness: typeof CLAUDE,
  daily: readonly DailyHistoryRow[],
  sessions: readonly SessionHistoryRow[],
): HarnessHistorySummary {
  const dayRows = daily.filter((row) => row.harnessId === harness);
  const sessionRowsForHarness = sessions.filter((row) => row.harnessId === harness);
  const aggregate = (rows: readonly HistoryTokenTotals[]): HistoryTokenTotals =>
    rows.reduce(
      (sum, row) => ({
        inputTokens: sum.inputTokens + row.inputTokens,
        cacheCreationTokens: sum.cacheCreationTokens + row.cacheCreationTokens,
        cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
        outputTokens: sum.outputTokens + row.outputTokens,
        totalTokens: sum.totalTokens + row.totalTokens,
      }),
      emptyHistoryTotals(),
    );
  const modelsUsed = [
    ...new Set(
      dayRows
        .flatMap((row) => row.modelsUsed)
        .concat(sessionRowsForHarness.flatMap((row) => row.modelsUsed)),
    ),
  ].sort();

  return {
    harnessId: harness,
    days: dayRows.length,
    sessions: sessionRowsForHarness.length,
    modelsUsed,
    burnTrend: assessLocalBurnTrend(harness, dayRows),
    ...aggregate(dayRows),
  };
}

function blankReport(
  context: CommandContext,
  windowStart: string,
  windowEnd: string,
  state: HistorySourceState,
  version: string | null,
  diagnostics: Diagnostic[],
): HistoryReport {
  return {
    platform: context.platform,
    projectRoot: context.projectRoot,
    observedAt: context.now(),
    windowStart,
    windowEnd,
    source: {
      name: 'ccusage',
      state,
      version,
      supportedMajor: SUPPORTED_CCUSAGE_MAJOR,
      mode: 'local-read-only-offline',
      costsIncluded: false,
    },
    daily: [],
    sessions: [],
    harnesses: [],
    diagnostics,
  };
}

export async function runHistory(context: CommandContext): Promise<CommandResult<HistoryReport>> {
  const resolved = resolveMetricsWindow({
    since: context.since,
    until: context.until,
    now: context.now(),
  });
  if (!resolved.ok) {
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES['usage-error'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'invalid-history-window',
          message:
            resolved.failure === 'start-after-end'
              ? `The history window is empty: ${resolved.detail}`
              : `${JSON.stringify(resolved.detail)} is not a duration such as 7d or a date such as 2026-08-23`,
          remediation: 'Pass --since 7d, or an explicit YYYY-MM-DD range',
        }),
      ],
    });
  }

  const { window } = resolved;
  if (context.harness !== null && !HISTORY_HARNESSES.has(context.harness)) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'history-harness-unsupported',
      subject: context.harness,
      message: 'Quota-aware local history currently targets Claude Code and Codex',
      remediation: 'Run token-harness history without --harness, or select claude or codex',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', null, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  if (context.adapters === null) {
    const info = diagnostic({
      severity: 'info',
      code: 'history-runner-unavailable',
      message: 'No process runner was available, so local ccusage history was not read',
      remediation: null,
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', null, [
        info,
      ]),
      diagnostics: [info],
    });
  }

  const versionProbe = await context.adapters.runner.run({
    executable: 'ccusage',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
  });

  if (versionProbe.failure?.reason === 'executable-not-found') {
    const info = diagnostic({
      severity: 'info',
      code: 'ccusage-not-installed',
      message: 'ccusage is not installed; historical local usage remains unavailable',
      remediation: 'Install ccusage separately if you want Token Harness to read local history',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'absent', null, [info]),
      diagnostics: [info],
    });
  }

  if (
    versionProbe.failure !== null ||
    versionProbe.exitCode !== 0 ||
    versionProbe.stdoutTruncated
  ) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'ccusage-version-unavailable',
      message: 'ccusage was found, but its version could not be read reliably',
      remediation: 'Run ccusage --version and verify the installation',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', null, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionProbe.stdout);
  const version = match === null ? null : `${match[1]}.${match[2]}.${match[3]}`;
  const major = match === null ? null : Number(match[1]);
  if (major !== SUPPORTED_CCUSAGE_MAJOR) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'ccusage-version-incompatible',
      message:
        version === null
          ? 'ccusage returned a version string this build does not recognize'
          : `ccusage ${version} is outside the fixture-proven 20.x schema`,
      remediation: 'Upgrade Token Harness before relying on this ccusage major version',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'incompatible', version, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  const observed = await context.adapters.runner.run({
    executable: 'ccusage',
    args: [
      'daily',
      '--sections',
      'daily,session',
      '--by-agent',
      '--json',
      '--offline',
      '--no-cost',
      '--timezone',
      'UTC',
      '--since',
      window.windowStart,
      '--until',
      window.windowEnd,
    ],
    cwd: context.projectRoot,
    timeoutMs: 30_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });

  if (observed.failure !== null || observed.exitCode !== 0 || observed.stdoutTruncated) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'ccusage-history-unavailable',
      message: observed.stdoutTruncated
        ? 'ccusage history exceeded the bounded JSON capture'
        : 'ccusage could not produce the requested offline JSON history',
      remediation: 'Run the equivalent ccusage daily --json --offline command directly for details',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', version, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(observed.stdout);
  } catch {
    const warning = diagnostic({
      severity: 'warning',
      code: 'ccusage-history-invalid-json',
      message: 'ccusage returned output that is not valid JSON',
      remediation: 'Verify ccusage 20.x with --json --offline, then retry',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', version, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  const payload = object(parsed);
  if (payload === null) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'ccusage-history-invalid-schema',
      message: 'ccusage JSON did not contain the expected report object',
      remediation: 'Upgrade Token Harness if the ccusage 20.x JSON schema changed',
    });
    return commandResult({
      command: 'history',
      exitCode: EXIT_CODES.ok,
      data: blankReport(context, window.windowStart, window.windowEnd, 'unavailable', version, [
        warning,
      ]),
      diagnostics: [warning],
    });
  }

  const filterHarness = context.harness;
  const daily = dailyRows(payload)
    .filter((row) => filterHarness === null || row.harnessId === filterHarness)
    .sort((left, right) => left.period.localeCompare(right.period));
  const sessions = sessionRows(payload)
    .filter((row) => filterHarness === null || row.harnessId === filterHarness)
    .sort((left, right) => (left.lastActivity ?? '').localeCompare(right.lastActivity ?? ''));

  const harnesses = [CLAUDE, CODEX]
    .filter((harness) => filterHarness === null || harness === filterHarness)
    .map((harness) => summarize(harness, daily, sessions));

  const report: HistoryReport = {
    ...blankReport(context, window.windowStart, window.windowEnd, 'available', version, []),
    daily,
    sessions,
    harnesses,
  };

  return commandResult({
    command: 'history',
    exitCode: EXIT_CODES.ok,
    data: report,
  });
}
