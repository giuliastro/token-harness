import type { TaskBenchmarkReceipt } from './benchmark.js';
import type {
  CrossHarnessSchedulerInput,
  QualityEvidenceState,
} from './cross-harness-scheduler.js';
import type { HarnessId } from './ids.js';
import type { TaskClass } from './optimizer.js';

export interface SchedulerQualityEvidenceNote {
  code: string;
  harnessId: HarnessId;
  taskClass: TaskClass;
  summary: string;
}

export interface CrossHarnessQualityHydration {
  input: CrossHarnessSchedulerInput;
  notes: SchedulerQualityEvidenceNote[];
}

function note(
  code: string,
  harnessId: HarnessId,
  taskClass: TaskClass,
  summary: string,
): SchedulerQualityEvidenceNote {
  return { code, harnessId, taskClass, summary };
}

function hasExplicitQualityEvidence(input: CrossHarnessSchedulerInput): boolean {
  return (
    input.candidate.quality !== 'unknown' ||
    input.candidate.qualityTaskClass !== null ||
    input.candidate.qualitySamples !== 0
  );
}

function uniqueMatchingReceipts(
  input: CrossHarnessSchedulerInput,
  receipts: readonly TaskBenchmarkReceipt[],
): TaskBenchmarkReceipt[] {
  const unique = new Map<string, TaskBenchmarkReceipt>();
  for (const receipt of receipts) {
    if (
      receipt.harnessId !== input.candidate.harnessId ||
      receipt.taskClass !== input.taskClass ||
      receipt.outcome.qualityGate === 'unknown'
    ) {
      continue;
    }
    unique.set(`${receipt.benchmarkId}\u0000${receipt.variant}`, receipt);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.benchmarkId.localeCompare(right.benchmarkId) ||
      left.variant.localeCompare(right.variant),
  );
}

/**
 * Fill only missing candidate-quality evidence from explicit quality-gated benchmark receipts.
 *
 * The adapter does not compare token volume, quota percentages, benchmark efficiency verdicts, or
 * models across providers. Receipts must already be selected by the caller for the relevant project.
 * A candidate is `passed` only when every attributable known quality observation passed, `failed`
 * only when every one failed, and `unknown` when observations conflict or none exist.
 */
export function hydrateCandidateQualityFromBenchmarkReceipts(
  input: CrossHarnessSchedulerInput,
  receipts: readonly TaskBenchmarkReceipt[],
): CrossHarnessQualityHydration {
  if (hasExplicitQualityEvidence(input)) {
    return {
      input,
      notes: [
        note(
          'explicit-quality-preserved',
          input.candidate.harnessId,
          input.taskClass,
          'explicit candidate quality evidence was preserved',
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
          'benchmark-quality-unavailable',
          input.candidate.harnessId,
          input.taskClass,
          'no attributable quality-gated benchmark receipt covers the candidate and task class',
        ),
      ],
    };
  }

  const passed = matching.filter((receipt) => receipt.outcome.qualityGate === 'passed').length;
  const failed = matching.filter((receipt) => receipt.outcome.qualityGate === 'failed').length;
  let quality: QualityEvidenceState = 'unknown';
  let code = 'benchmark-quality-conflicting';
  let summary = `quality evidence conflicts across ${String(matching.length)} attributable observations`;

  if (failed === 0 && passed > 0) {
    quality = 'passed';
    code = 'benchmark-quality-passed';
    summary = `${String(passed)} attributable quality-gated observation(s) passed`;
  } else if (passed === 0 && failed > 0) {
    quality = 'failed';
    code = 'benchmark-quality-failed';
    summary = `${String(failed)} attributable quality-gated observation(s) failed`;
  }

  return {
    input: {
      ...input,
      candidate: {
        ...input.candidate,
        quality,
        qualityTaskClass: input.taskClass,
        qualitySamples: matching.length,
      },
      transfer: { ...input.transfer },
    },
    notes: [note(code, input.candidate.harnessId, input.taskClass, summary)],
  };
}
