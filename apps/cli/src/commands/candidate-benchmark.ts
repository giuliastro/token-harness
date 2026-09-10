/** Candidate attribution layered over the existing paired benchmark engine. */
import {
  EXIT_CODES,
  diagnostic,
  type CommandResult,
  type Diagnostic,
  type OptimizationCandidateId,
  type TaskBenchmarkCaptureStartReport,
  type TaskBenchmarkContextMatrixReport,
  type TaskBenchmarkMatrixEntry,
} from '@token-harness/core';

import { runBenchmarkStart } from './benchmark-capture.js';
import { runBenchmarkMatrix } from './benchmark-matrix.js';
import type { CommandContext } from './context.js';

const ATTRIBUTION_SCHEMA_VERSION = 1;
const CANDIDATES: readonly OptimizationCandidateId[] = ['headroom', 'mcptoon'];
const CANDIDATE_SET = new Set<string>(CANDIDATES);

interface CandidateBenchmarkAttribution {
  schemaVersion: typeof ATTRIBUTION_SCHEMA_VERSION;
  benchmarkId: string;
  candidateId: OptimizationCandidateId;
  projectId: string;
}

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
  localComparablePairs: number;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
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
  entries: readonly TaskBenchmarkMatrixEntry[],
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
    localComparablePairs: local.length,
    baselineLocalTokens,
    optimizedLocalTokens,
    localTokenSavingPercent:
      baselineLocalTokens === null || optimizedLocalTokens === null
        ? null
        : roundedPercent(baselineLocalTokens - optimizedLocalTokens, baselineLocalTokens),
  };
}

function attributionPath(context: CommandContext, benchmarkId: string): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, 'candidate.json');
}

function parseAttribution(value: unknown): CandidateBenchmarkAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row['schemaVersion'] !== ATTRIBUTION_SCHEMA_VERSION ||
    typeof row['benchmarkId'] !== 'string' ||
    typeof row['candidateId'] !== 'string' ||
    !CANDIDATE_SET.has(row['candidateId']) ||
    typeof row['projectId'] !== 'string' ||
    row['projectId'] === ''
  )
    return null;
  return {
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    benchmarkId: row['benchmarkId'],
    candidateId: row['candidateId'] as OptimizationCandidateId,
    projectId: row['projectId'],
  };
}

async function readAttribution(
  context: CommandContext,
  benchmarkId: string,
): Promise<'absent' | 'invalid' | CandidateBenchmarkAttribution> {
  const path = attributionPath(context, benchmarkId);
  if (path === null || context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';
  try {
    const raw = JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
    return parseAttribution(raw) ?? 'invalid';
  } catch {
    return 'invalid';
  }
}

async function writeAttribution(
  context: CommandContext,
  value: CandidateBenchmarkAttribution,
): Promise<boolean> {
  const path = attributionPath(context, value.benchmarkId);
  if (path === null || context.adapters === null) return false;
  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the normal benchmark capture, then persist only candidate identity beside it.
 * The receipt schema and comparator remain unchanged. Candidate identity means experiment target,
 * not proof that the candidate was active in either run.
 */
export async function runCandidateBenchmarkStart(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCaptureStartReport | null>> {
  const candidateId = context.optimizationCandidate ?? null;
  if (candidateId === null) return runBenchmarkStart(context);

  const benchmarkId = context.benchmarkId ?? null;
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;
  if (benchmarkId !== null) {
    const existing = await readAttribution(context, benchmarkId);
    if (
      existing === 'invalid' ||
      (existing !== 'absent' &&
        (existing.candidateId !== candidateId ||
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

  const existing = await readAttribution(context, result.data.capture.benchmarkId);
  if (existing !== 'absent') return result;

  const written = await writeAttribution(context, {
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    benchmarkId: result.data.capture.benchmarkId,
    candidateId,
    projectId: result.data.capture.projectId,
  });
  if (written) return result;

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

  const entries = new Map<OptimizationCandidateId, TaskBenchmarkMatrixEntry[]>(
    CANDIDATES.map((candidate) => [candidate, []]),
  );
  const diagnostics: Diagnostic[] = [...result.diagnostics];
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;

  for (const entry of result.data.entries) {
    const attribution = await readAttribution(context, entry.benchmarkId);
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
    entries.get(attribution.candidateId)?.push(entry);
  }

  return {
    ...result,
    data: {
      ...result.data,
      candidateEvidence: CANDIDATES.map((candidate) =>
        summarizeCandidateBenchmarkEntries(candidate, entries.get(candidate) ?? []),
      ),
    },
    diagnostics,
  };
}
