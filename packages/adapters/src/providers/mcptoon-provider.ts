import {
  digestText,
  harnessId,
  type OwnedArtifact,
  type PlannedAction,
  type ProviderPlan,
} from '@token-harness/core';

import type { ProviderAdapter, ProviderContext, ProviderPlanRequest } from './contract.js';
import { mcptoonAdapter as baseMcptoonAdapter } from './managed-optimization-tools.js';
import {
  MCPTOON_AGENT_INSTRUCTIONS,
  MCPTOON_CLAUDE_SKILL,
  MCPTOON_MARKER_BEGIN,
  MCPTOON_MARKER_END,
} from './mcptoon-managed.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function removalAction(context: ProviderContext, harness: string): PlannedAction | null {
  if (harness === CLAUDE) {
    const path = context.fs.join(context.paths.home, '.claude', 'skills', 'mcptoon', 'SKILL.md');
    const target: OwnedArtifact = {
      kind: 'owned-file',
      path,
      digest: digestText(MCPTOON_CLAUDE_SKILL),
      mode: null,
    };
    return {
      kind: 'remove-owned-change',
      id: 'mcptoon:claude:skill:remove',
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: [path],
      affectedProcesses: [],
      preconditions: ['The owned mcptoon Claude skill still matches its transaction receipt'],
      postconditions: ['Only the Token Harness-owned mcptoon Claude skill is removed'],
      rollbackData: 'file-snapshot',
      explanation: 'Remove the exact mcptoon Claude skill owned by Token Harness',
      path,
      reverses: 'mcptoon:claude:skill',
      target,
    };
  }

  if (harness === CODEX) {
    const path = context.fs.join(context.projectRoot, 'AGENTS.md');
    const target: OwnedArtifact = {
      kind: 'owned-marker-block',
      path,
      markerBegin: MCPTOON_MARKER_BEGIN,
      markerEnd: MCPTOON_MARKER_END,
      bodyDigest: digestText(MCPTOON_AGENT_INSTRUCTIONS.trimEnd()),
    };
    return {
      kind: 'remove-owned-change',
      id: 'mcptoon:codex:agents:remove',
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: [path],
      affectedProcesses: [],
      preconditions: ['The owned mcptoon Codex block still matches its transaction receipt'],
      postconditions: ['Only the Token Harness-owned mcptoon Codex block is removed'],
      rollbackData: 'file-snapshot',
      explanation: 'Remove the exact mcptoon Codex guidance owned by Token Harness',
      path,
      reverses: 'mcptoon:codex:agents',
      target,
    };
  }

  return null;
}

function dedupe(actions: readonly PlannedAction[]): PlannedAction[] {
  return [...new Map(actions.map((action) => [action.id, action])).values()];
}

async function plan(context: ProviderContext, request: ProviderPlanRequest): Promise<ProviderPlan> {
  if (request.desiredState !== 'absent') return baseMcptoonAdapter.plan(context, request);

  const actions = dedupe(
    request.harnesses
      .map((item) => removalAction(context, item.id))
      .filter((action): action is PlannedAction => action !== null),
  );

  return {
    providerId: baseMcptoonAdapter.manifest.id,
    desiredState: 'absent',
    actions,
    targetHarnesses: request.harnesses
      .map((item) => item.id)
      .filter((id) => id === CLAUDE || id === CODEX),
  };
}

/** Ordinary managed-provider surface for mcptoon, including ownership-safe removal. */
export const mcptoonManagedProviderAdapter: ProviderAdapter = {
  ...baseMcptoonAdapter,
  plan,
};
