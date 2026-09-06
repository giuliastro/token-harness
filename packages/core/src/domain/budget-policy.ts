/** Joint included-allowance policy. Percentages from different windows are never combined. */
import type { RecommendationEvidence, TaskClass, WindowPaceAssessment } from './optimizer.js';

export type BudgetDecisionState =
  | 'wait-for-reset'
  | 'conserve'
  | 'use-headroom'
  | 'balanced'
  | 'unknown';

export interface BudgetDecision {
  state: BudgetDecisionState;
  /** Permission for a quota-derived bonus, not permission to exceed the task quality floor. */
  allowEffortIncrease: boolean;
  pressuredScopes: string[];
  missingScopes: ('five-hour' | 'weekly')[];
  /** Re-observe after these known exhausted limits reset; not a promise of available capacity. */
  recheckAt: string | null;
  reasons: RecommendationEvidence[];
}

const INCLUDED_SCOPES = ['five-hour', 'weekly'] as const;

function validPercent(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function remaining(item: WindowPaceAssessment): number | null {
  if (!validPercent(item.usedPercent)) return null;
  if (item.remainingPercent === null) return 100 - item.usedPercent;
  if (
    !validPercent(item.remainingPercent) ||
    Math.abs(item.usedPercent + item.remainingPercent - 100) > 1
  )
    return null;
  return Math.min(item.remainingPercent, 100 - item.usedPercent);
}

function isLive(item: WindowPaceAssessment): boolean {
  return (
    ['under-pace', 'on-pace', 'over-pace'].includes(item.state) &&
    remaining(item) !== null &&
    Number.isFinite(item.reservePercent) &&
    item.reservePercent >= 0 &&
    item.reservePercent <= 95 &&
    item.minutesToReset !== null &&
    Number.isFinite(item.minutesToReset) &&
    item.minutesToReset > 0 &&
    item.resetsAt !== null &&
    Number.isFinite(Date.parse(item.resetsAt))
  );
}

function nearReset(item: WindowPaceAssessment): boolean {
  if (item.minutesToReset === null) return false;
  return (
    (item.scope === 'five-hour' && item.minutesToReset <= 60) ||
    (item.scope === 'weekly' && item.minutesToReset <= 720)
  );
}

function sortedScopes(items: readonly WindowPaceAssessment[]): string[] {
  return [...new Set(items.map((item) => item.scope))].sort();
}

/**
 * Pressure is a veto, not a vote: safe short-term capacity cannot cancel a threatened week.
 * This consumes assessed evidence only. It does not observe, mutate, forecast, or buy anything.
 */
export function assessBudgetDecision(
  pace: readonly WindowPaceAssessment[],
  taskClass: TaskClass,
): BudgetDecision {
  // Paid/reset-credit inventory is not included-allowance evidence in either direction.
  const included = pace.filter((item) => item.scope !== 'credit');
  const base = {
    allowEffortIncrease: false,
    pressuredScopes: [] as string[],
    missingScopes: INCLUDED_SCOPES.filter(
      (scope) => included.filter((item) => item.scope === scope && isLive(item)).length !== 1,
    ),
    recheckAt: null,
  };
  if (new Set(included.map((item) => item.harnessId)).size > 1) {
    return {
      ...base,
      state: 'unknown',
      reasons: [
        { code: 'mixed-budget-domains', summary: 'Different harness budgets cannot be combined' },
      ],
    };
  }

  const live = included.filter(isLive);
  const pressured = live.filter(
    (item) => item.state === 'over-pace' || remaining(item)! <= item.reservePercent,
  );
  const exhausted = live.filter((item) => remaining(item) === 0);
  // A model-specific/duplicate bucket has no proven mapping to the active task.
  const mappedExhausted = exhausted.filter(
    (item) =>
      (item.scope === 'five-hour' || item.scope === 'weekly') &&
      included.filter((other) => other.scope === item.scope).length === 1,
  );
  if (mappedExhausted.length > 0) {
    const recheckAt = new Date(
      Math.max(...mappedExhausted.map((item) => Date.parse(item.resetsAt!))),
    ).toISOString();
    return {
      ...base,
      state: 'wait-for-reset',
      pressuredScopes: sortedScopes(pressured),
      recheckAt,
      reasons: [
        {
          code: 'included-allowance-exhausted',
          summary:
            'An observed included limit is exhausted; save a checkpoint and re-observe after ' +
            recheckAt +
            '; other limits may still apply',
        },
      ],
    };
  }
  if (pressured.length > 0) {
    return {
      ...base,
      state: 'conserve',
      pressuredScopes: sortedScopes(pressured),
      reasons: [
        {
          code: 'joint-reserve-protection',
          summary:
            sortedScopes(pressured).join(', ') +
            ': over pace or at the configured reserve; another window cannot cancel this constraint',
        },
      ],
    };
  }

  const complete = INCLUDED_SCOPES.every((scope) => {
    const matching = included.filter((item) => item.scope === scope);
    return matching.length === 1 && isLive(matching[0]!);
  });
  const unmapped = included.some((item) => item.scope !== 'five-hour' && item.scope !== 'weekly');
  if (!complete || unmapped) {
    return {
      ...base,
      state: 'unknown',
      reasons: [
        {
          code: 'joint-headroom-unproven',
          summary:
            'A quota bonus requires one fresh five-hour and one fresh weekly window with no additional unmapped limits; keep task-class effort instead',
        },
      ],
    };
  }

  if (
    (taskClass === 'hard' || taskClass === 'critical') &&
    live.some((item) => item.state === 'under-pace' && nearReset(item))
  ) {
    return {
      ...base,
      state: 'use-headroom',
      allowEffortIncrease: true,
      reasons: [
        {
          code: 'joint-headroom-available',
          summary:
            'Both included windows have safe headroom and under-used allowance is near reset; a hard task may justify more effort after context cleanup',
        },
      ],
    };
  }
  return {
    ...base,
    state: 'balanced',
    reasons: [
      {
        code: 'joint-budget-balanced',
        summary: 'Both included windows are within budget; use the task-class effort policy',
      },
    ],
  };
}
