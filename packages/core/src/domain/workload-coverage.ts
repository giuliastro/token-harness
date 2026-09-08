import type { BudgetDecision } from './budget-policy.js';
import type { RecommendationEvidence } from './optimizer.js';
import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';

/**
 * Explicit-workload allowance policy.
 *
 * `tasksRemaining` is user intent, never inferred from token history. Capacity must be an
 * exact-policy accepted-task estimate, so model/effort/verbosity samples are not mixed while
 * deciding whether the stated backlog fits the currently observed included allowance.
 */
export type WorkloadCoverageState =
  | 'unavailable'
  | 'unknown'
  | 'exhausted'
  | 'shortfall'
  | 'covered';
export type WorkloadLimitingScope = 'five-hour' | 'weekly' | 'tie';

export interface WorkloadCoverageDecision {
  state: WorkloadCoverageState;
  tasksRemaining: number | null;
  acceptedTasksRemaining: number | null;
  shortfallTasks: number | null;
  coverageRatio: number | null;
  /** Which currently observed allowance limits accepted-task capacity; no future reset is assumed. */
  limitingScope: WorkloadLimitingScope | null;
  protectCapacity: boolean;
  reasons: RecommendationEvidence[];
}

function evidence(code: string, summary: string): RecommendationEvidence {
  return { code, summary };
}

function validTarget(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function limitingScope(capacity: AcceptedTaskCapacityEstimate): WorkloadLimitingScope | null {
  const fiveHour = capacity.fiveHour.taskEquivalents;
  const weekly = capacity.weekly.taskEquivalents;
  if (
    fiveHour === null ||
    weekly === null ||
    !Number.isFinite(fiveHour) ||
    !Number.isFinite(weekly)
  ) {
    return null;
  }
  if (Math.abs(fiveHour - weekly) <= 1e-9) return 'tie';
  return fiveHour < weekly ? 'five-hour' : 'weekly';
}

function scopeSummary(scope: WorkloadLimitingScope | null): string {
  if (scope === 'five-hour') return '; the five-hour allowance is the current bottleneck';
  if (scope === 'weekly') return '; the weekly allowance is the current bottleneck';
  if (scope === 'tie') return '; five-hour and weekly allowance are equally limiting';
  return '';
}

export function assessWorkloadCoverage(input: {
  tasksRemaining: number | null;
  capacity: AcceptedTaskCapacityEstimate | null;
}): WorkloadCoverageDecision {
  const base: WorkloadCoverageDecision = {
    state: 'unavailable',
    tasksRemaining: input.tasksRemaining,
    acceptedTasksRemaining: null,
    shortfallTasks: null,
    coverageRatio: null,
    limitingScope: null,
    protectCapacity: false,
    reasons: [],
  };

  if (input.tasksRemaining === null) {
    base.reasons.push(
      evidence(
        'workload-target-absent',
        'No explicit remaining-task target was supplied; workload is not inferred from local token history',
      ),
    );
    return base;
  }
  if (!validTarget(input.tasksRemaining)) {
    base.state = 'unknown';
    base.reasons.push(
      evidence(
        'workload-target-invalid',
        'Remaining workload must be a positive whole number of accepted tasks',
      ),
    );
    return base;
  }

  const capacity = input.capacity;
  if (
    capacity === null ||
    capacity.status !== 'estimated' ||
    capacity.policy === undefined ||
    capacity.acceptedTasksRemaining === null ||
    !Number.isSafeInteger(capacity.acceptedTasksRemaining) ||
    capacity.acceptedTasksRemaining < 0
  ) {
    base.state = 'unknown';
    base.reasons.push(
      evidence(
        'workload-capacity-unproven',
        'The stated workload is advisory until the current exact model/effort/verbosity policy has complete five-hour and weekly accepted-task capacity evidence',
      ),
    );
    return base;
  }

  const available = capacity.acceptedTasksRemaining;
  const remaining = input.tasksRemaining;
  base.acceptedTasksRemaining = available;
  base.coverageRatio = available / remaining;
  base.limitingScope = limitingScope(capacity);

  if (available === 0) {
    base.state = 'exhausted';
    base.shortfallTasks = remaining;
    base.protectCapacity = true;
    base.reasons.push(
      evidence(
        'workload-capacity-exhausted',
        `The current exact policy has zero conservative accepted-task equivalents for ${String(remaining)} stated task(s)${scopeSummary(base.limitingScope)}`,
      ),
    );
    return base;
  }

  if (available < remaining) {
    base.state = 'shortfall';
    base.shortfallTasks = remaining - available;
    base.protectCapacity = true;
    base.reasons.push(
      evidence(
        'workload-capacity-shortfall',
        `The current exact policy covers ${String(available)} of ${String(remaining)} stated task(s); ${String(remaining - available)} task(s) are not covered by conservative included-allowance capacity${scopeSummary(base.limitingScope)}`,
      ),
    );
    return base;
  }

  base.state = 'covered';
  base.shortfallTasks = 0;
  base.reasons.push(
    evidence(
      'workload-capacity-covered',
      `The current exact policy has ${String(available)} conservative accepted-task equivalents for ${String(remaining)} stated task(s)${scopeSummary(base.limitingScope)}`,
    ),
  );
  return base;
}

/**
 * Workload pressure is a veto on quota-derived escalation, never a quality downgrade by itself.
 * Existing exhaustion/reset decisions remain stronger. Unknown workload evidence preserves the
 * old budget behavior exactly.
 */
export function constrainBudgetForWorkload(
  budget: BudgetDecision,
  workload: WorkloadCoverageDecision,
): BudgetDecision {
  if (!workload.protectCapacity || budget.state === 'wait-for-reset') return budget;
  if (budget.state === 'conserve') {
    return {
      ...budget,
      reasons: [...budget.reasons, ...workload.reasons],
    };
  }
  return {
    ...budget,
    state: 'conserve',
    allowEffortIncrease: false,
    reasons: [...budget.reasons, ...workload.reasons],
  };
}
