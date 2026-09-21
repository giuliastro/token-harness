import { harnessId, type ProviderPlan } from '@token-harness/core';

import type { ProviderAdapter, ProviderContext, ProviderPlanRequest } from './contract.js';
import { gitnexusAdapter as baseGitNexusAdapter } from './managed-optimization-tools.js';
import { gitnexusOwnedArtifact, planGitNexusManagedMcpRemoval } from './gitnexus-managed.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  if (request.desiredState !== 'absent') return baseGitNexusAdapter.plan(context, request);

  const actions = [];
  const targets = [];
  for (const harness of request.harnesses.map((item) => item.id)) {
    if (harness !== CLAUDE && harness !== CODEX) continue;
    const target = gitnexusOwnedArtifact(context, harness);
    if (target === null) continue;
    const removal = planGitNexusManagedMcpRemoval(context, target);
    actions.push(...removal.actions);
    if (removal.actions.length > 0) targets.push(harness);
  }

  return {
    providerId: baseGitNexusAdapter.manifest.id,
    desiredState: 'absent',
    actions: [...new Map(actions.map((action) => [action.id, action])).values()],
    targetHarnesses: [...new Set(targets)],
  };
}

/** Ordinary managed-provider surface for GitNexus, including ownership-safe MCP removal. */
export const gitnexusManagedProviderAdapter: ProviderAdapter = {
  ...baseGitNexusAdapter,
  plan,
};
