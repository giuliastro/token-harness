/**
 * Human rendering for two-phase benchmark capture.
 */

import type {
  TaskBenchmarkCaptureFinishReport,
  TaskBenchmarkCaptureStartReport,
} from '@token-harness/core';

import { MAX_WIDTH, displayPath, document, truncatePath, wrap, type RenderContext } from './layout.js';

export function renderBenchmarkStartReport(
  report: TaskBenchmarkCaptureStartReport,
  context: RenderContext,
): string {
  const { capture } = report;
  return document([
    `Benchmark start — ${capture.benchmarkId} / ${capture.variant}`,
    `${capture.taskClass} on ${capture.harnessId}`,
    '',
    ...wrap(
      `Policy: model ${capture.model ?? 'unknown'}, effort ${capture.reasoningEffort ?? 'unknown'}, verbosity ${capture.verbosity ?? 'unknown'}`,
      0,
    ),
    `Quota windows captured: ${String(capture.usageBefore.length)}`,
    `Capture: ${truncatePath(displayPath(report.capturePath, context.home), MAX_WIDTH - 'Capture: '.length)}`,
    '',
    ...wrap(
      `Run the task, then finish with: token-harness benchmark-finish --benchmark-id ${capture.benchmarkId} --variant ${capture.variant} --quality passed --attempts 1 --failed-attempts 0`,
      0,
    ),
  ]);
}

export function renderBenchmarkFinishReport(
  report: TaskBenchmarkCaptureFinishReport,
  context: RenderContext,
): string {
  const { receipt } = report;
  return document([
    `Benchmark receipt — ${receipt.benchmarkId} / ${receipt.variant}`,
    `${receipt.taskClass} on ${receipt.harnessId}`,
    '',
    ...wrap(
      `Quality ${receipt.outcome.qualityGate}; attempts ${String(receipt.outcome.attempts)}; failed attempts ${String(receipt.outcome.failedAttempts)}`,
      0,
    ),
    `Quota windows: ${String(receipt.usageBefore.length)} before / ${String(receipt.usageAfter.length)} after`,
    'Local usage: not captured by this slice',
    `Receipt: ${truncatePath(displayPath(report.receiptPath, context.home), MAX_WIDTH - 'Receipt: '.length)}`,
    '',
    ...wrap(
      'After both variants are complete, compare their receipt files with token-harness benchmark --baseline <baseline.json> --optimized <optimized.json>.',
      0,
    ),
  ]);
}
