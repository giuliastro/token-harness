/**
 * Unified read-only efficiency decision -- PLAN Phase 19.1.
 *
 * This layer composes decisions already made by the budget, context, optimizer, scheduler and
 * accepted-task-capacity engines. It deliberately does not observe a harness, compare provider
 * percentages, infer model tiers, execute a task or mutate native configuration.
 */

import type { CrossHarnessSchedulerDecision } from './cross-harness-scheduler.js';
import type { HarnessId } from './ids.js';
import {
  effortRank,
  taskEffortFloor,
  type HarnessOptimizationAdvice,
  type RecommendationArea,
  type RecommendationEvidence,
  type TaskClass,
} from './optimizer.js';
import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';

export type EfficiencyHarness = 'claude' | 'codex';
export type EfficiencyContextAction =
  | 'keep'
  | 'mask'
  | 'compact'
  | 'checkpoint'
  | 'fresh-session'
  | 'unknown';

export type EfficiencyEvidenceSource =
  | 'budget'
  | 'capacity'
  | 'context'
  | 'optimizer'
  | 'scheduler'
  | 'attempt-budget';

export interface EfficiencyDecisionEvidence extends RecommendationEvidence {
  source: EfficiencyEvidenceSource;
}

export interface EfficiencyAllowanceBudget {
  /** Empirical p75 backend percentage for one accepted task; never a local-token conversion. */
  fiveHourPercent: number | null;
  /** Empirical p75 backend percentage for one accepted task; independent from five-hour usage. */
  weeklyPercent: number | null;
}

/**
 * Optional output of a future reviewed attempt-budget policy. Phase 19.1 only validates and
 * carries it; it does not invent retry or escalation limits from task names or model names.
 */
export interface EfficiencyAttemptBudget {
  maxAttempts: number;
  premiumEscalations: number;
  evidence: RecommendationEvidence[];
}

export interface EfficiencyDecision {
  harness: EfficiencyHarness;
  taskClass: TaskClass;
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  contextAction: EfficiencyContextAction;
  allowanceBudget: EfficiencyAllowanceBudget;
  maxAttempts: number | null;
  premiumEscalationBudget: number | null;
  evidence: EfficiencyDecisionEvidence[];
  reasons: RecommendationEvidence[];
}

export interface EfficiencyDecisionInput {
  currentHarness: EfficiencyHarness;
  taskClass: TaskClass;
  optimization: readonly HarnessOptimizationAdvice[];
  /** Exact-policy capacity estimates already produced by RFC 0016/0020 logic. */
  capacities?: readonly AcceptedTaskCapacityEstimate[];
  /** Existing advisory scheduler result. This never launches or switches a harness. */
  scheduler?: CrossHarnessSchedulerDecision | null;
  /** Optional already-assessed budget; omitted until a reviewed policy can prove it. */
  attemptBudget?: EfficiencyAttemptBudget | null;
}

function reason(code: string, summary: string): RecommendationEvidence {
  return { code, summary };
}

function isEfficiencyHarness(value: HarnessId): value is HarnessId & EfficiencyHarness {
  return value === 'claude' || value === 'codex';
}

function uniqueSorted<T extends RecommendationEvidence>(items: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(`${item.code}\0${item.summary}`, item);
  return [...unique.values()].sort(
    (left, right) =>
      left.code.localeCompare(right.code) || left.summary.localeCompare(right.summary),
  );
}

function uniqueSortedEvidence(items: readonly EfficiencyDecisionEvidence[]) {
  const unique = new Map<string, EfficiencyDecisionEvidence>();
  for (const item of items) {
    unique.set(`${item.source}\0${item.code}\0${item.summary}`, item);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.code.localeCompare(right.code) ||
      left.summary.localeCompare(right.summary),
  );
}

function addEvidence(
  target: EfficiencyDecisionEvidence[],
  source: EfficiencyEvidenceSource,
  items: readonly RecommendationEvidence[],
): void {
  for (const item of items) target.push({ source, ...item });
}

function chooseHarness(
  input: EfficiencyDecisionInput,
  evidence: EfficiencyDecisionEvidence[],
  reasons: RecommendationEvidence[],
): EfficiencyHarness {
  const scheduler = input.scheduler;
  if (scheduler === null || scheduler === undefined) {
    reasons.push(
      reason(
        'efficiency-harness-kept',
        'No compatible scheduler decision was supplied; keep the current harness',
      ),
    );
    return input.currentHarness;
  }
  addEvidence(evidence, 'scheduler', scheduler.reasons);
  if (
    scheduler.taskClass !== input.taskClass ||
    scheduler.currentHarness !== input.currentHarness ||
    !isEfficiencyHarness(scheduler.candidateHarness)
  ) {
    reasons.push(
      reason(
        'efficiency-scheduler-mismatch',
        'Scheduler evidence does not match this harness and task-class snapshot; keep the current harness',
      ),
    );
    return input.currentHarness;
  }
  if (scheduler.decision !== 'switch') {
    reasons.push(
      reason(
        scheduler.decision === 'stay'
          ? 'efficiency-scheduler-stay'
          : 'efficiency-scheduler-unknown',
        scheduler.decision === 'stay'
          ? 'The existing scheduler recommends keeping the current harness'
          : 'The existing scheduler lacks evidence for a cross-harness recommendation',
      ),
    );
    return input.currentHarness;
  }
  const candidate = scheduler.candidateHarness;
  const advice = input.optimization.filter((item) => item.harnessId === candidate);
  if (advice.length !== 1 || advice[0]!.state === 'absent' || advice[0]!.state === 'unavailable') {
    reasons.push(
      reason(
        'efficiency-candidate-policy-unavailable',
        'The scheduler recommends the candidate, but one usable candidate policy snapshot is not available; keep the current harness',
      ),
    );
    return input.currentHarness;
  }
  reasons.push(
    reason(
      'efficiency-scheduler-switch-advised',
      'The evidence-backed scheduler recommends the candidate harness; this decision remains read-only',
    ),
  );
  return candidate;
}

function chooseContextAction(advice: HarnessOptimizationAdvice): EfficiencyContextAction {
  if (advice.state === 'absent' || advice.state === 'unavailable') return 'unknown';
  if (
    (advice.budgetDecision?.state === 'wait-for-reset' &&
      advice.budgetDecision.reasons.length > 0) ||
    (advice.workloadCoverage?.state === 'exhausted' &&
      advice.workloadCoverage.reasons.length > 0) ||
    (advice.workloadCoverage?.state === 'shortfall' && advice.workloadCoverage.reasons.length > 0)
  ) {
    return 'checkpoint';
  }
  // Pressure does not identify expendable bytes. Masking needs item-level evidence from 19.2.
  if (advice.contextPressure === 'low') return 'keep';
  return 'unknown';
}

function recommendationEvidence(
  advice: HarnessOptimizationAdvice,
  area: RecommendationArea,
  target: string,
): RecommendationEvidence[] {
  return advice.recommendations
    .filter((item) => item.area === area && item.target === target)
    .flatMap((item) => item.evidence);
}

interface PolicyChoice {
  area: Extract<RecommendationArea, 'model' | 'reasoning' | 'verbosity'>;
  current: string | null;
  recommended: string | null;
}

function choosePolicy(
  advice: HarnessOptimizationAdvice,
  choices: readonly PolicyChoice[],
  taskClass: TaskClass,
  contextAction: EfficiencyContextAction,
  evidence: EfficiencyDecisionEvidence[],
  reasons: RecommendationEvidence[],
): Record<PolicyChoice['area'], string | null> {
  const selected = Object.fromEntries(
    choices.map((choice) => [choice.area, choice.current]),
  ) as Record<PolicyChoice['area'], string | null>;
  const supportedChanges = choices.filter((choice) => {
    if (choice.recommended === null || choice.recommended === choice.current) return false;
    const support = recommendationEvidence(advice, choice.area, choice.recommended);
    if (support.length === 0) {
      reasons.push(
        reason(
          `efficiency-${choice.area}-evidence-missing`,
          `Keep the current ${choice.area} because the recommendation has no attributable evidence`,
        ),
      );
      return false;
    }
    addEvidence(evidence, 'optimizer', support);
    return true;
  });

  if (supportedChanges.length > 1) {
    reasons.push(
      reason(
        'efficiency-single-control-guard',
        'Keep the observed policy because more than one learned native control would change at once',
      ),
    );
    return selected;
  }

  const change = supportedChanges[0];
  if (change === undefined) return selected;
  if (change.area === 'reasoning') {
    const recommendedRank = effortRank(change.recommended);
    const floorRank = effortRank(taskEffortFloor(taskClass));
    if (recommendedRank !== null && floorRank !== null && recommendedRank < floorRank) {
      reasons.push(
        reason(
          'efficiency-quality-floor-protected',
          'Keep the observed reasoning effort because the recommendation falls below the task quality floor',
        ),
      );
      return selected;
    }
    const currentRank = effortRank(change.current);
    if (
      contextAction !== 'keep' &&
      currentRank !== null &&
      recommendedRank !== null &&
      recommendedRank > currentRank &&
      advice.budgetDecision?.allowEffortIncrease === true
    ) {
      reasons.push(
        reason(
          'efficiency-context-before-quota-escalation',
          'Keep the observed reasoning effort until the recommended context action is completed',
        ),
      );
      return selected;
    }
  }
  selected[change.area] = change.recommended;
  reasons.push(
    reason(
      `efficiency-${change.area}-selected`,
      `Use the existing evidence-backed ${change.area} recommendation as the single policy change`,
    ),
  );
  return selected;
}

function exactCapacityBudget(
  input: EfficiencyDecisionInput,
  harness: EfficiencyHarness,
  policy: { model: string | null; reasoningEffort: string | null; verbosity: string | null },
  evidence: EfficiencyDecisionEvidence[],
  reasons: RecommendationEvidence[],
): EfficiencyAllowanceBudget {
  const empty = { fiveHourPercent: null, weeklyPercent: null };
  const matches = (input.capacities ?? []).filter(
    (item) =>
      item.harnessId === harness &&
      item.taskClass === input.taskClass &&
      item.policy !== undefined &&
      item.policy.model === policy.model &&
      item.policy.reasoningEffort === policy.reasoningEffort &&
      item.policy.verbosity === policy.verbosity,
  );
  if (matches.length !== 1) {
    reasons.push(
      reason(
        matches.length === 0
          ? 'efficiency-task-budget-unknown'
          : 'efficiency-task-budget-ambiguous',
        matches.length === 0
          ? 'Exact-policy accepted-task capacity is unavailable; task allowance budgets remain unknown'
          : 'Multiple exact-policy capacity estimates were supplied; task allowance budgets remain unknown',
      ),
    );
    return empty;
  }
  const capacity = matches[0]!;
  const fiveHour = capacity.fiveHour.p75UsedPercentPerAcceptedTask;
  const weekly = capacity.weekly.p75UsedPercentPerAcceptedTask;
  const valid = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value > 0 && value <= 100;
  const fiveHourSpendable = capacity.fiveHour.spendableRemainingPercent;
  const weeklySpendable = capacity.weekly.spendableRemainingPercent;
  if (
    capacity.status !== 'estimated' ||
    !valid(fiveHour) ||
    !valid(weekly) ||
    fiveHourSpendable === null ||
    !Number.isFinite(fiveHourSpendable) ||
    fiveHourSpendable < fiveHour ||
    weeklySpendable === null ||
    !Number.isFinite(weeklySpendable) ||
    weeklySpendable < weekly
  ) {
    addEvidence(
      evidence,
      'capacity',
      capacity.reasons.map((summary, index) => ({
        code: `capacity-reason-${String(index + 1)}`,
        summary,
      })),
    );
    reasons.push(
      reason(
        'efficiency-task-budget-unknown',
        'Complete exact-policy task cost must fit within both observed spendable allowances after reserve',
      ),
    );
    return empty;
  }
  evidence.push({
    source: 'capacity',
    code: 'exact-policy-task-cost',
    summary:
      `Accepted-task p75 cost is ${String(fiveHour)}% five-hour and ` +
      `${String(weekly)}% weekly at the selected model/effort/verbosity policy`,
  });
  reasons.push(
    reason(
      'efficiency-task-budget-evidenced',
      'Keep five-hour and weekly task budgets separate at their exact-policy empirical p75 costs',
    ),
  );
  return { fiveHourPercent: fiveHour, weeklyPercent: weekly };
}

function attemptBudget(
  input: EfficiencyDecisionInput,
  evidence: EfficiencyDecisionEvidence[],
  reasons: RecommendationEvidence[],
): Pick<EfficiencyDecision, 'maxAttempts' | 'premiumEscalationBudget'> {
  const budget = input.attemptBudget;
  if (
    budget === null ||
    budget === undefined ||
    !Number.isSafeInteger(budget.maxAttempts) ||
    budget.maxAttempts < 1 ||
    !Number.isSafeInteger(budget.premiumEscalations) ||
    budget.premiumEscalations < 0 ||
    budget.premiumEscalations >= budget.maxAttempts ||
    budget.evidence.length === 0
  ) {
    reasons.push(
      reason(
        'efficiency-attempt-budget-unknown',
        'No reviewed evidence-backed attempt and premium-escalation budget is available',
      ),
    );
    return { maxAttempts: null, premiumEscalationBudget: null };
  }
  addEvidence(evidence, 'attempt-budget', budget.evidence);
  reasons.push(
    reason(
      'efficiency-attempt-budget-evidenced',
      'Use the supplied evidence-backed attempt and premium-escalation ceilings',
    ),
  );
  return {
    maxAttempts: budget.maxAttempts,
    premiumEscalationBudget: budget.premiumEscalations,
  };
}

/** Produce one deterministic, explainable and mutation-free per-task decision. */
export function decideEfficiency(input: EfficiencyDecisionInput): EfficiencyDecision {
  const evidence: EfficiencyDecisionEvidence[] = [];
  const reasons: RecommendationEvidence[] = [];
  const harness = chooseHarness(input, evidence, reasons);
  const matchingAdvice = input.optimization.filter((item) => item.harnessId === harness);
  const advice = matchingAdvice.length === 1 ? matchingAdvice[0]! : null;

  if (advice === null || advice.state === 'absent' || advice.state === 'unavailable') {
    reasons.push(
      reason(
        advice !== null
          ? 'efficiency-optimizer-evidence-unavailable'
          : matchingAdvice.length === 0
            ? 'efficiency-optimizer-evidence-missing'
            : 'efficiency-optimizer-evidence-ambiguous',
        'One optimizer snapshot is required for the selected harness; policy and context remain unknown',
      ),
    );
    const attempts = attemptBudget(input, evidence, reasons);
    return {
      harness,
      taskClass: input.taskClass,
      model: null,
      reasoningEffort: null,
      verbosity: null,
      contextAction: 'unknown',
      allowanceBudget: { fiveHourPercent: null, weeklyPercent: null },
      ...attempts,
      evidence: uniqueSortedEvidence(evidence),
      reasons: uniqueSorted(reasons),
    };
  }

  addEvidence(evidence, 'budget', advice.budgetDecision?.reasons ?? []);
  addEvidence(evidence, 'capacity', advice.workloadCoverage?.reasons ?? []);
  const contextEvidence = advice.recommendations
    .filter((item) => item.area === 'context' || item.area === 'session')
    .flatMap((item) => item.evidence);
  const contextAction = chooseContextAction(advice);
  addEvidence(evidence, 'context', contextEvidence);
  reasons.push(
    reason(
      `efficiency-context-${contextAction}`,
      contextAction === 'checkpoint'
        ? 'Checkpoint before more work because included allowance or stated-workload capacity is constrained'
        : contextAction === 'keep'
          ? 'Observed context pressure does not require cleanup before this attempt'
          : 'Context evidence is incomplete; do not invent a cleanup action',
    ),
  );

  const policy = choosePolicy(
    advice,
    [
      { area: 'model', current: advice.currentModel, recommended: advice.recommendedModel },
      { area: 'reasoning', current: advice.currentEffort, recommended: advice.recommendedEffort },
      {
        area: 'verbosity',
        current: advice.currentVerbosity,
        recommended: advice.recommendedVerbosity,
      },
    ],
    input.taskClass,
    contextAction,
    evidence,
    reasons,
  );
  const selectedRank = effortRank(policy.reasoning);
  const floorRank = effortRank(taskEffortFloor(input.taskClass));
  if (selectedRank !== null && floorRank !== null && selectedRank < floorRank) {
    policy.reasoning = null;
    reasons.push(
      reason(
        'efficiency-observed-effort-below-floor',
        'Neither the observed effort nor a supported recommendation establishes the task quality floor',
      ),
    );
  }
  const selectedPolicy = {
    model: policy.model,
    reasoningEffort: policy.reasoning,
    verbosity: policy.verbosity,
  };
  const allowanceBudget = exactCapacityBudget(input, harness, selectedPolicy, evidence, reasons);
  const attempts = attemptBudget(input, evidence, reasons);

  return {
    harness,
    taskClass: input.taskClass,
    ...selectedPolicy,
    contextAction,
    allowanceBudget,
    ...attempts,
    evidence: uniqueSortedEvidence(evidence),
    reasons: uniqueSorted(reasons),
  };
}
