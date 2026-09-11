/**
 * Human rendering for the empirical paired benchmark matrix.
 *
 * The matrix counts deterministic pair verdicts and keeps evidence classes separate. It never
 * turns backend quota, local tokens, context exposure, retries, quality or timing into one
 * synthetic score.
 */

import type {
  OptimizationCandidateId,
  TaskBenchmarkContextMatrixEntry,
  TaskBenchmarkContextMatrixReport,
  TaskBenchmarkContextMatrixSummary,
  TaskBenchmarkMatrixEntry,
  TaskBenchmarkMatrixReport,
  TaskBenchmarkMatrixSummary,
  TaskClass,
} from '@token-harness/core';

import { document, formatCount, wrap, type RenderContext } from './layout.js';

interface CandidateEvidenceSummary {
  candidateId: OptimizationCandidateId;
  pairs: number;
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  inconclusive: number;
  incomparable: number;
  evidencePairs: number;
  evidenceCoveragePercent: number | null;
  localComparablePairs: number;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
  wallClockComparablePairs: number;
  baselineWallClockMs: number | null;
  optimizedWallClockMs: number | null;
  wallClockSavingPercent: number | null;
}

interface CandidateCampaignSlotSummary {
  benchmarkId: string;
  taskClass: TaskClass;
  run: number;
  state:
    | 'baseline-not-started'
    | 'baseline-running'
    | 'optimized-not-started'
    | 'optimized-running'
    | 'complete'
    | 'invalid';
}

interface CandidateCampaignSummary {
  campaignId: string;
  candidateId: OptimizationCandidateId;
  harnessId: string;
  runsPerTask: number;
  totalPairs: number;
  completedPairs: number;
  invalidPairs: number;
  slots: readonly CandidateCampaignSlotSummary[];
  nextCommand: string | null;
  nextInstruction: string;
  evidence: CandidateEvidenceSummary;
}

type CandidateAwareReport = (TaskBenchmarkMatrixReport | TaskBenchmarkContextMatrixReport) & {
  candidateEvidence?: readonly CandidateEvidenceSummary[];
  campaign?: CandidateCampaignSummary;
};

function percent(value: number | null): string {
  if (value === null) return 'unknown';
  return `${value > 0 ? '+' : ''}${String(value)}%`;
}

function duration(value: number): string {
  const minutes = value / 60_000;
  if (minutes < 1) return `${String(Math.round((value / 1000) * 10) / 10)}s`;
  if (minutes < 60) return `${String(Math.round(minutes * 10) / 10)}m`;
  return `${String(Math.round((minutes / 60) * 10) / 10)}h`;
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

function contextLine(summary: TaskBenchmarkContextMatrixSummary): string {
  return (
    `context — reduced ${String(summary.reduced)}, same ${String(summary.same)}, ` +
    `increased ${String(summary.increased)}, unknown ${String(summary.unknown)}`
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

function candidateSummaryLine(summary: CandidateEvidenceSummary): string {
  return (
    `${String(summary.pairs)} pairs; evidence ${String(summary.evidencePairs)}/${String(
      summary.pairs,
    )} (${percent(summary.evidenceCoveragePercent)}); optimized ${String(
      summary.optimizedBetter,
    )}, baseline ${String(summary.baselineBetter)}, equal ${String(summary.equivalent)}, ` +
    `inconclusive ${String(summary.inconclusive)}, incomparable ${String(summary.incomparable)}`
  );
}

function candidateLocalLine(summary: CandidateEvidenceSummary): string | null {
  if (
    summary.localComparablePairs === 0 ||
    summary.baselineLocalTokens === null ||
    summary.optimizedLocalTokens === null
  ) {
    return null;
  }
  return (
    `local tokens ${formatCount(summary.baselineLocalTokens)}→${formatCount(
      summary.optimizedLocalTokens,
    )} across ${String(summary.localComparablePairs)} quality-passed pairs; ` +
    `delta ${percent(summary.localTokenSavingPercent)}`
  );
}

function candidateTimingLine(summary: CandidateEvidenceSummary): string | null {
  if (
    summary.wallClockComparablePairs === 0 ||
    summary.baselineWallClockMs === null ||
    summary.optimizedWallClockMs === null
  ) {
    return null;
  }
  return (
    `wall clock ${duration(summary.baselineWallClockMs)}→${duration(
      summary.optimizedWallClockMs,
    )} across ${String(summary.wallClockComparablePairs)} quality-passed pairs; ` +
    `delta ${percent(summary.wallClockSavingPercent)}`
  );
}

function entryLine(entry: TaskBenchmarkMatrixEntry | TaskBenchmarkContextMatrixEntry): string {
  const local =
    entry.localTokenSavingPercent === null
      ? ''
      : `; local delta ${percent(entry.localTokenSavingPercent)}`;
  if (!('context' in entry)) {
    return `${entry.benchmarkId} — ${entry.verdict}; ${entry.basis}; ${entry.evidenceLevel}${local}`;
  }
  const contextCounts =
    entry.context.baseline === null || entry.context.optimized === null
      ? ''
      : ` ${String(entry.context.baseline.effectiveStaticMcpToolCount)}→${String(
          entry.context.optimized.effectiveStaticMcpToolCount,
        )} static tools`;
  return (
    `${entry.benchmarkId} — ${entry.verdict}; ${entry.basis}; ${entry.evidenceLevel}${local}; ` +
    `context ${entry.context.verdict}${contextCounts}`
  );
}

function renderCampaign(lines: string[], campaign: CandidateCampaignSummary): void {
  lines.push('', 'Candidate campaign — experimental');
  lines.push(
    ...wrap(
      `${campaign.campaignId}: ${campaign.candidateId} on ${campaign.harnessId}; ` +
        `${String(campaign.completedPairs)}/${String(campaign.totalPairs)} pairs complete; ` +
        `${String(campaign.invalidPairs)} invalid`,
      2,
    ),
  );
  lines.push(
    ...wrap(
      `Protocol: ${String(campaign.runsPerTask)} paired runs per selected task class. ` +
        'The campaign is reconstructed from normal benchmark captures and receipts; no separate campaign state is written.',
      2,
    ),
  );

  lines.push('', '  Progress');
  const taskClasses: TaskClass[] = ['mechanical', 'standard', 'hard', 'critical'];
  for (const taskClass of taskClasses) {
    const slots = campaign.slots.filter((slot) => slot.taskClass === taskClass);
    if (slots.length === 0) continue;
    const complete = slots.filter((slot) => slot.state === 'complete').length;
    const invalid = slots.filter((slot) => slot.state === 'invalid').length;
    const active = slots.find((slot) => slot.state !== 'complete')?.state ?? 'complete';
    lines.push(
      ...wrap(
        `${taskClass}: ${String(complete)}/${String(slots.length)} complete; ` +
          `next state ${active}${invalid === 0 ? '' : `; invalid ${String(invalid)}`}`,
        4,
      ),
    );
  }

  lines.push('', '  Next');
  lines.push(...wrap(campaign.nextInstruction, 4));
  if (campaign.nextCommand !== null) lines.push(...wrap(campaign.nextCommand, 4));

  lines.push('', '  Campaign evidence');
  lines.push(...wrap(candidateSummaryLine(campaign.evidence), 4));
  const local = candidateLocalLine(campaign.evidence);
  if (local !== null) lines.push(...wrap(local, 4));
  const timing = candidateTimingLine(campaign.evidence);
  if (timing !== null) lines.push(...wrap(timing, 4));
  lines.push(
    ...wrap(
      'Campaign evidence stays separate by evidence class. Completion does not itself prove that the candidate was active or that it should be promoted.',
      2,
    ),
  );
}

export function renderBenchmarkMatrixReport(
  report: CandidateAwareReport,
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

  if (report.campaign !== undefined) renderCampaign(lines, report.campaign);

  if (report.entries.length === 0) {
    lines.push(
      '',
      report.campaign === undefined
        ? 'No complete benchmark pairs match this project/filter.'
        : 'No complete campaign pairs are available yet.',
    );
    return document(lines);
  }

  const contextReport = 'context' in report ? report : null;

  lines.push('', 'By task class');
  for (const summary of report.byTaskClass) {
    lines.push(`  ${summary.taskClass ?? 'all'}`);
    lines.push(...wrap(summaryLine(summary), 4));
    lines.push(...wrap(evidenceLine(summary), 4));
    const contextSummary = contextReport?.context.byTaskClass.find(
      (item) => item.taskClass === summary.taskClass,
    );
    if (contextSummary !== undefined) lines.push(...wrap(contextLine(contextSummary), 4));
    const local = localLine(summary);
    if (local !== null) lines.push(...wrap(local, 4));
  }

  lines.push('', 'Overall');
  lines.push(...wrap(summaryLine(report.overall), 2));
  lines.push(...wrap(evidenceLine(report.overall), 2));
  if (contextReport !== null) lines.push(...wrap(contextLine(contextReport.context.overall), 2));
  const overallLocal = localLine(report.overall);
  if (overallLocal !== null) lines.push(...wrap(overallLocal, 2));

  if (report.candidateEvidence !== undefined && report.campaign === undefined) {
    lines.push('', 'Candidate evidence — experimental');
    for (const candidate of report.candidateEvidence) {
      lines.push(`  ${candidate.candidateId}`);
      lines.push(...wrap(candidateSummaryLine(candidate), 4));
      const local = candidateLocalLine(candidate);
      if (local !== null) lines.push(...wrap(local, 4));
      const timing = candidateTimingLine(candidate);
      if (timing !== null) lines.push(...wrap(timing, 4));
    }
    lines.push(
      ...wrap(
        'Candidate attribution names the experiment target; it does not prove the candidate was active and it is not an activation or promotion recommendation.',
        0,
      ),
    );
  }

  lines.push('', 'Pairs');
  for (const entry of report.entries) lines.push(...wrap(entryLine(entry), 2));

  lines.push(
    '',
    ...wrap(
      'Local token deltas are local evidence only. Backend quota is counted as quota-backed only when the paired comparator found one trustworthy same-window delta.',
      0,
    ),
  );

  if (contextReport !== null) {
    lines.push(
      ...wrap(
        'Context savings require quality-passed, start-to-finish stable evidence. Context exposure is context-shape evidence only and is not subscription quota.',
        0,
      ),
    );
  }

  if (report.candidateEvidence !== undefined || report.campaign !== undefined) {
    lines.push(
      ...wrap(
        'Wall-clock deltas are shown only for quality-passed pairs and remain timing evidence, not a comparator verdict or provider-allowance claim.',
        0,
      ),
    );
  }

  return document(lines);
}
