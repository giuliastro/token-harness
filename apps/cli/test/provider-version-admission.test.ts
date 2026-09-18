import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { PlannedAction } from '@token-harness/core';
import { providerVersionForManagedAdmission } from '../src/commands/plan.js';

function install(id: string, version: string | null): PlannedAction {
  return {
    kind: 'package-manager-install',
    id,
    riskClass: 'reversible',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pipx'],
    preconditions: [],
    postconditions: [],
    rollbackData: 'package-inventory',
    explanation: 'test install',
    packageManager: 'pipx',
    packageName: 'mcptoon',
    version,
  };
}

it('uses the observed provider version when one is already installed', () => {
  assert.equal(providerVersionForManagedAdmission('0.7.9', [install('new', '0.7.10')]), '0.7.9');
});

it('admits against one exact planned install version when the provider is absent', () => {
  assert.equal(providerVersionForManagedAdmission(null, [install('new', '0.7.10')]), '0.7.10');
});

it('fails closed for unpinned or ambiguous planned installs', () => {
  assert.equal(providerVersionForManagedAdmission(null, [install('unpinned', null)]), null);
  assert.equal(
    providerVersionForManagedAdmission(null, [install('one', '0.7.10'), install('two', '0.7.11')]),
    null,
  );
});
