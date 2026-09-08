import type { HarnessId } from './ids.js';
import type { PaceState, TaskClass } from './optimizer.js';

/**
 * RFC 0011 Phase 18.7 cross-harness scheduling policy.
 *
 * The scheduler deliberately consumes already-assessed evidence rather than comparing raw Claude
 * and Codex percentages. A 40% Claude bucket and a 40% Codex bucket are not known to represent the
 * same amount of work, so they must never be subtracted or ranked here.
 */

export type CrossHarnessDecisionKind = 'switch' | 'stay' | 'insufficient-evidence';
export type TransferBenefitState = 'proven-positive' | 'non-positive' | 'unknown';
export type QualityEvidenceState = 'passed' | 'failed' | 'unknown';

export interface HarnessSchedulingEvidence {
  harnessId: HarnessId;
  /** Whether this harness is currently usable for the task. */
  available: boolean;
  /** Independently assessed against this harness's own five-hour allowance. */
  fiveHourPace: PaceState;
  /** Independently assessed against this harness's own weekly allowance. */
  weeklyPace: PaceState;
  /** Quality-gated evidence, if any. */
  quality: QualityEvidenceState;
  /** Task class that the quality evidence actually measured. Null means no attributable evidence. */
  qualityTaskClass: TaskClass | null;
  /** Number of empirical quality-passed/failed observations behind `quality`. */
  qualitySamples: number;
  /**
   * Optional conservative whole-task capacity derived inside this harness's own quota domain.
   * Null/undefined means unknown. Zero means the measured safe allowance is below one empirical
   * quality-passed task equivalent for this task class.
   */
  acceptedTasksRemaining?: number | null;
}

export interface CrossHarnessTransferEvidence {
  /** Actual compact-handoff size, not the source transcript size. */
  handoffBytes: number;
  /** Configured maximum transfer budget. */
  maxHandoffBytes: number;
  /**
   * Whether comparable empirical evidence says the switch benefit exceeds its transfer cost.
   * The producer owns the comparison and its measurement unit; this policy never manufactures a
   * token-to-subscription-quota conversion.
   */
  benefit: TransferBenefitState;
}

export interface CrossHarnessSchedulerInput {
  taskClass: TaskClass;
  /** Explicit accepted tasks that should fit without assuming capacity after a future reset. */
  tasksRemaining?: number | null;
  current: HarnessSchedulingEvidence;
  candidate: HarnessSchedulingEvidence;
  transfer: CrossHarnessTransferEvidence;
}

export interface CrossHarnessDecisionReason {
  code: string;
  summary: string;
}

export interface CrossHarnessSchedulerDecision {
  decision: CrossHarnessDecisionKind;
  tasksRemaining: number | null;
  currentHarness: HarnessId;
  candidateHarness: HarnessId;
  taskClass: TaskClass;
  reasons: CrossHarnessDecisionReason[];
}

function reason(code: string, summary: string): CrossHarnessDecisionReason {
  return { code, summary };
}

function hasPressure(evidence: HarnessSchedulingEvidence, tasksRemaining: number | null): boolean {
  return (
    evidence.fiveHourPace === 'over-pace' ||
    evidence.weeklyPace === 'over-pace' ||
    evidence.acceptedTasksRemaining === 0 ||
    (tasksRemaining !== null &&
      evidence.acceptedTasksRemaining !== undefined &&
      evidence.acceptedTasksRemaining !== null &&
      evidence.acceptedTasksRemaining < tasksRemaining)
  );
}

function hasSafeHeadroom(
  evidence: HarnessSchedulingEvidence,
  tasksRemaining: number | null,
): boolean {
  const live = [evidence.fiveHourPace, evidence.weeklyPace];
  return (
    live.every((state) => state === 'under-pace' || state === 'on-pace') &&
    evidence.acceptedTasksRemaining !== 0 &&
    (tasksRemaining === null ||
      (evidence.acceptedTasksRemaining !== undefined &&
        evidence.acceptedTasksRemaining !== null &&
        evidence.acceptedTasksRemaining >= tasksRemaining))
  );
}

function validateTransfer(
  transfer: CrossHarnessTransferEvidence,
): CrossHarnessDecisionReason | null {
  if (
    !Number.isInteger(transfer.handoffBytes) ||
    transfer.handoffBytes < 0 ||
    !Number.isInteger(transfer.maxHandoffBytes) ||
    transfer.maxHandoffBytes <= 0
  ) {
    return reason('invalid-transfer-evidence', 'handoff byte evidence is invalid');
  }
  if (transfer.handoffBytes > transfer.maxHandoffBytes) {
    return reason(
      'handoff-over-budget',
      `compact handoff is ${transfer.handoffBytes} bytes, above the ${transfer.maxHandoffBytes}-byte transfer budget`,
    );
  }
  return null;
}

function validateQuality(
  evidence: HarnessSchedulingEvidence,
  taskClass: TaskClass,
): CrossHarnessDecisionReason | null {
  if (!Number.isInteger(evidence.qualitySamples) || evidence.qualitySamples < 0) {
    return reason('invalid-quality-evidence', 'quality sample count is invalid');
  }
  if (evidence.quality === 'unknown') return null;
  if (evidence.qualitySamples < 1 || evidence.qualityTaskClass === null) {
    return reason(
      'candidate-quality-unattributed',
      'candidate quality evidence is not attributable to a measured task class',
    );
  }
  if (evidence.qualityTaskClass !== taskClass) {
    return reason(
      'candidate-quality-task-mismatch',
      `candidate quality evidence covers ${evidence.qualityTaskClass}, not ${taskClass}`,
    );
  }
  return null;
}

function validateCapacity(
  evidence: HarnessSchedulingEvidence,
  subject: 'current' | 'candidate',
): CrossHarnessDecisionReason | null {
  const value = evidence.acceptedTasksRemaining;
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    return reason(
      'invalid-capacity-evidence',
      `${subject} accepted-task capacity must be a non-negative whole number when present`,
    );
  }
  return null;
}

/**
 * Recommend switching only when every required dimension is positively evidenced:
 *
 * - the current harness is under allowance pressure, including measured capacity below one task;
 * - the candidate is available and has independently assessed headroom;
 * - quality for the same task class is empirically passed;
 * - the compact handoff fits its configured budget;
 * - comparable evidence says the transfer benefit exceeds the transfer cost.
 *
 * Unknown or malformed evidence does not become a negative recommendation; it becomes
 * `insufficient-evidence`.
 */
export function scheduleCrossHarness(
  input: CrossHarnessSchedulerInput,
): CrossHarnessSchedulerDecision {
  const tasksRemaining = input.tasksRemaining ?? null;
  const base = {
    tasksRemaining,
    currentHarness: input.current.harnessId,
    candidateHarness: input.candidate.harnessId,
    taskClass: input.taskClass,
  };

  if (input.current.harnessId === input.candidate.harnessId) {
    return {
      ...base,
      decision: 'stay',
      reasons: [reason('same-harness', 'the candidate is the current harness')],
    };
  }

  const transferProblem = validateTransfer(input.transfer);
  if (transferProblem !== null) {
    return {
      ...base,
      decision: transferProblem.code === 'handoff-over-budget' ? 'stay' : 'insufficient-evidence',
      reasons: [transferProblem],
    };
  }

  if (!input.candidate.available) {
    return {
      ...base,
      decision: 'stay',
      reasons: [reason('candidate-unavailable', 'the candidate harness is not currently usable')],
    };
  }

  if (tasksRemaining !== null && (!Number.isSafeInteger(tasksRemaining) || tasksRemaining <= 0)) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      reasons: [
        reason(
          'invalid-workload-target',
          'remaining workload must be a positive whole number of accepted tasks',
        ),
      ],
    };
  }

  const currentCapacityProblem = validateCapacity(input.current, 'current');
  const candidateCapacityProblem = validateCapacity(input.candidate, 'candidate');
  if (currentCapacityProblem !== null || candidateCapacityProblem !== null) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      reasons: [currentCapacityProblem ?? candidateCapacityProblem!],
    };
  }

  const qualityProblem = validateQuality(input.candidate, input.taskClass);
  if (qualityProblem !== null) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      reasons: [qualityProblem],
    };
  }

  if (input.candidate.quality === 'failed') {
    return {
      ...base,
      decision: 'stay',
      reasons: [
        reason(
          'candidate-quality-failed',
          'quality-gated evidence rejects the candidate for this task class',
        ),
      ],
    };
  }

  if (!hasPressure(input.current, tasksRemaining)) {
    if (
      tasksRemaining !== null &&
      (input.current.acceptedTasksRemaining === undefined ||
        input.current.acceptedTasksRemaining === null)
    ) {
      return {
        ...base,
        decision: 'insufficient-evidence',
        reasons: [
          reason(
            'current-workload-capacity-unknown',
            'current harness capacity for the stated remaining workload is unknown',
          ),
        ],
      };
    }
    if (input.current.fiveHourPace === 'unknown' || input.current.weeklyPace === 'unknown') {
      return {
        ...base,
        decision: 'insufficient-evidence',
        reasons: [
          reason(
            'current-quota-unknown',
            'current harness allowance pressure is not known well enough to justify a switch',
          ),
        ],
      };
    }
    return {
      ...base,
      decision: 'stay',
      reasons: [reason('current-headroom-healthy', 'the current harness is not over pace')],
    };
  }

  if (!hasSafeHeadroom(input.candidate, tasksRemaining)) {
    if (
      tasksRemaining !== null &&
      (input.candidate.acceptedTasksRemaining === undefined ||
        input.candidate.acceptedTasksRemaining === null)
    ) {
      return {
        ...base,
        decision: 'insufficient-evidence',
        reasons: [
          reason(
            'candidate-workload-capacity-unknown',
            'candidate capacity for the stated remaining workload is unknown',
          ),
        ],
      };
    }
    if (
      tasksRemaining !== null &&
      input.candidate.acceptedTasksRemaining !== undefined &&
      input.candidate.acceptedTasksRemaining !== null &&
      input.candidate.acceptedTasksRemaining < tasksRemaining
    ) {
      return {
        ...base,
        decision: 'stay',
        reasons: [
          reason(
            'candidate-capacity-below-workload',
            `candidate has ${String(input.candidate.acceptedTasksRemaining)} accepted-task equivalents for ${String(tasksRemaining)} stated task(s)`,
          ),
        ],
      };
    }
    if (input.candidate.acceptedTasksRemaining === 0) {
      return {
        ...base,
        decision: 'stay',
        reasons: [
          reason(
            'candidate-capacity-below-one',
            'candidate safe allowance is below one empirical accepted-task equivalent',
          ),
        ],
      };
    }
    if (input.candidate.fiveHourPace === 'unknown' || input.candidate.weeklyPace === 'unknown') {
      return {
        ...base,
        decision: 'insufficient-evidence',
        reasons: [
          reason(
            'candidate-quota-unknown',
            'candidate allowance headroom is not known well enough to justify a switch',
          ),
        ],
      };
    }
    return {
      ...base,
      decision: 'stay',
      reasons: [
        reason(
          'candidate-over-pace',
          'the candidate is already over pace in an observed allowance window',
        ),
      ],
    };
  }

  if (input.candidate.quality === 'unknown' || input.candidate.qualitySamples < 1) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      reasons: [
        reason(
          'candidate-quality-unknown',
          'no quality-gated empirical result proves the candidate for this task class',
        ),
      ],
    };
  }

  if (input.transfer.benefit === 'non-positive') {
    return {
      ...base,
      decision: 'stay',
      reasons: [
        reason(
          'transfer-cost-not-worth-it',
          'comparable evidence says the expected switch benefit does not exceed handoff cost',
        ),
      ],
    };
  }

  if (input.transfer.benefit === 'unknown') {
    return {
      ...base,
      decision: 'insufficient-evidence',
      reasons: [
        reason(
          'transfer-benefit-unknown',
          'no comparable evidence proves that the expected switch benefit exceeds handoff cost',
        ),
      ],
    };
  }

  const reasons = [
    tasksRemaining !== null &&
    input.current.acceptedTasksRemaining !== undefined &&
    input.current.acceptedTasksRemaining !== null &&
    input.current.acceptedTasksRemaining < tasksRemaining
      ? reason(
          'current-capacity-below-workload',
          `current harness has ${String(input.current.acceptedTasksRemaining)} accepted-task equivalents for ${String(tasksRemaining)} stated task(s)`,
        )
      : input.current.acceptedTasksRemaining === 0
        ? reason(
            'current-capacity-below-one',
            'current safe allowance is below one empirical accepted-task equivalent',
          )
        : reason(
            'current-over-pace',
            'the current harness is over pace in at least one observed allowance window',
          ),
    reason(
      'candidate-headroom',
      'the candidate is on pace or under pace in its observed allowance windows',
    ),
  ];
  if (
    input.candidate.acceptedTasksRemaining !== undefined &&
    input.candidate.acceptedTasksRemaining !== null
  ) {
    reasons.push(
      tasksRemaining !== null
        ? reason(
            'candidate-workload-covered',
            `candidate has ${String(input.candidate.acceptedTasksRemaining)} accepted-task equivalents for ${String(tasksRemaining)} stated task(s)`,
          )
        : reason(
            'candidate-capacity-sufficient',
            `candidate has ${String(input.candidate.acceptedTasksRemaining)} conservative accepted-task equivalents remaining`,
          ),
    );
  }
  reasons.push(
    reason(
      'candidate-quality-passed',
      'quality-gated empirical evidence passes for this task class',
    ),
    reason(
      'transfer-benefit-positive',
      'comparable evidence says expected switch benefit exceeds handoff cost',
    ),
  );
  return {
    ...base,
    decision: 'switch',
    reasons,
  };
}
