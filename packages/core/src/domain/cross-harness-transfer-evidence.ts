import type { CrossHarnessSchedulerInput, TransferBenefitState } from './cross-harness-scheduler.js';
import type { CrossHarnessTransferReceipt } from './cross-harness-transfer-receipt.js';
import type { HarnessId } from './ids.js';
import type { TaskClass } from './optimizer.js';

export interface SchedulerTransferEvidenceNote {
  code: string;
  currentHarness: HarnessId;
  candidateHarness: HarnessId;
  taskClass: TaskClass;
  samples: number;
  summary: string;
}

export interface CrossHarnessTransferEvidenceHydration {
  input: CrossHarnessSchedulerInput;
  notes: SchedulerTransferEvidenceNote[];
}

function note(
  code: string,
  input: CrossHarnessSchedulerInput,
  samples: number,
  summary: string,
): SchedulerTransferEvidenceNote {
  return {
    code,
    currentHarness: input.current.harnessId,
    candidateHarness: input.candidate.harnessId,
    taskClass: input.taskClass,
    samples,
    summary,
  };
}

function uniqueMatchingReceipts(
  input: CrossHarnessSchedulerInput,
  receipts: readonly CrossHarnessTransferReceipt[],
): CrossHarnessTransferReceipt[] {
  const unique = new Map<string, CrossHarnessTransferReceipt>();
  for (const receipt of receipts) {
    if (
      receipt.currentHarness !== input.current.harnessId ||
      receipt.candidateHarness !== input.candidate.harnessId ||
      receipt.taskClass !== input.taskClass
    ) {
      continue;
    }
    unique.set(receipt.benchmarkId, receipt);
  }
  return [...unique.values()].sort((left, right) => left.benchmarkId.localeCompare(right.benchmarkId));
}

/**
 * Fill missing transfer-benefit evidence from immutable, already project-scoped receipts.
 *
 * The rule is deliberately stricter than simple majority voting: every matching receipt must agree
 * on the same non-unknown verdict. Any mix, including known + unknown, remains unknown. The adapter
 * never compares provider quota percentages, token volumes, or receipt timestamps and it never
 * changes the current handoff byte estimate supplied to the scheduler.
 */
export function hydrateTransferBenefitFromReceipts(
  input: CrossHarnessSchedulerInput,
  receipts: readonly CrossHarnessTransferReceipt[],
): CrossHarnessTransferEvidenceHydration {
  if (input.transfer.benefit !== 'unknown') {
    return {
      input,
      notes: [
        note(
          'explicit-transfer-benefit-preserved',
          input,
          0,
          'explicit transfer-benefit evidence was preserved',
        ),
      ],
    };
  }

  const matching = uniqueMatchingReceipts(input, receipts);
  if (matching.length === 0) {
    return {
      input,
      notes: [
        note(
          'transfer-evidence-unavailable',
          input,
          0,
          'no attributable transfer receipt covers the exact route and task class',
        ),
      ],
    };
  }

  const benefits = new Set<TransferBenefitState>(matching.map((receipt) => receipt.benefit));
  let benefit: TransferBenefitState = 'unknown';
  let code = 'transfer-evidence-inconclusive';
  let summary = `transfer evidence is not unanimous across ${String(matching.length)} attributable receipt(s)`;

  if (benefits.size === 1 && benefits.has('proven-positive')) {
    benefit = 'proven-positive';
    code = 'transfer-evidence-positive';
    summary = `${String(matching.length)} attributable transfer receipt(s) are unanimously proven-positive`;
  } else if (benefits.size === 1 && benefits.has('non-positive')) {
    benefit = 'non-positive';
    code = 'transfer-evidence-non-positive';
    summary = `${String(matching.length)} attributable transfer receipt(s) are unanimously non-positive`;
  } else if (benefits.has('proven-positive') && benefits.has('non-positive')) {
    code = 'transfer-evidence-conflicting';
    summary = `transfer evidence conflicts across ${String(matching.length)} attributable receipt(s)`;
  }

  return {
    input: {
      ...input,
      current: { ...input.current },
      candidate: { ...input.candidate },
      transfer: { ...input.transfer, benefit },
    },
    notes: [note(code, input, matching.length, summary)],
  };
}
