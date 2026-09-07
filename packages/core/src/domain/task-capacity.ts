import { comparableQuotaDeltas, type TaskBenchmarkReceipt } from './benchmark.js';
import type { BudgetReport, UsageWindowScope } from './budget.js';
import type { HarnessId } from './ids.js';
import { assessWindowPace, type TaskClass } from './optimizer.js';

/**
 * Conservative project-local estimate of how many quality-passed tasks fit in observed allowance.
 *
 * This module never compares raw provider percentages and never converts local tokens into quota.
 * It normalizes each harness independently by dividing its own safe remaining allowance by its own
 * empirical backend quota cost for accepted tasks of the same class.
 */

export const ACCEPTED_TASK_CAPACITY_MIN_SAMPLES = 3;
export const ACCEPTED_TASK_CAPACITY_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
export const ACCEPTED_TASK_CAPACITY_RESERVE_PERCENT = 20;

type CapacityScope = Extract<UsageWindowScope, 'five-hour' | 'weekly'>;

export interface AcceptedTaskCapacityWindow {
  scope: CapacityScope;
  sampleCount: number;
  /** Conservative nearest-rank p75 backend cost of one quality-passed task. */
  p75UsedPercentPerAcceptedTask: number | null;
  /** Remaining observed allowance after the same reserve used by cross-harness pacing. */
  spendableRemainingPercent: number | null;
  /** Fractional task equivalents; callers that need guaranteed whole tasks should floor it. */
  taskEquivalents: number | null;
}

export interface AcceptedTaskCapacityEstimate {
  harnessId: HarnessId;
  taskClass: TaskClass;
  status: 'estimated' | 'insufficient-evidence';
  /** Conservative whole accepted-task equivalents constrained by both five-hour and weekly limits. */
  acceptedTasksRemaining: number | null;
  eligibleReceipts: number;
  fiveHour: AcceptedTaskCapacityWindow;
  weekly: AcceptedTaskCapacityWindow;
  reasons: string[];
}

function p75(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[index] ?? null;
}

function recentQualityPassedReceipts(input: {
  receipts: readonly TaskBenchmarkReceipt[];
  harnessId: HarnessId;
  taskClass: TaskClass;
  observedAt: string;
  maxAgeMs: number;
}): TaskBenchmarkReceipt[] {
  const now = Date.parse(input.observedAt);
  if (!Number.isFinite(now)) return [];
  return input.receipts.filter((receipt) => {
    if (
      receipt.harnessId !== input.harnessId ||
      receipt.taskClass !== input.taskClass ||
      receipt.outcome.qualityGate !== 'passed'
    ) {
      return false;
    }
    const completed = Date.parse(receipt.completedAt);
    return (
      Number.isFinite(completed) &&
      completed <= now + 60_000 &&
      now - completed >= 0 &&
      now - completed <= input.maxAgeMs
    );
  });
}

function quotaCosts(
  receipts: readonly TaskBenchmarkReceipt[],
  scope: CapacityScope,
): number[] {
  const costs: number[] = [];
  for (const receipt of receipts) {
    const matches = comparableQuotaDeltas(receipt).filter((delta) => delta.scope === scope);
    // Ambiguous/missing windows and zero movement are deliberately not promoted into a "free task".
    if (matches.length !== 1) continue;
    const delta = matches[0]?.usedPercentDelta;
    if (delta !== undefined && Number.isFinite(delta) && delta > 0) costs.push(delta);
  }
  return costs;
}

function liveSpendable(input: {
  report: BudgetReport;
  harnessId: HarnessId;
  scope: CapacityScope;
  reservePercent: number;
}): number | null {
  const observations = input.report.harnesses.filter(
    (observation) => observation.harnessId === input.harnessId,
  );
  if (observations.length !== 1 || observations[0]?.state !== 'observed') return null;
  const windows = observations[0].windows.filter(
    (window) => window.harnessId === input.harnessId && window.scope === input.scope,
  );
  if (windows.length !== 1) return null;
  const assessment = assessWindowPace(
    windows[0]!,
    input.report.observedAt,
    input.reservePercent,
  );
  return assessment.state === 'unknown' ? null : assessment.spendableRemainingPercent ?? null;
}

function estimateScope(input: {
  report: BudgetReport;
  harnessId: HarnessId;
  scope: CapacityScope;
  receipts: readonly TaskBenchmarkReceipt[];
  reservePercent: number;
  minSamples: number;
}): AcceptedTaskCapacityWindow {
  const costs = quotaCosts(input.receipts, input.scope);
  const cost = costs.length >= input.minSamples ? p75(costs) : null;
  const spendable = liveSpendable({
    report: input.report,
    harnessId: input.harnessId,
    scope: input.scope,
    reservePercent: input.reservePercent,
  });
  return {
    scope: input.scope,
    sampleCount: costs.length,
    p75UsedPercentPerAcceptedTask: cost,
    spendableRemainingPercent: spendable,
    taskEquivalents:
      cost !== null && cost > 0 && spendable !== null ? spendable / cost : null,
  };
}

export function estimateAcceptedTaskCapacity(input: {
  report: BudgetReport;
  receipts: readonly TaskBenchmarkReceipt[];
  harnessId: HarnessId;
  taskClass: TaskClass;
  reservePercent?: number;
  minSamples?: number;
  maxAgeMs?: number;
}): AcceptedTaskCapacityEstimate {
  const reservePercent = input.reservePercent ?? ACCEPTED_TASK_CAPACITY_RESERVE_PERCENT;
  const minSamples = input.minSamples ?? ACCEPTED_TASK_CAPACITY_MIN_SAMPLES;
  const maxAgeMs = input.maxAgeMs ?? ACCEPTED_TASK_CAPACITY_MAX_AGE_MS;
  const eligible = recentQualityPassedReceipts({
    receipts: input.receipts,
    harnessId: input.harnessId,
    taskClass: input.taskClass,
    observedAt: input.report.observedAt,
    maxAgeMs,
  });
  const fiveHour = estimateScope({
    report: input.report,
    harnessId: input.harnessId,
    scope: 'five-hour',
    receipts: eligible,
    reservePercent,
    minSamples,
  });
  const weekly = estimateScope({
    report: input.report,
    harnessId: input.harnessId,
    scope: 'weekly',
    receipts: eligible,
    reservePercent,
    minSamples,
  });
  const reasons: string[] = [];
  for (const estimate of [fiveHour, weekly]) {
    if (estimate.sampleCount < minSamples) {
      reasons.push(
        `${estimate.scope}: ${String(estimate.sampleCount)} positive comparable quota samples; ${String(minSamples)} required`,
      );
    } else if (estimate.spendableRemainingPercent === null) {
      reasons.push(`${estimate.scope}: fresh unambiguous live allowance is unavailable`);
    }
  }
  if (fiveHour.taskEquivalents === null || weekly.taskEquivalents === null) {
    return {
      harnessId: input.harnessId,
      taskClass: input.taskClass,
      status: 'insufficient-evidence',
      acceptedTasksRemaining: null,
      eligibleReceipts: eligible.length,
      fiveHour,
      weekly,
      reasons,
    };
  }
  const acceptedTasksRemaining = Math.max(
    0,
    Math.floor(Math.min(fiveHour.taskEquivalents, weekly.taskEquivalents)),
  );
  return {
    harnessId: input.harnessId,
    taskClass: input.taskClass,
    status: 'estimated',
    acceptedTasksRemaining,
    eligibleReceipts: eligible.length,
    fiveHour,
    weekly,
    reasons: [
      'capacity is the minimum of independently normalized five-hour and weekly accepted-task equivalents',
    ],
  };
}
