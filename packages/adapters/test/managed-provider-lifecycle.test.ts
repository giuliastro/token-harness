import assert from 'node:assert/strict';
import test from 'node:test';

import { harnessId, providerId } from '@token-harness/core';

import {
  GITNEXUS_CLAUDE_MCP_POINTER,
  MCPTOON_MARKER_BEGIN,
  gitnexusManagedProviderAdapter,
  listProviderAdapters,
  mcptoonManagedProviderAdapter,
  type ProviderContext,
  type ProviderPlanRequest,
} from '../src/providers/index.js';

const context = {
  fs: {
    join: (...segments: string[]) => segments.join('/').replace(/\/+/g, '/'),
  },
  paths: { home: '/home/dev' },
  projectRoot: '/work/demo',
} as unknown as ProviderContext;

const absentRequest = {
  ownership: [],
  harnesses: [{ id: harnessId('claude') }, { id: harnessId('codex') }],
  desiredState: 'absent',
} as unknown as ProviderPlanRequest;

test('ordinary provider registry contains mcptoon and GitNexus but not placeholder Headroom', () => {
  const ids = listProviderAdapters().map((adapter) => adapter.manifest.id);
  assert.ok(ids.includes(providerId('mcptoon')));
  assert.ok(ids.includes(providerId('gitnexus')));
  assert.equal(ids.includes(providerId('headroom')), false);
});

test('mcptoon plans ownership-safe removal for Claude and Codex integrations', async () => {
  const plan = await mcptoonManagedProviderAdapter.plan(context, absentRequest);
  const removals = plan.actions.filter((action) => action.kind === 'remove-owned-change');

  assert.equal(removals.length, 2);
  const claude = removals.find((action) => action.target.kind === 'owned-file');
  const codex = removals.find((action) => action.target.kind === 'owned-marker-block');

  assert.equal(claude?.target.kind, 'owned-file');
  assert.equal(codex?.target.kind, 'owned-marker-block');
  if (codex?.target.kind === 'owned-marker-block') {
    assert.equal(codex.target.markerBegin, MCPTOON_MARKER_BEGIN);
  }
});

test('GitNexus plans ownership-safe removal of its Claude MCP configuration', async () => {
  const plan = await gitnexusManagedProviderAdapter.plan(context, absentRequest);
  const removals = plan.actions.filter((action) => action.kind === 'remove-owned-change');

  assert.equal(removals.length, 1);
  const target = removals[0]?.target;
  assert.equal(target?.kind, 'owned-json-entry');
  if (target?.kind === 'owned-json-entry') {
    assert.equal(target.pointer, GITNEXUS_CLAUDE_MCP_POINTER);
  }
});
