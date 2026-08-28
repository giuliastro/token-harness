/**
 * Conflicts between provider actions that live below the capability resolver.
 *
 * RFC 0003 arbitrates interception points. An instruction file is different: multiple providers
 * may legitimately own distinct marker-fenced regions of the same file, while two providers
 * claiming the same region would make uninstall and rollback ownership ambiguous.
 */

import type { PatchMarkerBlockAction, PlannedAction } from './actions.js';
import type { ProviderId } from './ids.js';

export interface AttributedPlannedAction {
  providerId: ProviderId;
  action: PlannedAction;
}

export interface MarkerRegionConflict {
  path: string;
  markerBegin: string;
  markerEnd: string;
  claimants: ProviderId[];
}

function markerAction(action: PlannedAction): action is PatchMarkerBlockAction {
  return action.kind === 'patch-marker-block';
}

/**
 * Finds only cross-provider collisions.
 *
 * Two different marker regions in one file are intentionally allowed. The region identity is the
 * path plus both fence tokens: those are the exact coordinates the executor later uses to locate
 * and remove the owned block.
 */
export function findMarkerRegionConflicts(
  actions: readonly AttributedPlannedAction[],
): MarkerRegionConflict[] {
  const regions = new Map<
    string,
    {
      path: string;
      markerBegin: string;
      markerEnd: string;
      claimants: ProviderId[];
    }
  >();

  for (const entry of actions) {
    if (!markerAction(entry.action)) continue;
    const action = entry.action;
    const key = JSON.stringify([action.path, action.markerBegin, action.markerEnd]);
    const region = regions.get(key) ?? {
      path: action.path,
      markerBegin: action.markerBegin,
      markerEnd: action.markerEnd,
      claimants: [],
    };
    if (!region.claimants.includes(entry.providerId)) region.claimants.push(entry.providerId);
    regions.set(key, region);
  }

  return [...regions.values()]
    .filter((region) => region.claimants.length > 1)
    .map((region) => ({ ...region, claimants: [...region.claimants] }));
}
