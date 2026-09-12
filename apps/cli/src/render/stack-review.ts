import type {
  StackCombinationReviewCaptureReport,
  StackCombinationRuntimeEvidenceState,
} from '@token-harness/core';

import type { RenderContext } from './layout.js';

function runtimeLabel(state: StackCombinationRuntimeEvidenceState): string {
  if (state === 'observed') return 'observed';
  if (state === 'not-exercised') return 'not exercised';
  if (state === 'failed') return 'failed/degraded';
  return 'unavailable';
}

export function renderStackReviewReport(
  report: StackCombinationReviewCaptureReport,
  _context: RenderContext,
): string {
  const lines = ['STACK REVIEW CAPTURE', ''];
  if (!report.ready || report.fingerprint === null) {
    lines.push('No multi-provider configured stack is ready to capture.');
  } else {
    lines.push(`Providers  ${report.fingerprint.providerIds.join(' + ')}`);
    for (const providerId of report.fingerprint.providerIds) {
      lines.push(
        `${providerId}  ${report.fingerprint.versions[providerId] ?? 'unknown version'}  ` +
          `${(report.fingerprint.configuredHarnesses[providerId] ?? []).join(', ') || 'no managed harness'}`,
      );
    }
    lines.push('', 'Decision   pending manual review');

    if (report.verificationEvidence.length > 0) {
      lines.push('', 'PASSIVE VERIFICATION');
      for (const row of report.verificationEvidence) {
        lines.push(
          `${row.providerId} / ${row.harnessId}  ${runtimeLabel(row.runtimeEvidence)}  ` +
            `${row.declaredTier ?? 'unknown tier'}`,
        );
        lines.push(`  ${row.detail}`);
      }
    }
  }
  lines.push('', ...report.instructions.map((instruction) => `- ${instruction}`));
  lines.push(
    '',
    'Use --json to copy the exact machine-readable review fingerprint and evidence gaps.',
  );
  return `${lines.join('\n')}\n`;
}
