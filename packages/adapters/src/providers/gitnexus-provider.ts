import {
  harnessId,
  jsonValueDigest,
  type OwnedArtifact,
  type ProviderPlan,
} from '@token-harness/core';

import type { ProviderAdapter, ProviderContext, ProviderPlanRequest } from './contract.js';
import { gitnexusAdapter as baseGitNexusAdapter } from './managed-optimization-tools.js';
import {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_MCP_SERVER,
  planGitNexusManagedMcpRemoval,
} from './gitnexus-managed.js';

const CLAUDE = harnessId('claude');

async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  if (request.desiredState !== 'absent') return baseGitNexusAdapter.plan(context, request);

  if (!request.harnesses.some((item) => item.id === CLAUDE)) {
    return {
      providerId: baseGitNexusAdapter.manifest.id,
      desiredState: 'absent',
      actions: [],
      targetHarnesses: [],
    };
  }

  const target: OwnedArtifact = {
    kind: 'owned-json-entry',
    path: context.fs.join(context.paths.home, '.claude.json'),
    pointer: GITNEXUS_CLAUDE_MCP_POINTER,
    placement: 'value',
    valueDigest: jsonValueDigest(GITNEXUS_MCP_SERVER),
  };
  const removal = planGitNexusManagedMcpRemoval(context, target);

  return {
    providerId: baseGitNexusAdapter.manifest.id,
    desiredState: 'absent',
    actions: removal.actions,
    targetHarnesses: removal.actions.length > 0 ? [CLAUDE] : [],
  };
}

/** Ordinary managed-provider surface for GitNexus, including ownership-safe MCP removal. */
export const gitnexusManagedProviderAdapter: ProviderAdapter = {
  ...baseGitNexusAdapter,
  plan,
};
