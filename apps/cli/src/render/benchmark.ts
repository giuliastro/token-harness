/**
 * Human rendering for paired task benchmark comparison.
 */

import type {
  TaskBenchmarkContextCompareReport,
  TaskBenchmarkReceipt,
} from '@token-harness/core';

import { document, formatCount, wrap, type RenderContext } from './layout.js';

function receiptLine(label: string, receipt: TaskBenchmarkReceipt): string {
  const local =
    receipt.localUsage === null
      ? 'local tokens unknown'
      : `local ${formatCount(receipt.localUsage.totalTokens)} tokens`;
  return (
    `${label}: quality ${receipt.outcome.qualityGate}; attempts ${String(receipt.outcome.attempts)}; ` +
    `failed ${String(receipt.outcome.failedAttempts)}; errors ${String(receipt.outcome.errorCodes.length)}; ${local}`
  );
}

function policyLine(label: string, receipt: TaskBenchmarkReceipt): string {
  const parts = [
    `model ${receipt.model ?? 'unknown'}`,
    `effort ${receipt.reasoningEffort ?? 'unknown'}`,
    `verbosity ${receipt.verbosity ?? 'unknown'}`,
  ];
  return `${label} policy: ${parts.join(', ')}`;
}

export function renderBenchmarkReport(
  report: TaskBenchmarkContextCompareReport,
  _context: RenderContext,
): string {
  const { baseline, optimized, comparison, context } = report;
  const lines: string[] = [
    `Benchmark — ${comparison.benchmarkId}`,
    `${baseline.taskClass} on ${baseline.harnessId}`,
    '',
    ...wrap(receiptLine('Baseline', baseline), 0),
    ...wrap(policyLine('Baseline', baseline), 2),
    ...wrap(receiptLine('Optimized', optimized), 0),
    ...wrap(policyLine('Optimized', optimized), 2),
    '',
  ];

  if (comparison.quota === null) {
    lines.push('Backend quota: no comparable authoritative/reported window');
  } else {
    lines.push(
      ...wrap(
        `Backend quota (${comparison.quota.scope}, ${comparison.quota.confidence}): baseline +${String(
          comparison.quota.baselineDeltaUsedPercent,
        )}% vs optimized +${String(comparison.quota.optimizedDeltaUsedPercent)}%`,
        0,
      ),
    );
  }

  const contextCounts =
    context.baseline === null || context.optimized === null
      ? ''
      : ` — static MCP tools ${String(context.baseline.effectiveStaticMcpToolCount)} → ${String(
          context.optimized.effectiveStaticMcpToolCount,
        )}`;
  lines.push(...wrap(`Context: ${context.verdict}${contextCounts}`, 0));
  lines.push(...wrap(`Context evidence: ${context.reason}`, 2));

  lines.push(
    ...wrap(
      `Verdict: ${comparison.verdict} — basis ${comparison.basis} — evidence ${comparison.evidenceLevel}`,
      0,
    ),
  );

  if (comparison.reasons.length > 0) {
    lines.push('');
    lines.push('Why');
    for (const reason of comparison.reasons) lines.push(...wrap(reason, 2));
  }

  lines.push(
    '',
    ...wrap(
      'Context reduction is reported separately and is not converted into Claude/Codex subscription quota.',
      0,
    ),
  );

  return document(lines);
}
