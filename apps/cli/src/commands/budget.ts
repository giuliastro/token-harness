/**
 * `token-harness budget` — RFC 0011 §Live budget observability.
 *
 * Read-only by construction. Every harness either returns an observed backend snapshot or an
 * explicit unavailable/absent state. Unknown quota is data, not an error and never becomes zero.
 */

import { listHarnessAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  commandResult,
  diagnostic,
  harnessId,
  type BudgetReport,
  type CommandResult,
  type HarnessBudgetObservation,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const BUDGET_HARNESSES = new Set([CLAUDE, CODEX]);

function unavailable(
  id: typeof CLAUDE,
  message: string,
): HarnessBudgetObservation {
  return {
    harnessId: id,
    state: 'unavailable',
    windows: [],
    planType: null,
    rateLimitReachedType: null,
    resetCreditsAvailable: null,
    diagnostics: [
      diagnostic({
        severity: 'warning',
        code: 'usage-window-unavailable',
        subject: id,
        message,
        remediation:
          'Use the harness native usage view for now; Token Harness will expose it after a versioned native surface is admitted',
      }),
    ],
  };
}

export async function runBudget(
  context: CommandContext,
): Promise<CommandResult<BudgetReport>> {
  const observedAt = context.now();
  const report: BudgetReport = {
    platform: context.platform,
    observedAt,
    harnesses: [],
  };

  if (context.adapters === null) {
    return commandResult({
      command: 'budget',
      exitCode: EXIT_CODES.ok,
      data: report,
    });
  }

  if (
    context.harness !== null &&
    !BUDGET_HARNESSES.has(context.harness)
  ) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'budget-harness-unsupported',
      subject: context.harness,
      message: 'Live subscription-budget observability currently targets Claude Code and Codex',
      remediation: 'Run token-harness budget without --harness, or select claude or codex',
    });
    return commandResult({
      command: 'budget',
      exitCode: EXIT_CODES.ok,
      data: report,
      diagnostics: [warning],
    });
  }

  const detectionContext = {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
  };

  const adapters = listHarnessAdapters()
    .filter((adapter) => BUDGET_HARNESSES.has(adapter.manifest.id))
    .filter(
      (adapter) =>
        context.harness === null || adapter.manifest.id === context.harness,
    );

  for (const adapter of adapters) {
    const detection = await adapter.detect(detectionContext);
    if (detection.state === 'absent') {
      report.harnesses.push({
        harnessId: adapter.manifest.id,
        state: 'absent',
        windows: [],
        planType: null,
        rateLimitReachedType: null,
        resetCreditsAvailable: null,
        diagnostics: [],
      });
      continue;
    }

    if (adapter.observeUsage === undefined) {
      report.harnesses.push(
        unavailable(
          adapter.manifest.id,
          `${adapter.manifest.displayName} is installed, but this build has no fixture-proven live usage reader for it`,
        ),
      );
      continue;
    }

    report.harnesses.push(
      await adapter.observeUsage(detectionContext, observedAt),
    );
  }

  return commandResult({
    command: 'budget',
    exitCode: EXIT_CODES.ok,
    data: report,
    diagnostics: report.harnesses.flatMap((item) => item.diagnostics),
  });
}
