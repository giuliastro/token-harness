import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';
import type { ModelLearningDecision } from './model-learning.js';
import type { RecommendationEvidence, TaskClass } from './optimizer.js';

export interface ModelQualityPerAllowanceDecision {
  state:
    | 'unavailable'
    | 'kept'
    | 'allowance-efficient'
    | 'quality-recovery'
    | 'capacity-unproven'
    | 'deferred';
  baseModel: string | null;
  candidateModel: string | null;
  recommendedModel: string | null;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
  reasons: RecommendationEvidence[];
}

function evidence(code: string, summary: string): RecommendationEvidence {
  return { code, summary };
}

function matchesCapacity(
  estimate: AcceptedTaskCapacityEstimate | null,
  input: { taskClass: TaskClass; model: string | null; reasoningEffort: string | null; verbosity: string | null },
): boolean {
  if (estimate === null) return true;
  return (
    estimate.taskClass === input.taskClass &&
    estimate.policy !== undefined &&
    estimate.policy.model === input.model &&
    estimate.policy.reasoningEffort === input.reasoningEffort &&
    estimate.policy.verbosity === input.verbosity
  );
}

function complete(estimate: AcceptedTaskCapacityEstimate | null): estimate is AcceptedTaskCapacityEstimate {
  return (
    estimate !== null &&
    estimate.status === 'estimated' &&
    estimate.acceptedTasksRemaining !== null &&
    estimate.fiveHour.p75UsedPercentPerAcceptedTask !== null &&
    estimate.weekly.p75UsedPercentPerAcceptedTask !== null
  );
}

/**
 * Convert one outcome-safe model candidate into an actionable recommendation only when the native
 * subscription evidence justifies it. Raw model names, local tokens and cross-provider percentages
 * are never used as model-tier or quota proxies.
 */
export function refineModelForAllowance(input: {
  taskClass: TaskClass;
  learning: ModelLearningDecision;
  baseCapacity: AcceptedTaskCapacityEstimate | null;
  candidateCapacity: AcceptedTaskCapacityEstimate | null;
}): ModelQualityPerAllowanceDecision {
  const result: ModelQualityPerAllowanceDecision = {
    state: 'unavailable',
    baseModel: input.learning.baseModel,
    candidateModel: input.learning.candidateModel,
    recommendedModel: input.learning.baseModel,
    baseCapacity: input.baseCapacity,
    candidateCapacity: input.candidateCapacity,
    reasons: [],
  };

  if (
    input.learning.state !== 'learned' ||
    input.learning.baseModel === null ||
    input.learning.candidateModel === null ||
    input.learning.intent === null
  ) {
    result.reasons.push(
      evidence(
        'model-quality-per-allowance-no-learned-alternative',
        'No outcome-safe model alternative is ready for allowance evaluation',
      ),
    );
    return result;
  }

  const identity = {
    taskClass: input.taskClass,
    reasoningEffort: input.learning.policy.reasoningEffort,
    verbosity: input.learning.policy.verbosity,
  };
  if (
    !matchesCapacity(input.baseCapacity, { ...identity, model: input.learning.baseModel }) ||
    !matchesCapacity(input.candidateCapacity, { ...identity, model: input.learning.candidateModel })
  ) {
    result.state = 'kept';
    result.reasons.push(
      evidence(
        'model-capacity-policy-mismatch',
        'Exact-policy capacity does not match the model, effort, verbosity and task class under evaluation',
      ),
    );
    return result;
  }

  if (!complete(input.candidateCapacity)) {
    result.state = 'capacity-unproven';
    result.reasons.push(
      evidence(
        'model-capacity-unproven',
        'Keep the current model until the candidate has complete five-hour and weekly exact-policy capacity evidence',
      ),
    );
    return result;
  }

  if (input.candidateCapacity.acceptedTasksRemaining === 0) {
    result.state = 'deferred';
    result.recommendedModel = null;
    result.reasons.push(
      evidence(
        'model-candidate-no-capacity',
        'The candidate has less than one conservative accepted-task equivalent remaining; recheck after reset or switch harness instead',
      ),
    );
    return result;
  }

  if (input.learning.intent === 'quality-recovery') {
    result.state = 'quality-recovery';
    result.recommendedModel = input.learning.candidateModel;
    result.reasons.push(
      evidence(
        'model-quality-recovery-with-capacity',
        `Use ${input.learning.candidateModel} because repeated quality/retry evidence recovers the task and live allowance still fits at least one accepted task`,
      ),
    );
    return result;
  }

  if (!complete(input.baseCapacity)) {
    result.state = 'capacity-unproven';
    result.reasons.push(
      evidence(
        'model-base-capacity-unproven',
        'An efficiency-driven model switch requires complete exact-policy capacity for both current and candidate models',
      ),
    );
    return result;
  }

  const baseFive = input.baseCapacity.fiveHour.p75UsedPercentPerAcceptedTask!;
  const baseWeekly = input.baseCapacity.weekly.p75UsedPercentPerAcceptedTask!;
  const candidateFive = input.candidateCapacity.fiveHour.p75UsedPercentPerAcceptedTask!;
  const candidateWeekly = input.candidateCapacity.weekly.p75UsedPercentPerAcceptedTask!;
  const nonWorse = candidateFive <= baseFive + 1e-9 && candidateWeekly <= baseWeekly + 1e-9;
  const better = candidateFive < baseFive - 1e-9 || candidateWeekly < baseWeekly - 1e-9;

  if (!nonWorse || !better) {
    result.state = 'kept';
    result.reasons.push(
      evidence(
        'model-allowance-no-throughput-gain',
        'Keep the current model because the alternative does not improve p75 backend quota cost without worsening either five-hour or weekly allowance',
      ),
    );
    return result;
  }

  result.state = 'allowance-efficient';
  result.recommendedModel = input.learning.candidateModel;
  result.reasons.push(
    evidence(
      'model-allowance-throughput-improved',
      `Use ${input.learning.candidateModel}: quality-gated p75 backend quota cost is non-worse in both allowance windows and better in at least one`,
    ),
  );
  return result;
}
