import { isTaskBenchmarkId } from './benchmark.js';
import {
  type CrossHarnessTransferAssessment,
  type CrossHarnessTransferBasis,
} from './cross-harness-transfer.js';
import { type TransferBenefitState } from './cross-harness-scheduler.js';
import { isDigest } from './digest.js';
import { isHarnessId, type HarnessId } from './ids.js';
import { isTaskClass, type TaskClass } from './optimizer.js';

export const CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION = 1;

export interface CrossHarnessTransferReceipt {
  schemaVersion: typeof CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION;
  benchmarkId: string;
  /** Machine-local stable project id. Raw project paths are never persisted. */
  projectId: string;
  taskClass: TaskClass;
  currentHarness: HarnessId;
  candidateHarness: HarnessId;
  /** Actual compact-handoff size used by the measured switched run. */
  handoffBytes: number;
  /** SHA-256 of the exact handoff bytes evaluated when this receipt was recorded. */
  handoffDigest: string;
  maxHandoffBytes: number;
  benefit: TransferBenefitState;
  basis: CrossHarnessTransferBasis;
  reasons: string[];
  recordedAt: string;
}

export type CrossHarnessTransferReceiptParseResult =
  | { ok: true; receipt: CrossHarnessTransferReceipt }
  | { ok: false; reason: 'unsupported-schema' | 'invalid-shape'; message: string };

const BENEFITS = new Set<TransferBenefitState>(['proven-positive', 'non-positive', 'unknown']);
const BASES = new Set<CrossHarnessTransferBasis>([
  'identity',
  'handoff-budget',
  'quality',
  'failed-attempts',
  'runtime-errors',
  'attempts',
  'none',
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/**
 * Freeze one already-evaluated empirical transfer into a project-scoped receipt.
 *
 * This does not reinterpret the assessment. In particular, it never derives transfer benefit from
 * provider quota percentages or local token counts; that decision belongs exclusively to the
 * conservative comparator that produced `assessment`.
 */
export function buildCrossHarnessTransferReceipt(input: {
  projectId: string;
  handoffDigest: string;
  recordedAt: string;
  assessment: CrossHarnessTransferAssessment;
  taskClass: TaskClass;
}): CrossHarnessTransferReceipt {
  return {
    schemaVersion: CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION,
    benchmarkId: input.assessment.benchmarkId,
    projectId: input.projectId,
    taskClass: input.taskClass,
    currentHarness: input.assessment.currentHarness,
    candidateHarness: input.assessment.candidateHarness,
    handoffBytes: input.assessment.handoffBytes,
    handoffDigest: input.handoffDigest,
    maxHandoffBytes: input.assessment.maxHandoffBytes,
    benefit: input.assessment.benefit,
    basis: input.assessment.basis,
    reasons: [...input.assessment.reasons],
    recordedAt: input.recordedAt,
  };
}

/** Runtime parser for immutable local cross-harness transfer evidence. */
export function parseCrossHarnessTransferReceipt(
  value: unknown,
): CrossHarnessTransferReceiptParseResult {
  const row = record(value);
  if (row === null) {
    return { ok: false, reason: 'invalid-shape', message: 'transfer receipt must be a JSON object' };
  }
  if (row['schemaVersion'] !== CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      message: `transfer receipt schemaVersion must be ${String(CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION)}`,
    };
  }

  const benchmarkId = row['benchmarkId'];
  const projectId = row['projectId'];
  const taskClass = row['taskClass'];
  const currentHarness = row['currentHarness'];
  const candidateHarness = row['candidateHarness'];
  const handoffBytes = row['handoffBytes'];
  const handoffDigest = row['handoffDigest'];
  const maxHandoffBytes = row['maxHandoffBytes'];
  const benefit = row['benefit'];
  const basis = row['basis'];
  const reasons = row['reasons'];
  const recordedAt = row['recordedAt'];

  if (
    typeof benchmarkId !== 'string' ||
    !isTaskBenchmarkId(benchmarkId) ||
    typeof projectId !== 'string' ||
    projectId === '' ||
    typeof taskClass !== 'string' ||
    !isTaskClass(taskClass) ||
    typeof currentHarness !== 'string' ||
    !isHarnessId(currentHarness) ||
    typeof candidateHarness !== 'string' ||
    !isHarnessId(candidateHarness) ||
    currentHarness === candidateHarness ||
    typeof handoffBytes !== 'number' ||
    !Number.isInteger(handoffBytes) ||
    handoffBytes < 0 ||
    typeof handoffDigest !== 'string' ||
    !isDigest(handoffDigest) ||
    typeof maxHandoffBytes !== 'number' ||
    !Number.isInteger(maxHandoffBytes) ||
    maxHandoffBytes <= 0 ||
    typeof benefit !== 'string' ||
    !BENEFITS.has(benefit as TransferBenefitState) ||
    typeof basis !== 'string' ||
    !BASES.has(basis as CrossHarnessTransferBasis) ||
    !Array.isArray(reasons) ||
    reasons.length < 1 ||
    !reasons.every((reason) => typeof reason === 'string' && reason.length > 0) ||
    !validInstant(recordedAt)
  ) {
    return {
      ok: false,
      reason: 'invalid-shape',
      message: 'transfer receipt fields do not match the cross-harness evidence contract',
    };
  }

  return {
    ok: true,
    receipt: {
      schemaVersion: CROSS_HARNESS_TRANSFER_RECEIPT_SCHEMA_VERSION,
      benchmarkId,
      projectId,
      taskClass,
      currentHarness,
      candidateHarness,
      handoffBytes,
      handoffDigest,
      maxHandoffBytes,
      benefit: benefit as TransferBenefitState,
      basis: basis as CrossHarnessTransferBasis,
      reasons: [...reasons] as string[],
      recordedAt,
    },
  };
}
