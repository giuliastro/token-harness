import type { StackCombinationReviewCaptureReport } from '@token-harness/core';

import type { RenderContext } from './layout.js';

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
  }
  lines.push('', ...report.instructions.map((instruction) => `- ${instruction}`));
  lines.push('', 'Use --json to copy the exact machine-readable review fingerprint.');
  return `${lines.join('\n')}\n`;
}
