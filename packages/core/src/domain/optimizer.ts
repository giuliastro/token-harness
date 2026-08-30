/**
 * Advisory quota optimizer — RFC 0011 Phase 18.3.
 *
 * This module contains deterministic policy only. It does not observe the machine and it cannot
 * mutate a harness. Provider quota percentages remain observations; policy thresholds below are
 * Token Harness preferences, not reverse-engineered provider formulas.
 */

import type { Diagnostic } from './diagnostics.js';
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

export type RecommendationArea = 'quota' | 'context' | 'model' | 'reasoning' | 'verbosity';

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
