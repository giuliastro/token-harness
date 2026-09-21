import assert from 'node:assert/strict';
import test from 'node:test';

import { harnessId, providerId } from '@token-harness/core';

import {
  GITNEXUS_CLAUDE_MCP_POINTER,
  GITNEXUS_CODEX_MARKER_BEGIN,
  HEADROOM_CLAUDE_MCP_POINTER,
  HEADROOM_CODEX_MARKER_BEGIN,
  MCPTOON_MARKER_BEGIN,
  gitnexusManagedProviderAdapter,
  headroomManagedProviderAdapter,
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

test('ordinary provider registry contains mcptoon, GitNexus and Headroom', () => {
  const ids = listProviderAdapters().map((adapter) => adapter.manifest.id);
  assert.ok(ids.includes(providerId('mcptoon')));
  assert.ok(ids.includes(providerId('gitnexus')));
  assert.ok(ids.includes(providerId('headroom')));
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

test('GitNexus plans ownership-safe removal of its Claude and Codex MCP configurations', async () => {
  const plan = await gitnexusManagedProviderAdapter.plan(context, absentRequest);
  const removals = plan.actions.filter((action) => action.kind === 'remove-owned-change');

  assert.equal(removals.length, 2);
  const claude = removals.find((action) => action.target.kind === 'owned-json-entry');
  const codex = removals.find((action) => action.target.kind === 'owned-marker-block');
  assert.equal(claude?.target.kind, 'owned-json-entry');
  if (claude?.target.kind === 'owned-json-entry') {
    assert.equal(claude.target.pointer, GITNEXUS_CLAUDE_MCP_POINTER);
  }
  assert.equal(codex?.target.kind, 'owned-marker-block');
  if (codex?.target.kind === 'owned-marker-block') {
    assert.equal(codex.target.markerBegin, GITNEXUS_CODEX_MARKER_BEGIN);
  }
});

test('Headroom plans surgical removal for Claude JSON and Codex marker ownership', async () => {
  const plan = await headroomManagedProviderAdapter.plan(context, absentRequest);
  const removals = plan.actions.filter((action) => action.kind === 'remove-owned-change');

  assert.equal(removals.length, 2);
  const claude = removals.find((action) => action.target.kind === 'owned-json-entry');
  const codex = removals.find((action) => action.target.kind === 'owned-marker-block');

  assert.equal(claude?.target.kind, 'owned-json-entry');
  if (claude?.target.kind === 'owned-json-entry') {
    assert.equal(claude.target.pointer, HEADROOM_CLAUDE_MCP_POINTER);
    assert.equal(claude.target.path, '/home/dev/.claude.json');
  }
  assert.equal(codex?.target.kind, 'owned-marker-block');
  if (codex?.target.kind === 'owned-marker-block') {
    assert.equal(codex.target.markerBegin, HEADROOM_CODEX_MARKER_BEGIN);
  }
});
