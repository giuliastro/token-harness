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
  /** Quality-gated evidence for this exact task class. */
  quality: QualityEvidenceState;
  /** Number of empirical quality-passed/failed observations behind `quality`. */
  qualitySamples: number;
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
  currentHarness: HarnessId;
  candidateHarness: HarnessId;
  taskClass: TaskClass;
  reasons: CrossHarnessDecisionReason[];
}

function reason(code: string, summary: string): CrossHarnessDecisionReason {
  return { code, summary };
}

function hasPressure(evidence: HarnessSchedulingEvidence): boolean {
  return evidence.fiveHourPace === 'over-pace' || evidence.weeklyPace === 'over-pace';
}

function hasSafeHeadroom(evidence: HarnessSchedulingEvidence): boolean {
  const live = [evidence.fiveHourPace, evidence.weeklyPace];
  return live.every((state) => state === 'under-pace' || state === 'on-pace');
}

function validateTransfer(transfer: CrossHarnessTransferEvidence): CrossHarnessDecisionReason | null {
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

/**
 * Recommend switching only when every required dimension is positively evidenced:
 *
 * - the current harness is under allowance pressure;
 * - the candidate is available and has independently assessed headroom;
 * - quality for the same task class is empirically passed;
 * - the compact handoff fits its configured budget;
 * - comparable evidence says the transfer benefit exceeds the transfer cost.
 *
 * Unknown evidence does not become a negative recommendation; it becomes `insufficient-evidence`.
 */
export function scheduleCrossHarness(input: CrossHarnessSchedulerInput): CrossHarnessSchedulerDecision {
  const base = {
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
    return { ...base, decision: 'stay', reasons: [transferProblem] };
  }

  if (!input.candidate.available) {
    return {
      ...base,
      decision: 'stay',
      reasons: [reason('candidate-unavailable', 'the candidate harness is not currently usable')],
    };
  }

  if (input.candidate.quality === 'failed') {
    return {
      ...base,
      decision: 'stay',
      reasons: [reason('candidate-quality-failed', 'quality-gated evidence rejects the candidate for this task class')],
    };
  }

  if (!hasPressure(input.current)) {
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

  if (!hasSafeHeadroom(input.candidate)) {
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
      reasons: [reason('candidate-over-pace', 'the candidate is already over pace in an observed allowance window')],
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

  return {
    ...base,
    decision: 'switch',
    reasons: [
      reason('current-over-pace', 'the current harness is over pace in at least one observed allowance window'),
      reason('candidate-headroom', 'the candidate is on pace or under pace in its observed allowance windows'),
      reason('candidate-quality-passed', 'quality-gated empirical evidence passes for this task class'),
      reason('transfer-benefit-positive', 'comparable evidence says expected switch benefit exceeds handoff cost'),
    ],
  };
}
