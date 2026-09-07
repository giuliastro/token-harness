import type { RecommendationEvidence, TaskClass } from './optimizer.js';
import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';
import { verbosityRank, type VerbosityLearningDecision } from './verbosity-learning.js';

export interface VerbosityPerAllowanceDecision {
  state:
    | 'unavailable'
    | 'kept'
    | 'allowance-efficient'
    | 'quality-recovery'
    | 'capacity-unproven'
    | 'deferred';
  baseVerbosity: string | null;
  candidateVerbosity: string | null;
  recommendedVerbosity: string | null;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
  reasons: RecommendationEvidence[];
}

function estimated(estimate: AcceptedTaskCapacityEstimate | null): boolean {
  return estimate?.status === 'estimated';
}

function capacityMatchesPolicy(input: {
  estimate: AcceptedTaskCapacityEstimate | null;
  taskClass: TaskClass;
  verbosity: string;
  learning: VerbosityLearningDecision;
}): boolean {
  if (input.estimate === null) return true;
  return (
    input.estimate.taskClass === input.taskClass &&
    input.estimate.policy?.model === input.learning.policy.model &&
    input.estimate.policy?.reasoningEffort === input.learning.policy.reasoningEffort &&
    input.estimate.policy?.verbosity === input.verbosity
  );
}

function p75Costs(estimate: AcceptedTaskCapacityEstimate): [number, number] | null {
  const fiveHour = estimate.fiveHour.p75UsedPercentPerAcceptedTask;
  const weekly = estimate.weekly.p75UsedPercentPerAcceptedTask;
  return fiveHour !== null && weekly !== null ? [fiveHour, weekly] : null;
}

function result(
  input: Omit<VerbosityPerAllowanceDecision, 'reasons'>,
  code: string,
  summary: string,
): VerbosityPerAllowanceDecision {
  return { ...input, reasons: [{ code, summary }] };
}

/**
 * Turn an outcome-safe verbosity candidate into an allowance-aware recommendation.
 *
 * Lower verbosity is stricter than the effort policy: without complete exact-policy backend
 * capacity it is kept advisory and the configured verbosity remains unchanged. Higher verbosity
 * stays quality-first, but measured zero accepted-task capacity vetoes immediate escalation.
 */
export function refineVerbosityForAllowance(input: {
  taskClass: TaskClass;
  learning: VerbosityLearningDecision;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
}): VerbosityPerAllowanceDecision {
  const base = {
    baseVerbosity: input.learning.baseVerbosity,
    candidateVerbosity: input.learning.candidateVerbosity,
    recommendedVerbosity: input.learning.recommendedVerbosity,
    baseCapacity: input.baseCapacity,
    candidateCapacity: input.candidateCapacity,
  };

  if (
    input.learning.state !== 'learned' ||
    input.learning.baseVerbosity === null ||
    input.learning.candidateVerbosity === null ||
    input.learning.recommendedVerbosity === null
  ) {
    return result(
      { ...base, state: 'unavailable' },
      'verbosity-quality-per-allowance-no-learned-alternative',
      'No learned verbosity alternative is eligible for allowance refinement',
    );
  }

  if (
    !capacityMatchesPolicy({
      estimate: input.baseCapacity,
      taskClass: input.taskClass,
      verbosity: input.learning.baseVerbosity,
      learning: input.learning,
    }) ||
    !capacityMatchesPolicy({
      estimate: input.candidateCapacity,
      taskClass: input.taskClass,
      verbosity: input.learning.candidateVerbosity,
      learning: input.learning,
    }) ||
    (input.baseCapacity !== null &&
      input.candidateCapacity !== null &&
      input.baseCapacity.harnessId !== input.candidateCapacity.harnessId)
  ) {
    return result(
      { ...base, state: 'unavailable', recommendedVerbosity: input.learning.baseVerbosity },
      'verbosity-quality-per-allowance-capacity-mismatch',
      'Accepted-task capacity evidence does not match the exact learned verbosity policy',
    );
  }

  const baseRank = verbosityRank(input.learning.baseVerbosity);
  const candidateRank = verbosityRank(input.learning.candidateVerbosity);
  if (baseRank === null || candidateRank === null || candidateRank === baseRank) {
    return result(
      { ...base, state: 'unavailable', recommendedVerbosity: input.learning.baseVerbosity },
      'verbosity-quality-per-allowance-policy-unranked',
      'The learned verbosity alternative cannot be safely ranked',
    );
  }

  if (candidateRank > baseRank) {
    if (
      estimated(input.candidateCapacity) &&
      input.candidateCapacity?.acceptedTasksRemaining === 0
    ) {
      return result(
        { ...base, state: 'deferred', recommendedVerbosity: null },
        'verbosity-quality-recovery-no-capacity',
        'Quality outcomes support higher verbosity, but safe allowance is below one accepted-task equivalent; checkpoint or switch harness first',
      );
    }
    return result(
      {
        ...base,
        state: estimated(input.candidateCapacity) ? 'quality-recovery' : 'capacity-unproven',
        recommendedVerbosity: input.learning.candidateVerbosity,
      },
      estimated(input.candidateCapacity)
        ? 'verbosity-quality-recovery-with-capacity'
        : 'verbosity-quality-recovery-capacity-unproven',
      estimated(input.candidateCapacity)
        ? 'Repeated quality/retry outcomes support higher verbosity and observed safe allowance can still complete at least one accepted task'
        : 'Repeated quality/retry outcomes support higher verbosity; exact-policy capacity is unknown, so no throughput claim is made',
    );
  }

  if (!estimated(input.baseCapacity) || !estimated(input.candidateCapacity)) {
    return result(
      { ...base, state: 'kept', recommendedVerbosity: input.learning.baseVerbosity },
      'verbosity-allowance-capacity-unproven',
      'Lower verbosity passed outcome gates, but complete exact-policy five-hour and weekly backend capacity is required before changing it',
    );
  }

  const baseCosts = p75Costs(input.baseCapacity!);
  const candidateCosts = p75Costs(input.candidateCapacity!);
  if (baseCosts === null || candidateCosts === null) {
    return result(
      { ...base, state: 'kept', recommendedVerbosity: input.learning.baseVerbosity },
      'verbosity-allowance-cost-unproven',
      'Lower verbosity passed outcome gates, but exact-policy backend quota cost is incomplete',
    );
  }

  const nonWorse = candidateCosts.every((cost, index) => cost <= baseCosts[index]!);
  const improved = candidateCosts.some((cost, index) => cost < baseCosts[index]!);
  if (!nonWorse || !improved) {
    return result(
      { ...base, state: 'kept', recommendedVerbosity: input.learning.baseVerbosity },
      'verbosity-allowance-no-throughput-gain',
      'Lower verbosity passed outcome gates but does not reduce conservative p75 backend quota cost across both included allowance windows',
    );
  }

  return result(
    {
      ...base,
      state: 'allowance-efficient',
      recommendedVerbosity: input.learning.candidateVerbosity,
    },
    'verbosity-allowance-throughput-improved',
    'Lower verbosity has non-worse p75 quota cost in both included windows and improves at least one after repeated quality/retry gates passed',
  );
}
