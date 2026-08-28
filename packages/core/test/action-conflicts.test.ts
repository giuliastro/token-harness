import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findMarkerRegionConflicts,
  providerId,
  type PatchMarkerBlockAction,
} from '../src/index.js';

function block(input: {
  id: string;
  path?: string;
  begin: string;
  end: string;
}): PatchMarkerBlockAction {
  const path = input.path ?? '/repo/AGENTS.md';
  return {
    kind: 'patch-marker-block',
    id: input.id,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: [],
    postconditions: [],
    rollbackData: 'file-snapshot',
    explanation: 'test instruction block',
    path,
    markerBegin: input.begin,
    markerEnd: input.end,
    commentPrefix: '<!--',
    commentSuffix: '-->',
    body: 'instructions\n',
    expectedBodyDigest: null,
    createIfMissing: true,
  };
}

describe('marker-region conflicts', () => {
  it('allows distinct owned regions in the same instruction file', () => {
    const conflicts = findMarkerRegionConflicts([
      {
        providerId: providerId('alpha'),
        action: block({ id: 'a', begin: 'alpha:begin', end: 'alpha:end' }),
      },
      {
        providerId: providerId('beta'),
        action: block({ id: 'b', begin: 'beta:begin', end: 'beta:end' }),
      },
    ]);

    assert.deepEqual(conflicts, []);
  });

  it('reports two providers claiming the same marker-fenced region', () => {
    const conflicts = findMarkerRegionConflicts([
      {
        providerId: providerId('alpha'),
        action: block({ id: 'a', begin: 'shared:begin', end: 'shared:end' }),
      },
      {
        providerId: providerId('beta'),
        action: block({ id: 'b', begin: 'shared:begin', end: 'shared:end' }),
      },
    ]);

    assert.deepEqual(conflicts, [
      {
        path: '/repo/AGENTS.md',
        markerBegin: 'shared:begin',
        markerEnd: 'shared:end',
        claimants: [providerId('alpha'), providerId('beta')],
      },
    ]);
  });

  it('does not turn duplicate actions from one provider into a cross-provider conflict', () => {
    const conflicts = findMarkerRegionConflicts([
      {
        providerId: providerId('alpha'),
        action: block({ id: 'a1', begin: 'alpha:begin', end: 'alpha:end' }),
      },
      {
        providerId: providerId('alpha'),
        action: block({ id: 'a2', begin: 'alpha:begin', end: 'alpha:end' }),
      },
    ]);

    assert.deepEqual(conflicts, []);
  });
});
