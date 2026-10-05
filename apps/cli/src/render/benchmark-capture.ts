/**
 * Human rendering for two-phase benchmark capture.
 */

import type {
  OptimizationCandidateId,
  TaskBenchmarkCaptureFinishReport,
  TaskBenchmarkCaptureStartReport,
} from '@token-harness/core';

import {
  MAX_WIDTH,
  displayPath,
  document,
  truncatePath,
  wrap,
  type RenderContext,
} from './layout.js';

type CandidateAwareStartReport = TaskBenchmarkCaptureStartReport & {
  /** Experiment target only. This is not proof that the candidate was active. */
  candidateId?: OptimizationCandidateId;
};

function candidateNextStep(report: CandidateAwareStartReport): string[] {
  const { capture, candidateId } = report;
  if (candidateId === undefined) return [];

  if (capture.variant === 'baseline') {
    return [
      '',
      ...wrap(
        `Candidate target: ${candidateId}. Token Harness records this experiment label but does not enable, disable, or prove the candidate is active.`,
        0,
      ),
      ...wrap(
        capture.qualityCheck !== undefined
          ? `After finishing the baseline, enable ${candidateId} and start the optimized capture with the same --check-command and --check-timeout options.`
          : `After finishing the baseline, enable ${candidateId} with its own documented workflow and start the optimized run from the same project: token-harness benchmark-start --benchmark-id ${capture.benchmarkId} --candidate ${candidateId} --variant optimized --task ${capture.taskClass} --harness ${capture.harnessId}`,
        0,
      ),
    ];
  }

  return [
    '',
    ...wrap(
      `Candidate target: ${candidateId}. Token Harness records this experiment label but does not prove the candidate is active.`,
      0,
    ),
    ...wrap(
      `After finishing this optimized run, review the experimental scorecard with: token-harness benchmark-matrix --harness ${capture.harnessId} --task ${capture.taskClass}`,
      0,
    ),
  ];
}

export function renderBenchmarkStartReport(
  report: CandidateAwareStartReport,
  context: RenderContext,
): string {
  const { capture } = report;
  const capturePath = truncatePath(
    displayPath(report.capturePath, context.home),
    MAX_WIDTH - 'Capture: '.length,
  );
  return document([
    `Benchmark start — ${capture.benchmarkId} / ${capture.variant}`,
    `${capture.taskClass} on ${capture.harnessId}`,
    '',
    ...wrap(
      `Policy: model ${capture.model ?? 'unknown'}, effort ${capture.reasoningEffort ?? 'unknown'}, verbosity ${capture.verbosity ?? 'unknown'}`,
      0,
    ),
    `Quota windows captured: ${String(capture.usageBefore.length)}`,
    `Capture: ${capturePath}`,
    ...(capture.experiment === undefined
      ? []
      : wrap(
          `Exploratory factorial arm: compression ${capture.experiment.compression ? 'on' : 'off'}, routing ${capture.experiment.routing ? 'on' : 'off'}; starting state ${capture.experiment.startingState} (user-declared)`,
          0,
        )),
    ...(capture.qualityCheck === undefined
      ? []
      : wrap(
          `Check plan: ${JSON.stringify([capture.qualityCheck.executable, ...capture.qualityCheck.args])}; timeout ${capture.qualityCheck.timeoutMs}ms. Finish without --yes to preview; --yes runs this saved command.`,
          0,
        )),
    '',
    ...wrap(
      `Run the task, then finish with: token-harness benchmark-finish --benchmark-id ${capture.benchmarkId} --variant ${capture.variant} ${capture.qualityCheck === undefined ? '--quality passed' : '--yes'} --attempts 1 --failed-attempts 0`,
      0,
    ),
    ...candidateNextStep(report),
  ]);
}

export function renderBenchmarkFinishReport(
  report: TaskBenchmarkCaptureFinishReport,
  context: RenderContext,
): string {
  const { receipt } = report;
  const receiptPath = truncatePath(
    displayPath(report.receiptPath, context.home),
    MAX_WIDTH - 'Receipt: '.length,
  );
  return document([
    `Benchmark receipt — ${receipt.benchmarkId} / ${receipt.variant}`,
    `${receipt.taskClass} on ${receipt.harnessId}`,
    '',
    ...wrap(
      `Quality ${receipt.outcome.qualityGate}; attempts ${String(receipt.outcome.attempts)}; failed attempts ${String(receipt.outcome.failedAttempts)}`,
      0,
    ),
    `Quota windows: ${String(receipt.usageBefore.length)} before / ${String(receipt.usageAfter.length)} after`,
    receipt.localUsage === null
      ? 'Local usage: unavailable or ambiguous'
      : `Local usage: ${String(receipt.localUsage.totalTokens)} tokens (local evidence only)`,
    `Receipt: ${receiptPath}`,
    ...(receipt.outcome.qualityEvidence === undefined
      ? []
      : wrap(`Quality source: ${receipt.outcome.qualityEvidence.source}`, 0)),
    ...(receipt.outcome.qualityEvidence?.source !== 'check-command'
      ? []
      : wrap(
          `Check exit: ${receipt.outcome.qualityEvidence.exitCode ?? 'unknown'}; duration ${receipt.outcome.qualityEvidence.durationMs}ms; full output hashes ${receipt.outcome.qualityEvidence.output === null ? 'unavailable' : 'recorded'}`,
          0,
        )),
    ...(receipt.outcome.qualityEvidence?.source === 'check-command' &&
    receipt.outcome.qualityEvidence.userRecordedQuality !== null &&
    receipt.outcome.qualityEvidence.userRecordedQuality !== receipt.outcome.qualityGate
      ? wrap(
          `Check overrides user-recorded quality ${receipt.outcome.qualityEvidence.userRecordedQuality}.`,
          0,
        )
      : []),
    '',
    ...wrap(
      receipt.experiment !== undefined
        ? `Review the four-arm report: token-harness benchmark-factorial --benchmark-id ${receipt.benchmarkId}`
        : `After both variants are complete, review the project evidence with: token-harness benchmark-matrix --harness ${receipt.harnessId} --task ${receipt.taskClass}. Use token-harness benchmark --baseline <baseline.json> --optimized <optimized.json> only when you need one specific pair.`,
      0,
    ),
  ]);
}
