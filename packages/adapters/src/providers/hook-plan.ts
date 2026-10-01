/**
 * Shared command-hook config helpers. Harness adapters own the event names, matchers and paths;
 * provider adapters supply only the command they want the harness to run.
 */

import type {
  HarnessId,
  HarnessManifest,
  JsonValue,
  MergeJsonAction,
  RemoveOwnedChangeAction,
} from '@token-harness/core';
import { jsonValueDigest } from '@token-harness/core';

import type { ProviderContext } from './contract.js';

export interface CommandHookTarget {
  harness: HarnessManifest;
  harnessId: HarnessId;
  scopeId: string;
  toolFamily: string;
  eventName: string;
  matcher: string;
  configPath: string;
  pointer: string;
}

export function hookListPointer(eventName: string): string {
  return `hooks.${eventName.replace(/\./g, '\\.')}`;
}

/** The exact matcher string the harness adapter declares for this tool family. */
export function hookMatcherForFamily(harness: HarnessManifest, toolFamily: string): string {
  const family = harness.toolFamilies.find((entry) => entry.id === toolFamily);
  return family?.matcher ?? toolFamily;
}

/**
 * Resolve a common command-hook target from harness-owned manifest data.
 *
 * Returning null means the harness does not declare a command-list file for this event, so a
 * provider must not invent a path or config shape for it.
 */
export function commandHookTarget(
  context: Pick<ProviderContext, 'fs' | 'paths' | 'projectRoot'>,
  harness: HarnessManifest,
  scopeId: string,
  toolFamily: string,
): CommandHookTarget | null {
  const point = harness.interceptionPoints.find((entry) => entry.scopeId === scopeId);
  const family = harness.toolFamilies.find((entry) => entry.id === toolFamily);
  const file = harness.configFiles.find(
    (entry) =>
      entry.interceptionFormat === 'hooks-event-command-list' &&
      entry.interceptionPoints?.includes(scopeId),
  );
  if (point === undefined || family === undefined || file === undefined) return null;

  const base = file.scope === 'user' ? context.paths.home : context.projectRoot;
  const configPath = context.fs.join(base, ...file.path.split('/'));
  return {
    harness,
    harnessId: harness.id,
    scopeId,
    toolFamily,
    eventName: point.eventName,
    matcher: family.matcher ?? family.id,
    configPath,
    pointer: hookListPointer(point.eventName),
  };
}

export function commandHookEntry(matcher: string, command: string): JsonValue {
  return {
    matcher,
    hooks: [{ type: 'command', command }],
  };
}

export function appendCommandHookAction(input: {
  target: CommandHookTarget;
  providerId: string;
  actionId: string;
  command: string;
  explanation: string;
}): MergeJsonAction {
  const { target } = input;
  return {
    kind: 'merge-json',
    id: input.actionId,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.configPath],
    affectedProcesses: [],
    preconditions: [
      `${target.configPath} is absent or parses as JSON`,
      `no ${input.providerId} command hook already exists on ${target.eventName}/${target.toolFamily}`,
    ],
    postconditions: [
      `${target.eventName} carries one ${input.providerId} command hook for ${target.toolFamily}`,
      'every other hook entry is unchanged',
    ],
    rollbackData: 'file-snapshot',
    explanation: input.explanation,
    path: target.configPath,
    ownedPointers: [target.pointer],
    operations: [
      {
        kind: 'append',
        pointer: target.pointer,
        value: commandHookEntry(target.matcher, input.command),
        expectedValueDigest: null,
      },
    ],
    createIfMissing: true,
  };
}

export function removeCommandHookAction(input: {
  target: CommandHookTarget;
  providerId: string;
  actionId: string;
  installActionId: string;
  command: string;
}): RemoveOwnedChangeAction {
  return {
    kind: 'remove-owned-change',
    id: input.actionId,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [input.target.configPath],
    affectedProcesses: [],
    preconditions: [`the ${input.providerId} hook still matches the entry Token Harness wrote`],
    postconditions: [
      `${input.target.eventName} no longer carries the Token Harness ${input.providerId} hook`,
    ],
    rollbackData: 'file-snapshot',
    explanation: `Remove the ${input.providerId} hook from ${input.target.harness.displayName}`,
    path: input.target.configPath,
    reverses: input.installActionId,
    target: {
      kind: 'owned-json-entry',
      path: input.target.configPath,
      pointer: input.target.pointer,
      placement: 'array-element',
      valueDigest: jsonValueDigest(commandHookEntry(input.target.matcher, input.command)),
    },
  };
}
