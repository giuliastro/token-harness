import { compareTaskBenchmarkReceipts, type TaskBenchmarkMatrixPair } from './benchmark.js';
import { compareTaskBenchmarkReceiptContexts } from './benchmark-context-report.js';
import type { HarnessId } from './ids.js';
import type { TaskClass } from './optimizer.js';

export type ContextOwnerAdmissionState = 'admitted' | 'insufficient-evidence' | 'rejected';

export interface ContextOwnerAdmissionDecision {
  state: ContextOwnerAdmissionState;
  harnessId: HarnessId | null;
  taskClass: TaskClass | null;
  qualifyingPairs: number;
  consideredPairs: number;
  minimumPairs: number;
  reasons: string[];
}

export interface ContextOwnerAdmissionOptions {
  now?: string;
  maxAgeDays?: number;
  minimumPairs?: number;
}

const DEFAULT_MAX_AGE_DAYS = 14;
const DEFAULT_MINIMUM_PAIRS = 3;

function finitePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function validNow(value: string | undefined): number {
  if (value === undefined) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Decide whether repeated task evidence is strong enough to admit a broad context owner to an
 * experimental integration. Admission is deliberately stricter than a single benchmark win.
 */
export function assessContextOwnerAdmission(
  pairs: readonly TaskBenchmarkMatrixPair[],
  options: ContextOwnerAdmissionOptions = {},
): ContextOwnerAdmissionDecision {
  const minimumPairs = finitePositiveInteger(options.minimumPairs, DEFAULT_MINIMUM_PAIRS);
  const maxAgeDays = finitePositiveInteger(options.maxAgeDays, DEFAULT_MAX_AGE_DAYS);
  const now = validNow(options.now);
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  if (pairs.length === 0) {
    return {
      state: 'insufficient-evidence',
      harnessId: null,
      taskClass: null,
      qualifyingPairs: 0,
      consideredPairs: 0,
      minimumPairs,
      reasons: ['no paired task benchmarks were supplied'],
    };
  }

  const identity = pairs[0];
  if (identity === undefined) {
    throw new TypeError('non-empty benchmark pair array unexpectedly had no first element');
  }
  const harnessId = identity.baseline.harnessId;
  const taskClass = identity.baseline.taskClass;
  const reasons: string[] = [];
  let qualifyingPairs = 0;
  let consideredPairs = 0;

  for (const pair of pairs) {
    if (
      pair.baseline.harnessId !== harnessId ||
      pair.optimized.harnessId !== harnessId ||
      pair.baseline.taskClass !== taskClass ||
      pair.optimized.taskClass !== taskClass
    ) {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: ['context-owner evidence must not mix harnesses or task classes'],
      };
    }

    const completedAt = Math.max(
      Date.parse(pair.baseline.completedAt),
      Date.parse(pair.optimized.completedAt),
    );
    if (!Number.isFinite(completedAt) || completedAt < cutoff || completedAt > now) continue;
    consideredPairs += 1;

    if (
      pair.baseline.outcome.qualityGate !== 'passed' ||
      pair.optimized.outcome.qualityGate !== 'passed'
    ) {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: ['a recent candidate pair did not preserve the explicit quality gate'],
      };
    }

    if (
      pair.optimized.outcome.failedAttempts > pair.baseline.outcome.failedAttempts ||
      pair.optimized.outcome.attempts > pair.baseline.outcome.attempts ||
      pair.optimized.outcome.errorCodes.length > pair.baseline.outcome.errorCodes.length
    ) {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: ['a recent candidate pair regressed retries, attempts, or runtime/provider errors'],
      };
    }

    const historical = compareTaskBenchmarkReceipts(pair.baseline, pair.optimized);
    if (historical.verdict === 'baseline-better' || historical.verdict === 'incomparable') {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: [
          `a recent paired benchmark rejected the candidate on ${historical.basis} evidence`,
        ],
      };
    }

    if (
      historical.quota !== null &&
      historical.quota.optimizedDeltaUsedPercent > historical.quota.baselineDeltaUsedPercent
    ) {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: ['a recent candidate pair consumed more comparable backend subscription quota'],
      };
    }

    const context = compareTaskBenchmarkReceiptContexts(pair.baseline, pair.optimized);
    if (context.verdict === 'increased') {
      return {
        state: 'rejected',
        harnessId,
        taskClass,
        qualifyingPairs,
        consideredPairs,
        minimumPairs,
        reasons: ['a recent candidate pair increased stable context exposure'],
      };
    }
    if (context.verdict !== 'reduced') {
      reasons.push(`benchmark ${pair.baseline.benchmarkId} did not prove context reduction`);
      continue;
    }

    qualifyingPairs += 1;
  }

  if (qualifyingPairs < minimumPairs) {
    return {
      state: 'insufficient-evidence',
      harnessId,
      taskClass,
      qualifyingPairs,
      consideredPairs,
      minimumPairs,
      reasons: [
        ...reasons,
        `need at least ${String(minimumPairs)} recent quality-safe context-reducing pairs`,
      ],
    };
  }

  return {
    state: 'admitted',
    harnessId,
    taskClass,
    qualifyingPairs,
    consideredPairs,
    minimumPairs,
    reasons: [
      `${String(qualifyingPairs)} recent pairs reduced stable context without quality, retry, error, or allowance regression`,
      'admission authorizes experimental evaluation only; it does not make the context owner a default',
    ],
  };
}
