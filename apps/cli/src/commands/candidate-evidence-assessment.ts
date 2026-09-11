import type {
  OptimizationCandidateId,
  TaskBenchmarkMatrixEntry,
  TaskClass,
} from '@token-harness/core';

export type CandidateEvidenceSignal = 'insufficient-evidence' | 'promising' | 'mixed' | 'negative';

export interface CandidateAssessmentSlot {
  benchmarkId: string;
  taskClass: TaskClass;
  state:
    | 'baseline-not-started'
    | 'baseline-running'
    | 'optimized-not-started'
    | 'optimized-running'
    | 'complete'
    | 'invalid';
}

export interface CandidateAssessmentEvidence {
  evidencePairs: number;
  evidenceCoveragePercent: number | null;
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  inconclusive: number;
  incomparable: number;
  wallClockComparablePairs: number;
  wallClockSavingPercent: number | null;
}

export interface CandidateEvidenceAssessmentInput {
  candidateId: OptimizationCandidateId;
  totalPairs: number;
  completedPairs: number;
  invalidPairs: number;
  slots: readonly CandidateAssessmentSlot[];
  entries: readonly TaskBenchmarkMatrixEntry[];
  evidence: CandidateAssessmentEvidence;
}

export interface CandidateEvidenceAssessment {
  signal: CandidateEvidenceSignal;
  decisionReady: boolean;
  completedPairs: number;
  evidencePairs: number;
  coveredTaskClasses: TaskClass[];
  minimumEvidencePairs: number;
  minimumTaskClasses: number;
  minimumEvidenceCoveragePercent: number;
  hardRegressionPairs: number;
  reasons: string[];
  promotionEligible: false;
  promotionBlockers: string[];
}

const MINIMUM_EVIDENCE_PAIRS = 6;
const MINIMUM_TASK_CLASSES = 3;
const MINIMUM_EVIDENCE_COVERAGE_PERCENT = 75;
const MATERIAL_WIN_PAIRS = 3;
const MATERIAL_WALL_CLOCK_REGRESSION_PERCENT = -15;
const HARD_REGRESSION_BASES = new Set<TaskBenchmarkMatrixEntry['basis']>([
  'quality',
  'failed-attempts',
  'runtime-errors',
  'attempts',
]);

function completedCampaignEntries(
  slots: readonly CandidateAssessmentSlot[],
  entries: readonly TaskBenchmarkMatrixEntry[],
): TaskBenchmarkMatrixEntry[] {
  const completeIds = new Set(
    slots.filter((slot) => slot.state === 'complete').map((slot) => slot.benchmarkId),
  );
  return entries.filter((entry) => completeIds.has(entry.benchmarkId));
}

function coveredTaskClasses(entries: readonly TaskBenchmarkMatrixEntry[]): TaskClass[] {
  const order: readonly TaskClass[] = ['mechanical', 'standard', 'hard', 'critical'];
  const covered = new Set(
    entries.filter((entry) => entry.evidenceLevel !== 'none').map((entry) => entry.taskClass),
  );
  return order.filter((taskClass) => covered.has(taskClass));
}

function basePromotionBlockers(
  candidateId: OptimizationCandidateId,
  completedPairs: number,
  totalPairs: number,
): string[] {
  const blockers = [
    'candidate attribution names the experiment target but does not independently verify activation',
    'managed install/configure, verification, compatibility and rollback are not proven by benchmark evidence',
    'the combined recommended stack still requires its own quality-safe validation',
  ];
  if (completedPairs < totalPairs) blockers.push('the standard benchmark campaign is not complete');
  if (candidateId === 'headroom') {
    blockers.push(
      'a broad context owner must also pass the dedicated context-owner admission gate',
    );
  }
  return blockers;
}

function result(
  input: CandidateEvidenceAssessmentInput,
  signal: CandidateEvidenceSignal,
  decisionReady: boolean,
  covered: TaskClass[],
  hardRegressionPairs: number,
  reasons: string[],
): CandidateEvidenceAssessment {
  const promotionBlockers = basePromotionBlockers(
    input.candidateId,
    input.completedPairs,
    input.totalPairs,
  );
  if (signal !== 'promising') {
    promotionBlockers.unshift('benchmark evidence is not yet a promising selection signal');
  }
  return {
    signal,
    decisionReady,
    completedPairs: input.completedPairs,
    evidencePairs: input.evidence.evidencePairs,
    coveredTaskClasses: covered,
    minimumEvidencePairs: MINIMUM_EVIDENCE_PAIRS,
    minimumTaskClasses: MINIMUM_TASK_CLASSES,
    minimumEvidenceCoveragePercent: MINIMUM_EVIDENCE_COVERAGE_PERCENT,
    hardRegressionPairs,
    reasons,
    promotionEligible: false,
    promotionBlockers,
  };
}

/**
 * Turn a standard candidate campaign into a conservative selection signal without inventing a
 * composite score. Quality/reliability regressions can reject early; positive selection requires
 * repeated evidence across multiple task classes. Promotion remains a separate lifecycle gate.
 */
export function assessCandidateEvidence(
  input: CandidateEvidenceAssessmentInput,
): CandidateEvidenceAssessment {
  const entries = completedCampaignEntries(input.slots, input.entries);
  const covered = coveredTaskClasses(entries);
  const hardRegressions = entries.filter(
    (entry) => entry.verdict === 'baseline-better' && HARD_REGRESSION_BASES.has(entry.basis),
  );

  if (hardRegressions.length > 0) {
    return result(input, 'negative', true, covered, hardRegressions.length, [
      `${String(hardRegressions.length)} completed pair(s) regressed quality, retries, attempts, or runtime/provider errors`,
      'quality and reliability safety override raw token or timing savings',
    ]);
  }

  if (input.invalidPairs > 0) {
    return result(input, 'insufficient-evidence', false, covered, 0, [
      `${String(input.invalidPairs)} campaign pair(s) contain ambiguous or incompatible state`,
      'use a new campaign id rather than repairing evidence in place',
    ]);
  }

  const coverage = input.evidence.evidenceCoveragePercent ?? 0;
  const sufficiencyReasons: string[] = [];
  if (input.evidence.evidencePairs < MINIMUM_EVIDENCE_PAIRS) {
    sufficiencyReasons.push(
      `need at least ${String(MINIMUM_EVIDENCE_PAIRS)} evidence-bearing completed pairs`,
    );
  }
  if (covered.length < MINIMUM_TASK_CLASSES) {
    sufficiencyReasons.push(
      `need evidence across at least ${String(MINIMUM_TASK_CLASSES)} task classes`,
    );
  }
  if (coverage < MINIMUM_EVIDENCE_COVERAGE_PERCENT) {
    sufficiencyReasons.push(
      `need at least ${String(MINIMUM_EVIDENCE_COVERAGE_PERCENT)}% evidence coverage`,
    );
  }
  if (sufficiencyReasons.length > 0) {
    return result(input, 'insufficient-evidence', false, covered, 0, sufficiencyReasons);
  }

  if (input.evidence.baselineBetter > input.evidence.optimizedBetter) {
    return result(input, 'negative', true, covered, 0, [
      `baseline wins (${String(input.evidence.baselineBetter)}) exceed optimized wins (${String(input.evidence.optimizedBetter)})`,
      'the current paired evidence does not show positive marginal value over the existing stack',
    ]);
  }

  if (input.evidence.baselineBetter > 0) {
    return result(input, 'mixed', true, covered, 0, [
      `evidence contains both optimized wins (${String(input.evidence.optimizedBetter)}) and baseline wins (${String(input.evidence.baselineBetter)})`,
      'investigate which workload classes benefit before considering a managed integration',
    ]);
  }

  if (
    input.evidence.wallClockComparablePairs >= 3 &&
    input.evidence.wallClockSavingPercent !== null &&
    input.evidence.wallClockSavingPercent <= MATERIAL_WALL_CLOCK_REGRESSION_PERCENT
  ) {
    return result(input, 'mixed', true, covered, 0, [
      `quality-passed wall clock regressed by ${String(Math.abs(input.evidence.wallClockSavingPercent))}% across ${String(input.evidence.wallClockComparablePairs)} comparable pairs`,
      'operational cost materially offsets an otherwise positive savings signal',
    ]);
  }

  if (input.evidence.optimizedBetter < MATERIAL_WIN_PAIRS) {
    return result(input, 'mixed', true, covered, 0, [
      `only ${String(input.evidence.optimizedBetter)} evidence-bearing pair(s) show a candidate win`,
      `need at least ${String(MATERIAL_WIN_PAIRS)} repeated wins before calling the marginal evidence promising`,
    ]);
  }

  return result(input, 'promising', true, covered, 0, [
    `${String(input.evidence.optimizedBetter)} completed evidence-bearing pairs favor the candidate with no baseline wins`,
    `evidence spans ${String(covered.length)} task classes at ${String(coverage)}% coverage`,
    'this is a selection signal only; lifecycle, compatibility, distinctness and combined-stack gates remain separate',
  ]);
}
