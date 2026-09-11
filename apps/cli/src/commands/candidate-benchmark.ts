/** Candidate attribution layered over the existing paired benchmark engine. */
import {
  EXIT_CODES,
  diagnostic,
  parseTaskBenchmarkReceipt,
  type CommandResult,
  type Diagnostic,
  type OptimizationCandidateId,
  type TaskBenchmarkCaptureStartReport,
  type TaskBenchmarkContextMatrixReport,
  type TaskBenchmarkMatrixEntry,
  type TaskBenchmarkVariant,
} from '@token-harness/core';

import { runBenchmarkStart } from './benchmark-capture.js';
import { runBenchmarkMatrix } from './benchmark-matrix.js';
import {
  OPTIMIZATION_CANDIDATES,
  readCandidateBenchmarkAttribution,
  writeCandidateBenchmarkAttribution,
} from './candidate-benchmark-attribution.js';
import type { CommandContext } from './context.js';

export type CandidateAwareTaskBenchmarkCaptureStartReport = TaskBenchmarkCaptureStartReport & {
  /** Experiment target only. This is not proof that the candidate was active. */
  candidateId?: OptimizationCandidateId;
};

export interface CandidateBenchmarkTimingEvidence {
  baselineWallClockMs: number | null;
  optimizedWallClockMs: number | null;
  wallClockSavingPercent: number | null;
}

export type CandidateBenchmarkEvidenceEntry = TaskBenchmarkMatrixEntry &
  Partial<CandidateBenchmarkTimingEvidence>;

export interface CandidateBenchmarkEvidence {
  candidateId: OptimizationCandidateId;
  pairs: number;
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  inconclusive: number;
  incomparable: number;
  quotaBacked: number;
  localEvidence: number;
  qualityOnly: number;
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

export type CandidateAwareBenchmarkMatrixReport = TaskBenchmarkContextMatrixReport & {
  candidateEvidence: CandidateBenchmarkEvidence[];
};

function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function summarizeCandidateBenchmarkEntries(
  candidateId: OptimizationCandidateId,
  entries: readonly CandidateBenchmarkEvidenceEntry[],
): CandidateBenchmarkEvidence {
  const local = entries.filter(
    (entry) =>
      entry.localTokenSavingPercent !== null &&
      entry.baselineLocalTokens !== null &&
      entry.optimizedLocalTokens !== null,
  );
  const baselineLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.baselineLocalTokens ?? 0), 0);
  const optimizedLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.optimizedLocalTokens ?? 0), 0);
  const timing = entries.filter(
    (entry) =>
      entry.baselineWallClockMs !== undefined &&
      entry.baselineWallClockMs !== null &&
      entry.optimizedWallClockMs !== undefined &&
      entry.optimizedWallClockMs !== null &&
      entry.wallClockSavingPercent !== undefined &&
      entry.wallClockSavingPercent !== null,
  );
  const baselineWallClockMs =
    timing.length === 0
      ? null
      : timing.reduce((total, entry) => total + (entry.baselineWallClockMs ?? 0), 0);
  const optimizedWallClockMs =
    timing.length === 0
      ? null
      : timing.reduce((total, entry) => total + (entry.optimizedWallClockMs ?? 0), 0);
  const evidencePairs = entries.filter((entry) => entry.evidenceLevel !== 'none').length;

  return {
    candidateId,
    pairs: entries.length,
    optimizedBetter: entries.filter((entry) => entry.verdict === 'optimized-better').length,
    baselineBetter: entries.filter((entry) => entry.verdict === 'baseline-better').length,
    equivalent: entries.filter((entry) => entry.verdict === 'equivalent').length,
    inconclusive: entries.filter((entry) => entry.verdict === 'inconclusive').length,
    incomparable: entries.filter((entry) => entry.verdict === 'incomparable').length,
    quotaBacked: entries.filter((entry) => entry.evidenceLevel === 'quota-backed').length,
    localEvidence: entries.filter((entry) => entry.evidenceLevel === 'local-evidence').length,
    qualityOnly: entries.filter((entry) => entry.evidenceLevel === 'quality-only').length,
    evidencePairs,
    evidenceCoveragePercent: roundedPercent(evidencePairs, entries.length),
    localComparablePairs: local.length,
    baselineLocalTokens,
    optimizedLocalTokens,
    localTokenSavingPercent:
      baselineLocalTokens === null || optimizedLocalTokens === null
        ? null
        : roundedPercent(baselineLocalTokens - optimizedLocalTokens, baselineLocalTokens),
    wallClockComparablePairs: timing.length,
    baselineWallClockMs,
    optimizedWallClockMs,
    wallClockSavingPercent:
      baselineWallClockMs === null || optimizedWallClockMs === null
        ? null
        : roundedPercent(baselineWallClockMs - optimizedWallClockMs, baselineWallClockMs),
  };
}

export function buildCandidateBenchmarkEvidence(
  entries: ReadonlyMap<OptimizationCandidateId, readonly CandidateBenchmarkEvidenceEntry[]>,
): CandidateBenchmarkEvidence[] {
  return OPTIMIZATION_CANDIDATES.map((candidate) =>
    summarizeCandidateBenchmarkEntries(candidate, entries.get(candidate) ?? []),
  );
}

function receiptPath(
  context: CommandContext,
  benchmarkId: string,
  variant: TaskBenchmarkVariant,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, `${variant}.json`);
}

async function readTimingEvidence(
  context: CommandContext,
  benchmarkId: string,
): Promise<CandidateBenchmarkTimingEvidence> {
  const empty: CandidateBenchmarkTimingEvidence = {
    baselineWallClockMs: null,
    optimizedWallClockMs: null,
    wallClockSavingPercent: null,
  };
  if (context.adapters === null) return empty;

  const readReceipt = async (variant: TaskBenchmarkVariant) => {
    const path = receiptPath(context, benchmarkId, variant);
    if (path === null) return null;
    const stat = await context.adapters?.fs.stat(path);
    if (stat === null || stat === undefined || stat.kind !== 'file') return null;
    try {
      const raw = JSON.parse(
        new TextDecoder().decode(await context.adapters?.fs.readFile(path)),
      ) as unknown;
      const parsed = parseTaskBenchmarkReceipt(raw);
      return parsed.ok ? parsed.receipt : null;
    } catch {
      return null;
    }
  };

  const baseline = await readReceipt('baseline');
  const optimized = await readReceipt('optimized');
  if (
    baseline === null ||
    optimized === null ||
    baseline.benchmarkId !== benchmarkId ||
    optimized.benchmarkId !== benchmarkId ||
    baseline.outcome.qualityGate !== 'passed' ||
    optimized.outcome.qualityGate !== 'passed'
  ) {
    return empty;
  }

  const baselineWallClockMs = Date.parse(baseline.completedAt) - Date.parse(baseline.startedAt);
  const optimizedWallClockMs = Date.parse(optimized.completedAt) - Date.parse(optimized.startedAt);
  if (
    !Number.isFinite(baselineWallClockMs) ||
    !Number.isFinite(optimizedWallClockMs) ||
    baselineWallClockMs < 0 ||
    optimizedWallClockMs < 0
  ) {
    return empty;
  }

  return {
    baselineWallClockMs,
    optimizedWallClockMs,
    wallClockSavingPercent: roundedPercent(
      baselineWallClockMs - optimizedWallClockMs,
      baselineWallClockMs,
    ),
  };
}

/**
 * Start the normal benchmark capture, then persist only candidate identity beside it.
 * The receipt schema and comparator remain unchanged. Candidate identity means experiment target,
 * not proof that the candidate was active in either run.
 */
export async function runCandidateBenchmarkStart(
  context: CommandContext,
): Promise<CommandResult<CandidateAwareTaskBenchmarkCaptureStartReport | null>> {
  const requestedCandidate = context.optimizationCandidate ?? null;
  const benchmarkId = context.benchmarkId ?? null;
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;
  const existing =
    benchmarkId === null ? 'absent' : await readCandidateBenchmarkAttribution(context, benchmarkId);

  if (requestedCandidate !== null && benchmarkId !== null) {
    if (
      existing === 'invalid' ||
      (existing !== 'absent' &&
        (existing.candidateId !== requestedCandidate ||
          (projectId !== null && existing.projectId !== projectId)))
    ) {
      return {
        command: 'benchmark-start',
        exitCode: EXIT_CODES['precondition-drift'],
        data: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'candidate-benchmark-attribution-conflict',
            message: `Benchmark ${benchmarkId} already has incompatible candidate attribution`,
            remediation: 'Use a new benchmark id instead of reusing ambiguous experiment state',
          }),
        ],
      };
    }
  }

  const result = await runBenchmarkStart(context);
  if (result.data === null || result.exitCode !== EXIT_CODES.ok) return result;

  if (
    existing !== 'absent' &&
    existing !== 'invalid' &&
    existing.benchmarkId === result.data.capture.benchmarkId &&
    existing.projectId === result.data.capture.projectId
  ) {
    return {
      ...result,
      data: { ...result.data, candidateId: existing.candidateId },
    };
  }

  if (requestedCandidate === null) return result;

  const written = await writeCandidateBenchmarkAttribution(context, {
    schemaVersion: 1,
    benchmarkId: result.data.capture.benchmarkId,
    candidateId: requestedCandidate,
    projectId: result.data.capture.projectId,
  });
  if (written) {
    return {
      ...result,
      data: { ...result.data, candidateId: requestedCandidate },
    };
  }

  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      diagnostic({
        severity: 'warning',
        code: 'candidate-benchmark-attribution-write-failed',
        message:
          'The benchmark capture was created, but its optional candidate attribution could not be saved',
        remediation:
          'Keep the capture as ordinary benchmark evidence and use a new id for candidate-specific evidence',
      }),
    ],
  };
}

/** Add candidate-specific summaries without changing the deterministic matrix verdicts. */
export async function runCandidateBenchmarkMatrix(
  context: CommandContext,
): Promise<CommandResult<CandidateAwareBenchmarkMatrixReport | null>> {
  const result = await runBenchmarkMatrix(context);
  if (result.data === null) return { ...result, data: null };

  const entries = new Map<OptimizationCandidateId, CandidateBenchmarkEvidenceEntry[]>(
    OPTIMIZATION_CANDIDATES.map((candidate) => [candidate, []]),
  );
  const diagnostics: Diagnostic[] = [...result.diagnostics];
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;

  for (const entry of result.data.entries) {
    const attribution = await readCandidateBenchmarkAttribution(context, entry.benchmarkId);
    if (attribution === 'absent') continue;
    if (
      attribution === 'invalid' ||
      attribution.benchmarkId !== entry.benchmarkId ||
      (projectId !== null && attribution.projectId !== projectId)
    ) {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'candidate-benchmark-attribution-invalid',
          subject: entry.benchmarkId,
          message: 'Candidate attribution was ignored because it is invalid or belongs elsewhere',
          remediation:
            'Keep the benchmark pair as ordinary evidence; use a new id for a clean candidate run',
        }),
      );
      continue;
    }
    const timing = await readTimingEvidence(context, entry.benchmarkId);
    entries.get(attribution.candidateId)?.push({ ...entry, ...timing });
  }

  return {
    ...result,
    data: {
      ...result.data,
      candidateEvidence: buildCandidateBenchmarkEvidence(entries),
    },
    diagnostics,
  };
}
