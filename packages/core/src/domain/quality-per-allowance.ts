import type { EffortLearningDecision } from './outcome-learning.js';
import { effortRank, taskEffortFloor, type RecommendationEvidence, type TaskClass } from './optimizer.js';
import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';

/**
 * Quality-first refinement of a learned reasoning-effort change using same-harness allowance cost.
 *
 * A cheaper effort may win only after outcome learning has already proven no quality/retry
 * regression. A more expensive effort may win for quality recovery, but a measured zero-task
 * capacity vetoes spending allowance that cannot safely finish even one accepted task.
 */
export interface QualityPerAllowanceDecision {
  state:
    | 'unavailable'
    | 'kept'
    | 'allowance-efficient'
    | 'quality-recovery'
    | 'capacity-unproven'
    | 'deferred';
  baseEffort: string | null;
  candidateEffort: string | null;
  recommendedEffort: string | null;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
  reasons: RecommendationEvidence[];
}

function estimated(estimate: AcceptedTaskCapacityEstimate | null): boolean {
  return estimate?.status === 'estimated';
}

function p75Costs(estimate: AcceptedTaskCapacityEstimate): [number, number] | null {
  const fiveHour = estimate.fiveHour.p75UsedPercentPerAcceptedTask;
  const weekly = estimate.weekly.p75UsedPercentPerAcceptedTask;
  return fiveHour !== null && weekly !== null ? [fiveHour, weekly] : null;
}

function result(
  input: Omit<QualityPerAllowanceDecision, 'reasons'>,
  code: string,
  summary: string,
): QualityPerAllowanceDecision {
  return { ...input, reasons: [{ code, summary }] };
}

export function refineEffortForAllowance(input: {
  taskClass: TaskClass;
  learning: EffortLearningDecision;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
}): QualityPerAllowanceDecision {
  const base = {
    baseEffort: input.learning.baseEffort,
    candidateEffort: input.learning.candidateEffort,
    recommendedEffort: input.learning.recommendedEffort,
    baseCapacity: input.baseCapacity,
    candidateCapacity: input.candidateCapacity,
  };

  if (
    input.learning.state !== 'learned' ||
    input.learning.baseEffort === null ||
    input.learning.candidateEffort === null ||
    input.learning.recommendedEffort === null
  ) {
    return result(
      { ...base, state: 'unavailable' },
      'quality-per-allowance-no-learned-alternative',
      'No learned alternative effort is eligible for allowance refinement',
    );
  }

  const baseRank = effortRank(input.learning.baseEffort);
  const candidateRank = effortRank(input.learning.candidateEffort);
  const floorRank = effortRank(taskEffortFloor(input.taskClass));
  if (
    baseRank === null ||
    candidateRank === null ||
    floorRank === null ||
    candidateRank < floorRank
  ) {
    return result(
      { ...base, state: 'unavailable', recommendedEffort: input.learning.baseEffort },
      'quality-per-allowance-policy-unranked',
      'The learned alternative cannot be safely ranked against the task quality floor',
    );
  }

  if (candidateRank > baseRank) {
    if (
      estimated(input.candidateCapacity) &&
      input.candidateCapacity?.acceptedTasksRemaining === 0
    ) {
      return result(
        { ...base, state: 'deferred', recommendedEffort: null },
        'quality-recovery-no-capacity',
        'Quality outcomes support more reasoning, but safe observed allowance is below one accepted-task equivalent; checkpoint or switch harness first',
      );
    }
    return result(
      {
        ...base,
        state: estimated(input.candidateCapacity) ? 'quality-recovery' : 'capacity-unproven',
        recommendedEffort: input.learning.candidateEffort,
      },
      estimated(input.candidateCapacity)
        ? 'quality-recovery-with-capacity'
        : 'quality-recovery-capacity-unproven',
      estimated(input.candidateCapacity)
        ? 'Repeated quality/retry outcomes support the higher effort and observed safe allowance can still complete at least one accepted task'
        : 'Repeated quality/retry outcomes support the higher effort; exact policy capacity is not yet measured, so no throughput claim is made',
    );
  }

  if (!estimated(input.baseCapacity) || !estimated(input.candidateCapacity)) {
    return result(
      { ...base, state: 'capacity-unproven', recommendedEffort: input.learning.candidateEffort },
      'allowance-capacity-unproven',
      'Outcome learning supports the lower effort, but exact-policy five-hour/weekly capacity is not complete enough to claim additional subscription throughput',
    );
  }

  const baseCosts = p75Costs(input.baseCapacity!);
  const candidateCosts = p75Costs(input.candidateCapacity!);
  if (baseCosts === null || candidateCosts === null) {
    return result(
      { ...base, state: 'capacity-unproven', recommendedEffort: input.learning.candidateEffort },
      'allowance-cost-unproven',
      'Outcome learning supports the lower effort, but exact-policy backend quota cost is incomplete',
    );
  }

  const nonWorse = candidateCosts.every((cost, index) => cost <= baseCosts[index]!);
  const improved = candidateCosts.some((cost, index) => cost < baseCosts[index]!);
  if (!nonWorse || !improved) {
    return result(
      { ...base, state: 'kept', recommendedEffort: input.learning.baseEffort },
      'allowance-no-throughput-gain',
      'The lower effort passed outcome gates but does not reduce conservative p75 backend quota cost across both included allowance windows',
    );
  }

  return result(
    { ...base, state: 'allowance-efficient', recommendedEffort: input.learning.candidateEffort },
    'allowance-throughput-improved',
    'The quality-gated lower effort has non-worse p75 quota cost in both included windows and improves at least one, increasing accepted-task throughput without a measured quality/retry regression',
  );
}
