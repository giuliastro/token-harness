import type { BudgetReport } from '@token-harness/core';
import { NodeFileSystem, resolveHostEnvironment } from '@token-harness/platform';

import { runBudget } from './commands/budget.js';

export interface ScheduleBudgetObserverInput {
  cwd: string;
  now?: () => string;
}

/**
 * Observe the same Claude/Codex budget report used by `token-harness budget`, but from the
 * dedicated schedule runtime path.
 *
 * This module owns no scheduler policy. It only resolves the host, constructs the narrow ports
 * required by `runBudget`, and returns null when the host itself cannot be resolved safely.
 */
export async function observeScheduleBudget(
  input: ScheduleBudgetObserverInput,
): Promise<BudgetReport | null> {
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) return null;

  const fs = new NodeFileSystem(resolution.environment.facts);
  const result = await runBudget({
    platform: resolution.environment.facts,
    projectRoot: input.cwd,
    harness: null,
    adapters: {
      fs,
      runner: resolution.environment.runner,
      paths: resolution.environment.paths,
    },
    now: input.now ?? (() => new Date().toISOString()),
  });

  return result.data ?? null;
}
