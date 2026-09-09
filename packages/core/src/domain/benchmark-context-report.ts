/**
 * Context-savings reporting layered on top of the existing quality/quota benchmark verdict.
 *
 * This module deliberately does not alter `compareTaskBenchmarkReceipts`. Context is a parallel
 * evidence class: first prove each variant's context surface stayed stable across the task, then
 * compare baseline versus optimized. A mid-task configuration change is not attributable evidence.
 */

import {
  compareTaskBenchmarkContextSnapshots,
  type TaskBenchmarkContextComparison,
  type TaskBenchmarkContextSnapshot,
} from './benchmark-context.js';
import type {
  TaskBenchmarkCompareReport,
  TaskBenchmarkMatrixEntry,
  TaskBenchmarkMatrixPair,
  TaskBenchmarkMatrixReport,
  TaskBenchmarkReceipt,
} from './benchmark.js';
import type { TaskClass } from './optimizer.js';

export interface TaskBenchmarkContextCompareReport extends TaskBenchmarkCompareReport {
  context: TaskBenchmarkContextComparison;
}

export interface TaskBenchmarkContextMatrixEntry extends TaskBenchmarkMatrixEntry {
  context: TaskBenchmarkContextComparison;
}

export interface TaskBenchmarkContextMatrixSummary {
  taskClass: TaskClass | null;
  pairs: number;
  reduced: number;
  same: number;
  increased: number;
  unknown: number;
}

export interface TaskBenchmarkContextMatrixReport
  extends Omit<TaskBenchmarkMatrixReport, 'entries'> {
  entries: TaskBenchmarkContextMatrixEntry[];
  context: {
    byTaskClass: TaskBenchmarkContextMatrixSummary[];
    overall: TaskBenchmarkContextMatrixSummary;
  };
}

interface StableContextWitness {
  snapshot: TaskBenchmarkContextSnapshot | null;
  reason: string | null;
}

function stableContextWitness(receipt: TaskBenchmarkReceipt): StableContextWitness {
  const start = receipt.contextAtStart ?? null;
  const finish = receipt.contextAtFinish ?? null;
  if (start === null || finish === null) {
    return {
      snapshot: null,
      reason: `${receipt.variant} receipt is missing start/finish context evidence`,
    };
  }

  const withinVariant = compareTaskBenchmarkContextSnapshots(start, finish);
  if (withinVariant.verdict !== 'same') {
    return {
      snapshot: null,
      reason:
        withinVariant.verdict === 'unknown'
          ? `${receipt.variant} context evidence is incomplete, so task-time stability is unknown`
          : `${receipt.variant} context exposure changed during the task, so the surface is not attributable to one stable configuration`,
    };
  }

  return { snapshot: start, reason: null };
}

/**
 * Compare the context surface used by a paired task without changing the pair's quality/quota
 * verdict. Both variants must pass quality and remain context-stable from start to finish.
 */
export function compareTaskBenchmarkReceiptContexts(
  baseline: TaskBenchmarkReceipt,
  optimized: TaskBenchmarkReceipt,
): TaskBenchmarkContextComparison {
  if (
    baseline.benchmarkId !== optimized.benchmarkId ||
    baseline.taskClass !== optimized.taskClass ||
    baseline.harnessId !== optimized.harnessId ||
    baseline.variant !== 'baseline' ||
    optimized.variant !== 'optimized'
  ) {
    return {
      verdict: 'unknown',
      baseline: baseline.contextAtStart ?? null,
      optimized: optimized.contextAtStart ?? null,
      reason: 'receipts are not a comparable same-harness baseline/optimized task pair',
    };
  }

  if (baseline.outcome.qualityGate !== 'passed' || optimized.outcome.qualityGate !== 'passed') {
    return {
      verdict: 'unknown',
      baseline: baseline.contextAtStart ?? null,
      optimized: optimized.contextAtStart ?? null,
      reason: 'both variants must pass quality before context saving can be credited',
    };
  }

  const stableBaseline = stableContextWitness(baseline);
  const stableOptimized = stableContextWitness(optimized);
  if (stableBaseline.snapshot === null || stableOptimized.snapshot === null) {
    return {
      verdict: 'unknown',
      baseline: stableBaseline.snapshot,
      optimized: stableOptimized.snapshot,
      reason:
        stableBaseline.reason ??
        stableOptimized.reason ??
        'context stability could not be established',
    };
  }

  return compareTaskBenchmarkContextSnapshots(stableBaseline.snapshot, stableOptimized.snapshot);
}

export function addContextToTaskBenchmarkCompareReport(
  report: TaskBenchmarkCompareReport,
): TaskBenchmarkContextCompareReport {
  return {
    ...report,
    context: compareTaskBenchmarkReceiptContexts(report.baseline, report.optimized),
  };
}

function summarizeContext(
  entries: readonly TaskBenchmarkContextMatrixEntry[],
  taskClass: TaskClass | null,
): TaskBenchmarkContextMatrixSummary {
  return {
    taskClass,
    pairs: entries.length,
    reduced: entries.filter((entry) => entry.context.verdict === 'reduced').length,
    same: entries.filter((entry) => entry.context.verdict === 'same').length,
    increased: entries.filter((entry) => entry.context.verdict === 'increased').length,
    unknown: entries.filter((entry) => entry.context.verdict === 'unknown').length,
  };
}

/** Decorate the existing matrix without changing any historical quality/quota/local-token fields. */
export function addContextToTaskBenchmarkMatrixReport(
  report: TaskBenchmarkMatrixReport,
  pairs: readonly TaskBenchmarkMatrixPair[],
): TaskBenchmarkContextMatrixReport {
  const pairById = new Map(pairs.map((pair) => [pair.baseline.benchmarkId, pair]));
  const entries: TaskBenchmarkContextMatrixEntry[] = report.entries.map((entry) => {
    const pair = pairById.get(entry.benchmarkId);
    return {
      ...entry,
      context:
        pair === undefined
          ? {
              verdict: 'unknown',
              baseline: null,
              optimized: null,
              reason: 'the matrix entry has no matching paired receipt context',
            }
          : compareTaskBenchmarkReceiptContexts(pair.baseline, pair.optimized),
    };
  });

  const classes = [...new Set(entries.map((entry) => entry.taskClass))];
  return {
    ...report,
    entries,
    context: {
      byTaskClass: classes.map((taskClass) =>
        summarizeContext(
          entries.filter((entry) => entry.taskClass === taskClass),
          taskClass,
        ),
      ),
      overall: summarizeContext(entries, null),
    },
  };
}
