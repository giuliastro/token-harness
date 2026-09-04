import type { TaskBenchmarkReceipt } from './benchmark.js';
import type { TransferBenefitState } from './cross-harness-scheduler.js';

/**
 * Empirical assessment of an in-progress cross-harness handoff.
 *
 * The two runs must be an explicitly paired benchmark: baseline means "stay on the current
 * harness" and optimized means "switch to the candidate using the compact handoff". Claude and
 * Codex quota percentages are independent budget domains, so this comparator never subtracts or
 * ranks backend quota deltas across the two harnesses. Local token counts are likewise not used to
 * prove transfer benefit.
 */
export type CrossHarnessTransferBasis =
  | 'identity'
  | 'handoff-budget'
  | 'quality'
  | 'failed-attempts'
  | 'runtime-errors'
  | 'attempts'
  | 'none';

export interface CrossHarnessTransferAssessment {
  benefit: TransferBenefitState;
  basis: CrossHarnessTransferBasis;
  benchmarkId: string;
  currentHarness: TaskBenchmarkReceipt['harnessId'];
  candidateHarness: TaskBenchmarkReceipt['harnessId'];
  handoffBytes: number;
  maxHandoffBytes: number;
  reasons: string[];
}

export interface CrossHarnessTransferExperimentInput {
  /** Control run: finish the comparable task on the current harness. */
  stay: TaskBenchmarkReceipt;
  /** Transfer run: continue the comparable task on the candidate with the compact handoff. */
  switched: TaskBenchmarkReceipt;
  /** Actual UTF-8 byte size of the compact handoff used by the switched run. */
  handoffBytes: number;
  /** Configured maximum compact-handoff size for the experiment. */
  maxHandoffBytes: number;
}

function assessment(
  input: CrossHarnessTransferExperimentInput,
  benefit: TransferBenefitState,
  basis: CrossHarnessTransferBasis,
  reasons: string[],
): CrossHarnessTransferAssessment {
  return {
    benefit,
    basis,
    benchmarkId: input.stay.benchmarkId,
    currentHarness: input.stay.harnessId,
    candidateHarness: input.switched.harnessId,
    handoffBytes: input.handoffBytes,
    maxHandoffBytes: input.maxHandoffBytes,
    reasons,
  };
}

function validPair(input: CrossHarnessTransferExperimentInput): string | null {
  if (
    input.stay.benchmarkId !== input.switched.benchmarkId ||
    input.stay.taskClass !== input.switched.taskClass ||
    input.stay.variant !== 'baseline' ||
    input.switched.variant !== 'optimized'
  ) {
    return 'runs are not the same benchmark/task class with baseline=stay and optimized=switch';
  }
  if (input.stay.harnessId === input.switched.harnessId) {
    return 'a cross-harness transfer experiment requires different current and candidate harnesses';
  }
  return null;
}

/**
 * Decide whether a measured handoff has positive, non-positive, or unknown transfer benefit.
 *
 * Common-unit evidence is deliberately narrow:
 * - a quality improvement/regression;
 * - failed-attempt count;
 * - normalized runtime/provider error count;
 * - total attempt count.
 *
 * These observations can be compared across harnesses without pretending their subscription quota
 * percentages or tokenizer-specific local token counts are commensurate. A tie is not evidence of
 * a quota win: it stays unknown until a stronger comparable experiment exists.
 */
export function assessCrossHarnessTransferBenefit(
  input: CrossHarnessTransferExperimentInput,
): CrossHarnessTransferAssessment {
  const pairProblem = validPair(input);
  if (pairProblem !== null) {
    return assessment(input, 'unknown', 'identity', [pairProblem]);
  }

  if (
    !Number.isInteger(input.handoffBytes) ||
    input.handoffBytes < 0 ||
    !Number.isInteger(input.maxHandoffBytes) ||
    input.maxHandoffBytes <= 0
  ) {
    return assessment(input, 'unknown', 'handoff-budget', ['handoff byte evidence is invalid']);
  }
  if (input.handoffBytes > input.maxHandoffBytes) {
    return assessment(input, 'non-positive', 'handoff-budget', [
      `compact handoff is ${String(input.handoffBytes)} bytes, above the ${String(input.maxHandoffBytes)}-byte experiment budget`,
    ]);
  }

  const stayQuality = input.stay.outcome.qualityGate;
  const switchedQuality = input.switched.outcome.qualityGate;
  if (stayQuality === 'passed' && switchedQuality === 'failed') {
    return assessment(input, 'non-positive', 'quality', [
      'switched run failed a quality gate that the stay run passed',
    ]);
  }
  if (stayQuality === 'failed' && switchedQuality === 'passed') {
    return assessment(input, 'proven-positive', 'quality', [
      'switched run passed a quality gate that the stay run failed',
    ]);
  }
  if (switchedQuality === 'failed') {
    return assessment(input, 'non-positive', 'quality', [
      'switched run failed its explicit quality gate, so the transfer is not positive',
    ]);
  }
  if (stayQuality !== 'passed' || switchedQuality !== 'passed') {
    return assessment(input, 'unknown', 'quality', [
      'both runs must have known quality before secondary transfer evidence can decide',
    ]);
  }

  if (input.switched.outcome.failedAttempts !== input.stay.outcome.failedAttempts) {
    const positive = input.switched.outcome.failedAttempts < input.stay.outcome.failedAttempts;
    return assessment(input, positive ? 'proven-positive' : 'non-positive', 'failed-attempts', [
      positive
        ? 'switched run reached the quality gate with fewer failed attempts'
        : 'switched run required more failed attempts',
    ]);
  }

  if (input.switched.outcome.errorCodes.length !== input.stay.outcome.errorCodes.length) {
    const positive =
      input.switched.outcome.errorCodes.length < input.stay.outcome.errorCodes.length;
    return assessment(input, positive ? 'proven-positive' : 'non-positive', 'runtime-errors', [
      positive
        ? 'switched run recorded fewer runtime/provider errors'
        : 'switched run recorded more runtime/provider errors',
    ]);
  }

  if (input.switched.outcome.attempts !== input.stay.outcome.attempts) {
    const positive = input.switched.outcome.attempts < input.stay.outcome.attempts;
    return assessment(input, positive ? 'proven-positive' : 'non-positive', 'attempts', [
      positive
        ? 'switched run completed the quality-gated task in fewer attempts'
        : 'switched run required more attempts',
    ]);
  }

  return assessment(input, 'unknown', 'none', [
    'quality and comparable attempt/error evidence were equal',
    'cross-harness quota percentages and local token counts are intentionally not compared',
  ]);
}
