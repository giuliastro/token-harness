import type { TaskBenchmarkContextMatrixReport } from '@token-harness/core';

export type GuideAllowanceEvidenceState =
  | 'not-measured'
  | 'measured'
  | 'blocked-by-quality';
export type GuideQualityEvidenceState = 'not-measured' | 'preserved' | 'regressed';

export interface GuideAllowanceEvidence {
  state: GuideAllowanceEvidenceState;
  scope: 'five-hour' | 'weekly';
  savedPercent: number | null;
  equivalentMinutes: number | null;
  pairs: number;
}

export interface GuideQualityEvidence {
  state: GuideQualityEvidenceState;
  pairs: number;
  regressions: number;
  improvements: number;
}

export interface GuideValueEvidence {
  source: 'benchmark-matrix' | 'unavailable';
  allowance5h: GuideAllowanceEvidence;
  allowance7d: GuideAllowanceEvidence;
  quality: GuideQualityEvidence;
  apiCost: {
    state: 'not-measured';
    estimatedUsd: null;
    estimatedEur: null;
  };
  basis: string;
}

type MatrixEntry = TaskBenchmarkContextMatrixReport['entries'][number];

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function qualityEvidence(entries: readonly MatrixEntry[]): GuideQualityEvidence {
  const regressions = entries.filter(
    (entry) => entry.basis === 'quality' && entry.verdict === 'baseline-better',
  ).length;
  const improvements = entries.filter(
    (entry) => entry.basis === 'quality' && entry.verdict === 'optimized-better',
  ).length;
  const known = entries.filter((entry) => {
    if (entry.basis === 'quality') {
      return entry.verdict === 'baseline-better' || entry.verdict === 'optimized-better';
    }
    return entry.evidenceLevel !== 'none';
  }).length;

  return {
    state: regressions > 0 ? 'regressed' : known > 0 ? 'preserved' : 'not-measured',
    pairs: known,
    regressions,
    improvements,
  };
}

function allowanceEvidence(
  entries: readonly MatrixEntry[],
  scope: GuideAllowanceEvidence['scope'],
  quality: GuideQualityEvidence,
): GuideAllowanceEvidence {
  const deltas = entries.flatMap((entry) => {
    const quota = entry.quota;
    if (quota === null || quota.scope !== scope || quota.confidence !== 'authoritative') return [];
    return [quota.baselineDeltaUsedPercent - quota.optimizedDeltaUsedPercent];
  });
  const rawMedian = median(deltas);
  const savedPercent = rawMedian === null ? null : roundOne(rawMedian);
  const blocked =
    savedPercent !== null && savedPercent > 0 && quality.state !== 'preserved';

  return {
    state: savedPercent === null ? 'not-measured' : blocked ? 'blocked-by-quality' : 'measured',
    scope,
    savedPercent,
    equivalentMinutes:
      scope === 'five-hour' && savedPercent !== null ? roundOne(savedPercent * 3) : null,
    pairs: deltas.length,
  };
}

/**
 * Project the existing paired benchmark matrix into user-facing value evidence.
 *
 * Backend quota is never summed across tasks, windows or resets. We expose the median percentage
 * delta only from authoritative paired quota evidence. Positive allowance value is not promoted
 * until paired quality evidence is also present and free of regressions. API money remains
 * unavailable until billed-token evidence and a verified price basis exist elsewhere in the
 * product.
 */
export function guidedValueEvidence(
  report: TaskBenchmarkContextMatrixReport | null,
): GuideValueEvidence {
  const entries = report?.entries ?? [];
  const quality = qualityEvidence(entries);
  return {
    source: entries.length > 0 ? 'benchmark-matrix' : 'unavailable',
    allowance5h: allowanceEvidence(entries, 'five-hour', quality),
    allowance7d: allowanceEvidence(entries, 'weekly', quality),
    quality,
    apiCost: {
      state: 'not-measured',
      estimatedUsd: null,
      estimatedEur: null,
    },
    basis:
      entries.length > 0
        ? 'Median authoritative paired quota deltas; positive savings require paired quality evidence with no regression. Quota percentages are not added across windows or resets.'
        : 'No complete paired benchmark matrix is available yet.',
  };
}
