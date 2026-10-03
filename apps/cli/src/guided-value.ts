import type {
  OptimizationCandidateId,
  TaskBenchmarkContextMatrixReport,
} from '@token-harness/core';

export type GuideAllowanceEvidenceState = 'not-measured' | 'measured' | 'blocked-by-quality';
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

export interface GuideRoutingSavingsEvidence {
  state: 'not-measured' | 'measured' | 'blocked-by-quality';
  pairs: number;
  qualityBlockedPairs: number;
  localPairs: number;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  savedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
  allowance5h: GuideAllowanceEvidence;
  allowance7d: GuideAllowanceEvidence;
  reportedChildModels: string[];
  basis: string;
}

export interface GuideCandidateBenchmarkEvidence {
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

export interface GuideValueEvidence {
  source: 'benchmark-matrix' | 'unavailable';
  allowance5h: GuideAllowanceEvidence;
  allowance7d: GuideAllowanceEvidence;
  quality: GuideQualityEvidence;
  routing: GuideRoutingSavingsEvidence;
  candidates: GuideCandidateBenchmarkEvidence[];
  apiCost: {
    state: 'not-measured';
    estimatedUsd: null;
    estimatedEur: null;
  };
  basis: string;
}

type MatrixEntry = TaskBenchmarkContextMatrixReport['entries'][number];
type CandidateAwareMatrix = TaskBenchmarkContextMatrixReport & {
  candidateEvidence?: GuideCandidateBenchmarkEvidence[];
};

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
  const blocked = savedPercent !== null && savedPercent > 0 && quality.state !== 'preserved';

  return {
    state: savedPercent === null ? 'not-measured' : blocked ? 'blocked-by-quality' : 'measured',
    scope,
    savedPercent,
    equivalentMinutes:
      scope === 'five-hour' && savedPercent !== null ? roundOne(savedPercent * 3) : null,
    pairs: deltas.length,
  };
}

function routedAllowanceEvidence(
  entries: readonly MatrixEntry[],
  scope: GuideAllowanceEvidence['scope'],
): GuideAllowanceEvidence {
  const deltas = entries.flatMap((entry) => {
    const quota = entry.quota;
    if (quota === null || quota.scope !== scope || quota.confidence !== 'authoritative') return [];
    return [quota.baselineDeltaUsedPercent - quota.optimizedDeltaUsedPercent];
  });
  const savedPercent = median(deltas);
  return {
    state: savedPercent === null ? 'not-measured' : 'measured',
    scope,
    savedPercent: savedPercent === null ? null : roundOne(savedPercent),
    equivalentMinutes:
      scope === 'five-hour' && savedPercent !== null ? roundOne(savedPercent * 3) : null,
    pairs: deltas.length,
  };
}

function routingEvidence(entries: readonly MatrixEntry[]): GuideRoutingSavingsEvidence {
  const routed = entries.filter((entry) => entry.nativeRouting?.verdict === 'attributed');
  const eligible = routed.filter((entry) => entry.nativeRouting?.qualityGatesPassed === true);
  const local = eligible.filter(
    (entry) => entry.baselineLocalTokens !== null && entry.optimizedLocalTokens !== null,
  );
  const baselineLocalTokens = local.length
    ? local.reduce((total, entry) => total + (entry.baselineLocalTokens ?? 0), 0)
    : null;
  const optimizedLocalTokens = local.length
    ? local.reduce((total, entry) => total + (entry.optimizedLocalTokens ?? 0), 0)
    : null;
  const savedLocalTokens =
    baselineLocalTokens === null || optimizedLocalTokens === null
      ? null
      : baselineLocalTokens - optimizedLocalTokens;
  const localTokenSavingPercent =
    baselineLocalTokens === null || optimizedLocalTokens === null || baselineLocalTokens <= 0
      ? null
      : roundOne((savedLocalTokens! / baselineLocalTokens) * 100);
  const qualityBlockedPairs = routed.length - eligible.length;
  return {
    state:
      routed.length === 0
        ? 'not-measured'
        : eligible.length === 0
          ? 'blocked-by-quality'
          : 'measured',
    pairs: eligible.length,
    qualityBlockedPairs,
    localPairs: local.length,
    baselineLocalTokens,
    optimizedLocalTokens,
    savedLocalTokens,
    localTokenSavingPercent,
    allowance5h: routedAllowanceEvidence(eligible, 'five-hour'),
    allowance7d: routedAllowanceEvidence(eligible, 'weekly'),
    reportedChildModels: [
      ...new Set(eligible.flatMap((entry) => entry.nativeRouting?.optimizedReportedModels ?? [])),
    ],
    basis:
      routed.length === 0
        ? 'No paired benchmark currently proves that a native prompt hook ran and started a subagent.'
        : eligible.length === 0
          ? 'Routing callbacks were observed, but all attributed pairs failed the quality gate; no savings are credited.'
          : local.length > 0 ||
              eligible.some((entry) => entry.quota?.confidence === 'authoritative')
            ? 'Exact local token counts and authoritative quota deltas are reported in separate units, only for attributed pairs that passed both quality gates.'
            : 'Routing was observed and both quality gates passed, but local token or authoritative quota usage was unavailable; no savings amount is inferred.',
  };
}

/**
 * Project the existing paired benchmark matrix into user-facing value evidence.
 *
 * Backend quota is never summed across tasks, windows or resets. We expose the median percentage
 * delta only from authoritative paired quota evidence. Positive allowance value is not promoted
 * until paired quality evidence is also present and free of regressions. Candidate-attributed
 * summaries remain separate from the overall value result and never imply candidate activation.
 * API money remains unavailable until billed-token evidence and a verified price basis exist.
 */
export function guidedValueEvidence(report: CandidateAwareMatrix | null): GuideValueEvidence {
  const entries = report?.entries ?? [];
  const quality = qualityEvidence(entries);
  return {
    source: entries.length > 0 ? 'benchmark-matrix' : 'unavailable',
    allowance5h: allowanceEvidence(entries, 'five-hour', quality),
    allowance7d: allowanceEvidence(entries, 'weekly', quality),
    quality,
    routing: routingEvidence(entries),
    candidates: (report?.candidateEvidence ?? []).map((item) => ({ ...item })),
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
