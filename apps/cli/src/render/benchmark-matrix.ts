/**
 * Human rendering for the empirical paired benchmark matrix.
 *
 * The matrix counts deterministic pair verdicts and keeps evidence classes separate. It never
 * turns backend quota, local tokens, retries and quality into one synthetic score.
 */

import type {
  TaskBenchmarkMatrixEntry,
  TaskBenchmarkMatrixReport,
  TaskBenchmarkMatrixSummary,
} from '@token-harness/core';

import { document, formatCount, wrap, type RenderContext } from './layout.js';

function percent(value: number | null): string {
  if (value === null) return 'unknown';
  return `${value > 0 ? '+' : ''}${String(value)}%`;
}

function summaryLine(summary: TaskBenchmarkMatrixSummary): string {
  return (
    `${String(summary.pairs)} pairs — optimized ${String(summary.optimizedBetter)}, ` +
    `baseline ${String(summary.baselineBetter)}, equal ${String(summary.equivalent)}, ` +
    `inconclusive ${String(summary.inconclusive)}, incomparable ${String(summary.incomparable)}`
  );
}

function evidenceLine(summary: TaskBenchmarkMatrixSummary): string {
  return (
    `evidence — quota ${String(summary.quotaBacked)}, local ${String(summary.localEvidence)}, ` +
    `quality-only ${String(summary.qualityOnly)}`
  );
}

function localLine(summary: TaskBenchmarkMatrixSummary): string | null {
  if (
    summary.localComparablePairs === 0 ||
    summary.baselineLocalTokens === null ||
    summary.optimizedLocalTokens === null
  ) {
    return null;
  }
  return (
    `local tokens across ${String(summary.localComparablePairs)} quality-passed pairs — baseline ` +
    `${formatCount(summary.baselineLocalTokens)}, optimized ${formatCount(
      summary.optimizedLocalTokens,
    )}, delta ${percent(summary.localTokenSavingPercent)}`
  );
}

function entryLine(entry: TaskBenchmarkMatrixEntry): string {
  const local =
    entry.localTokenSavingPercent === null ? '' : `; local delta ${percent(entry.localTokenSavingPercent)}`;
  return (
    `${entry.benchmarkId} — ${entry.verdict}; ${entry.basis}; ${entry.evidenceLevel}${local}`
  );
}

export function renderBenchmarkMatrixReport(
  report: TaskBenchmarkMatrixReport,
  _context: RenderContext,
): string {
  const lines: string[] = ['Benchmark matrix — current project', ''];

  lines.push(
    ...wrap(
      `Selection: scanned ${String(report.selection.scanned)}; complete ${String(
        report.selection.completePairs,
      )}; incomplete ${String(report.selection.incomplete)}; invalid ${String(
        report.selection.invalid,
      )}; other project ${String(report.selection.otherProject)}; filtered ${String(
        report.selection.filteredOut,
      )}`,
      0,
    ),
  );

  if (report.entries.length === 0) {
    lines.push('', 'No complete benchmark pairs match this project/filter.');
    return document(lines);
  }

  lines.push('', 'By task class');
  for (const summary of report.byTaskClass) {
    lines.push(`  ${summary.taskClass ?? 'all'}`);
    lines.push(...wrap(summaryLine(summary), 4));
    lines.push(...wrap(evidenceLine(summary), 4));
    const local = localLine(summary);
    if (local !== null) lines.push(...wrap(local, 4));
  }

  lines.push('', 'Overall');
  lines.push(...wrap(summaryLine(report.overall), 2));
  lines.push(...wrap(evidenceLine(report.overall), 2));
  const overallLocal = localLine(report.overall);
  if (overallLocal !== null) lines.push(...wrap(overallLocal, 2));

  lines.push('', 'Pairs');
  for (const entry of report.entries) lines.push(...wrap(entryLine(entry), 2));

  lines.push(
    '',
    ...wrap(
      'Local token deltas are local evidence only. Backend quota is counted as quota-backed only when the paired comparator found one trustworthy same-window delta.',
      0,
    ),
  );

  return document(lines);
}
