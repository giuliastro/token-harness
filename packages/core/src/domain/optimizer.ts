/**
 * Advisory quota optimizer — RFC 0011 Phase 18.3.
 *
 * This module contains deterministic policy only. It does not observe the machine and it cannot
 * mutate a harness. Provider quota percentages remain observations; policy thresholds below are
 * Token Harness preferences, not reverse-engineered provider formulas.
 */

import type { UsageWindowSnapshot } from './budget.js';
import type { Diagnostic } from './diagnostics.js';
import type { LocalBurnTrend, SessionBoundarySignal } from './history.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';

export const TASK_CLASSES = ['mechanical', 'standard', 'hard', 'critical'] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

export const BUDGET_PROFILES = ['economy', 'balanced', 'quality', 'custom'] as const;
export type BudgetProfile = (typeof BUDGET_PROFILES)[number];

export function isTaskClass(value: string): value is TaskClass {
  return (TASK_CLASSES as readonly string[]).includes(value);
}

export function isBudgetProfile(value: string): value is BudgetProfile {
  return (BUDGET_PROFILES as readonly string[]).includes(value);
}

export type PaceState = 'under-pace' | 'on-pace' | 'over-pace' | 'unknown';
export type ContextPressure = 'low' | 'moderate' | 'high' | 'unknown';

export interface WindowPaceAssessment {
  harnessId: HarnessId;
  scope: string;
  state: PaceState;
  usedPercent: number | null;
  remainingPercent: number | null;
  targetUsedPercent: number | null;
  reservePercent: number;
  minutesToReset: number | null;
  resetsAt: string | null;
  reason: string;
}

export interface RecommendationEvidence {
  code: string;
  summary: string;
}

export type RecommendationArea =
  | 'quota'
  | 'history'
  | 'session'
  | 'context'
  | 'model'
  | 'reasoning'
  | 'verbosity';

export interface OptimizationRecommendation {
  area: RecommendationArea;
  priority: 'first' | 'next' | 'optional';
  action: string;
  target: string | null;
  evidence: RecommendationEvidence[];
}

export interface HarnessOptimizationAdvice {
  harnessId: HarnessId;
  state: 'advised' | 'partial' | 'unavailable' | 'absent';
  currentModel: string | null;
  recommendedModel: string | null;
  currentEffort: string | null;
  recommendedEffort: string | null;
  currentVerbosity: string | null;
  recommendedVerbosity: string | null;
  contextPressure: ContextPressure;
  /** Local token-volume trend only; never a subscription-quota estimate. */
  localBurnTrend: LocalBurnTrend | null;
  /** Most recently observed local session candidate; never asserted to be the active session. */
  recentSession: SessionBoundarySignal | null;
  pace: WindowPaceAssessment[];
  recommendations: OptimizationRecommendation[];
  diagnostics: Diagnostic[];
}

export interface OptimizeReport {
  platform: PlatformFacts;
  projectRoot: string;
  observedAt: string;
  taskClass: TaskClass;
  profile: BudgetProfile;
  reservePercent: number;
  harnesses: HarnessOptimizationAdvice[];
}

const EFFORT_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'persistent',
] as const;

const QUALITY_FLOOR: Readonly<Record<TaskClass, string>> = {
  mechanical: 'minimal',
  standard: 'low',
  hard: 'medium',
  critical: 'high',
};

const PROFILE_TARGET: Readonly<
  Record<Exclude<BudgetProfile, 'custom'>, Record<TaskClass, string>>
> = {
  economy: {
    mechanical: 'minimal',
    standard: 'low',
    hard: 'medium',
    critical: 'high',
  },
  balanced: {
    mechanical: 'low',
    standard: 'medium',
    hard: 'high',
    critical: 'xhigh',
  },
  quality: {
    mechanical: 'medium',
    standard: 'high',
    hard: 'xhigh',
    critical: 'max',
  },
};

function effortRank(value: string | null): number | null {
  if (value === null) return null;
  const rank = (EFFORT_ORDER as readonly string[]).indexOf(value);
  return rank === -1 ? null : rank;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function assessWindowPace(
  window: UsageWindowSnapshot,
  now: string,
  reservePercent: number,
): WindowPaceAssessment {
  const base = {
    harnessId: window.harnessId,
    scope: window.scope,
    usedPercent: window.usedPercent,
    remainingPercent: window.remainingPercent,
    reservePercent,
    resetsAt: window.resetsAt,
  };

  if (
    window.usedPercent === null ||
    window.windowDurationMinutes === null ||
    window.resetsAt === null
  ) {
    return {
      ...base,
      state: 'unknown',
      targetUsedPercent: null,
      minutesToReset: null,
      reason: 'usage, duration, and reset are all required for pacing',
    };
  }

  const nowMs = Date.parse(now);
  const resetMs = Date.parse(window.resetsAt);
  const durationMs = window.windowDurationMinutes * 60_000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(resetMs) || durationMs <= 0 || nowMs >= resetMs) {
    return {
      ...base,
      state: 'unknown',
      targetUsedPercent: null,
      minutesToReset: null,
      reason: 'the usage window timing is stale or invalid',
    };
  }

  const startMs = resetMs - durationMs;
  if (nowMs < startMs) {
    return {
      ...base,
      state: 'unknown',
      targetUsedPercent: null,
      minutesToReset: Math.round((resetMs - nowMs) / 60_000),
      reason: 'the observation precedes the implied window start',
    };
  }

  const elapsedFraction = clamp((nowMs - startMs) / durationMs, 0, 1);
  const spendablePercent = 100 - clamp(reservePercent, 0, 95);
  const targetUsedPercent = spendablePercent * elapsedFraction;
  const delta = window.usedPercent - targetUsedPercent;
  // An eight-point deadband prevents tiny backend/reporting fluctuations from flipping advice.
  const state: PaceState = delta > 8 ? 'over-pace' : delta < -8 ? 'under-pace' : 'on-pace';

  return {
    ...base,
    state,
    targetUsedPercent: Math.round(targetUsedPercent * 10) / 10,
    minutesToReset: Math.max(0, Math.round((resetMs - nowMs) / 60_000)),
    reason:
      state === 'over-pace'
        ? 'usage is materially ahead of the linear spendable allowance'
        : state === 'under-pace'
          ? 'usage is materially behind the linear spendable allowance'
          : 'usage is within the pacing deadband',
  };
}

function targetEffort(task: TaskClass, profile: BudgetProfile): string {
  const effective = profile === 'custom' ? 'balanced' : profile;
  return PROFILE_TARGET[effective][task];
}

function isResetSoon(pace: WindowPaceAssessment): boolean {
  if (pace.minutesToReset === null) return false;
  if (pace.scope === 'five-hour') return pace.minutesToReset <= 60;
  if (pace.scope === 'weekly') return pace.minutesToReset <= 12 * 60;
  return false;
}

export function chooseSupportedEffort(input: {
  supported: readonly string[];
  current: string | null;
  defaultEffort: string | null;
  taskClass: TaskClass;
  profile: BudgetProfile;
  pace: readonly WindowPaceAssessment[];
  contextPressure: ContextPressure;
}): string | null {
  const floorRank = effortRank(QUALITY_FLOOR[input.taskClass]);
  let targetRank = effortRank(targetEffort(input.taskClass, input.profile));
  if (floorRank === null || targetRank === null) return input.current ?? input.defaultEffort;

  const overPace = input.pace.some((item) => item.state === 'over-pace');
  const underPaceNearReset =
    (input.taskClass === 'hard' || input.taskClass === 'critical') &&
    input.pace.some((item) => item.state === 'under-pace' && isResetSoon(item));

  if (overPace) targetRank = Math.max(floorRank, targetRank - 1);
  if (underPaceNearReset) targetRank = Math.min(EFFORT_ORDER.length - 1, targetRank + 1);

  const currentRank = effortRank(input.current ?? input.defaultEffort);
  if (input.contextPressure === 'high' && currentRank !== null && targetRank > currentRank) {
    targetRank = Math.max(floorRank, currentRank);
  }

  const ranked = input.supported
    .map((value) => ({ value, rank: effortRank(value) }))
    .filter((item): item is { value: string; rank: number } => item.rank !== null)
    .filter((item) => item.rank >= floorRank);

  if (ranked.length === 0) {
    const fallback = input.current ?? input.defaultEffort;
    return fallback !== null && input.supported.includes(fallback) ? fallback : null;
  }

  ranked.sort((left, right) => {
    const leftDistance = Math.abs(left.rank - targetRank);
    const rightDistance = Math.abs(right.rank - targetRank);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left.rank - right.rank;
  });
  return ranked[0]?.value ?? null;
}
