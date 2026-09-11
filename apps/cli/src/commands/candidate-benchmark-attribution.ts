/** Shared candidate-benchmark attribution sidecar helpers. */
import type { OptimizationCandidateId } from '@token-harness/core';

import type { CommandContext } from './context.js';

export const CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION = 1;
export const OPTIMIZATION_CANDIDATES: readonly OptimizationCandidateId[] = [
  'headroom',
  'mcptoon',
  'gitnexus',
];

const CANDIDATE_SET = new Set<string>(OPTIMIZATION_CANDIDATES);

export interface CandidateBenchmarkAttribution {
  schemaVersion: typeof CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION;
  benchmarkId: string;
  candidateId: OptimizationCandidateId;
  projectId: string;
}

export function candidateBenchmarkAttributionPath(
  context: CommandContext,
  benchmarkId: string,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, 'candidate.json');
}

export function parseCandidateBenchmarkAttribution(
  value: unknown,
): CandidateBenchmarkAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row['schemaVersion'] !== CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION ||
    typeof row['benchmarkId'] !== 'string' ||
    typeof row['candidateId'] !== 'string' ||
    !CANDIDATE_SET.has(row['candidateId']) ||
    typeof row['projectId'] !== 'string' ||
    row['projectId'] === ''
  ) {
    return null;
  }

  return {
    schemaVersion: CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION,
    benchmarkId: row['benchmarkId'],
    candidateId: row['candidateId'] as OptimizationCandidateId,
    projectId: row['projectId'],
  };
}

export async function readCandidateBenchmarkAttribution(
  context: CommandContext,
  benchmarkId: string,
): Promise<'absent' | 'invalid' | CandidateBenchmarkAttribution> {
  const path = candidateBenchmarkAttributionPath(context, benchmarkId);
  if (path === null || context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';

  try {
    const raw = JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
    return parseCandidateBenchmarkAttribution(raw) ?? 'invalid';
  } catch {
    return 'invalid';
  }
}

export async function writeCandidateBenchmarkAttribution(
  context: CommandContext,
  value: CandidateBenchmarkAttribution,
): Promise<boolean> {
  const path = candidateBenchmarkAttributionPath(context, value.benchmarkId);
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
