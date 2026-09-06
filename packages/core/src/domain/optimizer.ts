/**
 * Advisory quota optimizer — RFC 0011 Phase 18.3 and RFC 0014.
 *
 * This module contains deterministic policy only. It does not observe the machine and it cannot
 * mutate a harness. Provider quota percentages remain observations; policy thresholds below are
 * Token Harness preferences, not reverse-engineered provider formulas.
 */

import type { UsageWindowSnapshot } from './budget.js';
import { assessBudgetDecision, type BudgetDecision } from './budget-policy.js';
import type { Diagnostic } from './diagnostics.js';
import type { LocalBurnTrend, SessionBoundarySignal } from './history.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';

export { assessBudgetDecision } from './budget-policy.js';
export type { BudgetDecision, BudgetDecisionState } from './budget-policy.js';

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
  /** Additive evidence fields. No provider-neutral or cross-window total is implied. */
  bucketId?: string | null;
  observationAgeMinutes?: number | null;
  spendableRemainingPercent?: number | null;
  /** Advisory allocation, NOT a measured burn rate, token count, or exhaustion forecast. */
  spendablePercentPerHour?: number | null;
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
  | 'mcp'
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
  /** Additive joint five-hour/weekly decision. Older saved reports may omit it. */
  budgetDecision?: BudgetDecision;
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

function validPercent(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Freshness is product policy; it is deliberately not inferred from the backend quota formula. */
export const QUOTA_MAX_AGE_MS = 5 * 60_000;
export const QUOTA_CLOCK_SKEW_MS = 60_000;

export function assessWindowPace(
  window: UsageWindowSnapshot,
  now: string,
  reservePercent: number,
): WindowPaceAssessment {
  const nowMs = Date.parse(now);
  const observedMs = Date.parse(window.observedAt);
  const ageMs = nowMs - observedMs;
  const base = {
    harnessId: window.harnessId,
    scope: window.scope,
    usedPercent: validPercent(window.usedPercent) ? window.usedPercent : null,
    remainingPercent: validPercent(window.remainingPercent) ? window.remainingPercent : null,
    reservePercent,
    resetsAt: window.resetsAt,
    bucketId: window.bucketId,
    observationAgeMinutes: Number.isFinite(ageMs) ? Math.max(0, ageMs / 60_000) : null,
    spendableRemainingPercent: null,
    spendablePercentPerHour: null,
  };
  const unknown = (reason: string): WindowPaceAssessment => ({
    ...base,
    state: 'unknown',
    targetUsedPercent: null,
    minutesToReset: null,
    reason,
  });
  if (window.confidence === 'cached' || window.confidence === 'estimated') {
    return unknown('cached or estimated usage is displayed but not used for live pacing');
  }
  if (
    !['authoritative', 'reported'].includes(window.confidence) ||
    !['native-rpc', 'native-cli', 'companion-cli'].includes(window.source)
  ) {
    return unknown('only observed native or reviewed companion quota is used for live pacing');
  }
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(observedMs) ||
    ageMs > QUOTA_MAX_AGE_MS ||
    ageMs < -QUOTA_CLOCK_SKEW_MS
  ) {
    return unknown(
      'the quota observation is stale, future-dated, or invalid; refresh before pacing',
    );
  }
  if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 95) {
    return unknown('the configured reserve must be finite and between 0 and 95 percent');
  }
  if (
    !validPercent(window.usedPercent) ||
    window.windowDurationMinutes === null ||
    !Number.isFinite(window.windowDurationMinutes) ||
    window.windowDurationMinutes <= 0 ||
    window.resetsAt === null
  ) {
    return unknown('valid usage, duration, and reset are all required for pacing');
  }
  if (
    window.remainingPercent !== null &&
    (!validPercent(window.remainingPercent) ||
      Math.abs(window.usedPercent + window.remainingPercent - 100) > 1)
  ) {
    return unknown('reported used and remaining percentages are invalid or inconsistent');
  }
  const resetMs = Date.parse(window.resetsAt);
  const durationMs = window.windowDurationMinutes * 60_000;
  if (
    !Number.isFinite(resetMs) ||
    !Number.isFinite(durationMs) ||
    nowMs >= resetMs ||
    observedMs >= resetMs
  ) {
    return unknown('the usage window timing is stale or invalid');
  }
  const startMs = resetMs - durationMs;
  if (nowMs < startMs || observedMs < startMs) {
    return unknown('the observation precedes the implied window start');
  }

  const remainingPercent = Math.min(window.remainingPercent ?? 100, 100 - window.usedPercent);
  const usedPercent = 100 - remainingPercent;
  const elapsedFraction = (nowMs - startMs) / durationMs;
  const targetUsedPercent = (100 - reservePercent) * elapsedFraction;
  const delta = usedPercent - targetUsedPercent;
  // An eight-point deadband prevents backend rounding from constantly flipping pacing.
  // Reserve/exhaustion are separate vetoes in the joint policy, never hidden by the deadband.
  const state: PaceState = delta > 8 ? 'over-pace' : delta < -8 ? 'under-pace' : 'on-pace';
  const spendableRemainingPercent = Math.max(0, remainingPercent - reservePercent);
  return {
    ...base,
    usedPercent,
    remainingPercent,
    state,
    targetUsedPercent: Math.round(targetUsedPercent * 10) / 10,
    minutesToReset: (resetMs - nowMs) / 60_000,
    spendableRemainingPercent,
    spendablePercentPerHour: spendableRemainingPercent / ((resetMs - nowMs) / 3_600_000),
    reason:
      state === 'over-pace'
        ? 'usage is materially ahead of the linear spendable allowance'
        : state === 'under-pace'
          ? 'usage is materially behind the linear spendable allowance'
          : 'usage is within the pacing deadband',
  };
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
  const effective = input.profile === 'custom' ? 'balanced' : input.profile;
  let targetRank = effortRank(PROFILE_TARGET[effective][input.taskClass]);
  if (floorRank === null || targetRank === null) return null;

  const budget = assessBudgetDecision(input.pace, input.taskClass);
  if (budget.state === 'conserve' || budget.state === 'wait-for-reset') {
    targetRank = Math.max(floorRank, targetRank - 1);
  } else if (budget.allowEffortIncrease) {
    targetRank = Math.min(EFFORT_ORDER.length - 1, targetRank + 1);
  }
  const currentRank = effortRank(input.current ?? input.defaultEffort);
  if (input.contextPressure === 'high' && currentRank !== null && targetRank > currentRank) {
    targetRank = Math.max(floorRank, currentRank);
  }
  const ranked = input.supported
    .map((value) => ({ value, rank: effortRank(value) }))
    .filter((item): item is { value: string; rank: number } => item.rank !== null)
    .filter((item) => item.rank >= floorRank);
  if (ranked.length === 0) {
    // Preserve a supported unranked current value, but never endorse a known below-floor one.
    const fallback = input.current ?? input.defaultEffort;
    return fallback !== null && effortRank(fallback) === null && input.supported.includes(fallback)
      ? fallback
      : null;
  }
  ranked.sort((left, right) => {
    const distance = Math.abs(left.rank - targetRank) - Math.abs(right.rank - targetRank);
    return distance !== 0 ? distance : left.rank - right.rank;
  });
  return ranked[0]?.value ?? null;
}
