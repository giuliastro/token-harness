import type { SmartRoutingCommandReport } from '../commands/smart-routing.js';

export function renderSmartRoutingReport(report: SmartRoutingCommandReport): string {
  if (report.kind === 'ccr-script') return `${report.script}\n`;
  if (report.kind === 'ccr-configuration') {
    return [
      `CCR ${report.action}: ${report.state}`,
      `Harness: ${report.harnessId}`,
      `Mode: ${report.mode}`,
      `CCR version: ${report.ccrVersion}`,
      `Gateway: ${report.gatewayState}`,
      `Rule: ${report.ruleId}`,
      `Script: ${report.scriptPath}`,
      `Management endpoint: ${report.managementEndpoint}`,
      ...(report.profileId === undefined || report.profileId === null
        ? []
        : [`CCR profile: ${report.profileId}`]),
      ...(report.launchCommand === undefined || report.launchCommand === null
        ? []
        : [`Launch: ${report.launchCommand}`]),
    ].join('\n');
  }

  if (report.kind === 'ccr-lifecycle') {
    return [
      `CCR ${report.action}: ${report.state}`,
      `Version: ${report.version}`,
      `Package: ${report.packagePath}`,
      `CLI: ${report.executablePath}`,
      `Management endpoint: ${report.managementEndpoint}`,
    ].join('\n');
  }

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

  const lines = [
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
  ];
  if (report.ccrUsage !== undefined) {
    const models = report.ccrUsage.byModel.map((item) => item.model).join(', ') || 'none';
    lines.push(
      `CCR observed requests: ${String(report.ccrUsage.requestCount)} across ${String(report.ccrUsage.observedSessionCount)}/${String(report.ccrUsage.sessionCount)} sessions (${report.ccrUsage.status})`,
      `CCR reported tokens: ${String(report.ccrUsage.totalTokens)} total, ${String(report.ccrUsage.inputTokens)} input, ${String(report.ccrUsage.outputTokens)} output`,
      `CCR logged models: ${models}`,
      `CCR recorded cost: ${report.ccrUsage.recordedCostUsd === null ? 'unavailable' : report.ccrUsage.recordedCostUsd.toFixed(6) + ' USD (provider estimate)'}`,
      'CCR usage is observed request telemetry, not subscription quota or measured savings',
    );
  }
  return lines.join('\n');
}
