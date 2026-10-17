/**
 * External snapshot: no local evidence import, append, cursor or attribution updates.
 * Stored savings may lag the provider's own records; native quotas remain separate.
 */
import { listHarnessAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES, OBSERVE_CONTRACT_VERSION, commandResult, diagnostic,
  type CommandResult, type ObserveAgent, type ObserveReport, type Diagnostic,
} from '@token-harness/core';
import type { CommandContext } from './context.js';
import { runBudget } from './budget.js';
import { runMetrics } from './metrics.js';

export async function runObserve(context: CommandContext): Promise<CommandResult<ObserveReport>> {
  const observedAt = context.now();
  const metrics = await runMetrics({ ...context, metricsReadOnly: true, metricsAllProjects: true });
  if (metrics.exitCode !== EXIT_CODES.ok || metrics.data === null) {
    return commandResult({
      command: 'observe', exitCode: metrics.exitCode, data: null,
      diagnostics: metrics.diagnostics,
    });
  }

  const diagnostics: Diagnostic[] = [...metrics.diagnostics];
  const agents: ObserveAgent[] = [];
  if (context.adapters !== null) {
    const adapterContext = {
      fs: context.adapters.fs,
      runner: context.adapters.runner,
      facts: context.platform,
      paths: context.adapters.paths,
      projectRoot: context.projectRoot,
    };
    for (const adapter of listHarnessAdapters().filter(
      item => context.harness === null || item.manifest.id === context.harness,
    )) {
      try {
        const detection = await adapter.detect(adapterContext);
        agents.push({
          harnessId: adapter.manifest.id, name: adapter.manifest.displayName,
          state: detection.state, version: detection.version,
        });
      } catch {
        agents.push({
          harnessId: adapter.manifest.id, name: adapter.manifest.displayName,
          state: 'error', version: null,
        });
        diagnostics.push(diagnostic({
          severity: 'warning', code: 'agent-observation-failed',
          subject: adapter.manifest.id, message: 'Coding agent detection was unavailable',
          remediation: 'Inspect the agent with token-harness doctor',
        }));
      }
    }
  }
  const budget = await runBudget(context);
  diagnostics.push(...budget.diagnostics);
  const data: ObserveReport = {
    contractVersion: OBSERVE_CONTRACT_VERSION, observedAt,
    readOnly: true, metricsFreshness: 'stored-only',
    quotas: budget.data ?? { platform: context.platform, observedAt, harnesses: [] },
    agents, metrics: metrics.data,
  };
  return commandResult({command: 'observe', exitCode: EXIT_CODES.ok, data, diagnostics});
}
