import type { SmartRoutingCommandReport } from '../commands/smart-routing.js';

export function renderSmartRoutingReport(report: SmartRoutingCommandReport): string {
  if (report.kind === 'ccr-script') return `${report.script}\n`;

  const { metrics } = report;
  const harnesses =
    Object.entries(metrics.byHarness)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} ${String(count)}`)
      .join(', ') || 'none';
  const tiers =
    Object.entries(metrics.byTier)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} ${String(count)}`)
      .join(', ') || 'none';
  const modes =
    Object.entries(metrics.byMode)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} ${String(count)}`)
      .join(', ') || 'none';

  return [
    'Smart Model Routing decisions',
    `Window: ${report.since} to ${report.until}`,
    `Retained decisions: ${String(metrics.retainedDecisionCount)}`,
    `By harness: ${harnesses}`,
    `By mode: ${modes}`,
    `By tier: ${tiers}`,
    `CCR route changes requested: ${String(metrics.routeMutationRequestCount)}`,
    `Malformed records: ${String(metrics.malformedRecordCount)}`,
    `Pruned records: ${String(metrics.prunedRecordCount)}`,
    'Model savings: not measured',
    `Cleanup: token-harness routing --route-metrics --prune (keeps ${String(metrics.retentionLimit)} newest records)`,
  ].join('\n');
}
