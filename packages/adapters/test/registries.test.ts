import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MANAGED_HARNESS_IDS, type HarnessId, type ProviderId } from '@token-harness/core';

import {
  findHarnessAdapter,
  findProviderAdapter,
  listHarnessAdapters,
  listProviderAdapters,
} from '../src/index.js';

describe('adapter registries', () => {
  it('carries the harness adapters this build ships, and no others', () => {
    // Claude Code first rather than Codex, inverting PLAN §15 issue 10: the Phase 2.5
    // spike reached tier 3 on Claude Code and could not declare a tier for Codex, and
    // writing an adapter against an undeclared verification surface is what PLAN §4 puts
    // the spike before the adapters to avoid.
    assert.deepEqual(
      listHarnessAdapters().map((adapter) => adapter.manifest.id),
      ['claude'],
    );
  });

  it('has no provider adapters yet, and says so by returning nothing rather than throwing', () => {
    assert.deepEqual([...listProviderAdapters()], []);
  });

  it('finds a registered harness and returns null for an unregistered one', () => {
    assert.notEqual(findHarnessAdapter('claude' as HarnessId), null);
    assert.equal(findHarnessAdapter('codex' as HarnessId), null);
    assert.equal(findHarnessAdapter('opencode' as HarnessId), null);
    assert.equal(findProviderAdapter('rtk' as ProviderId), null);
  });

  it('only registers ids from the managed set', () => {
    for (const adapter of listHarnessAdapters()) {
      assert.ok(
        (MANAGED_HARNESS_IDS as readonly string[]).includes(adapter.manifest.id),
        `${adapter.manifest.id} is not in the PLAN §8.1 managed set`,
      );
    }
  });

  it('declares a complete contract for every registered adapter', () => {
    for (const adapter of listHarnessAdapters()) {
      const { manifest } = adapter;
      assert.ok(manifest.configFiles.length > 0, 'no configuration files declared');
      assert.ok(manifest.interceptionPoints.length > 0, 'no interception points declared');
      assert.ok(manifest.toolFamilies.length > 0, 'no tool families declared');
      // RFC 0007 §The harness adapter contract, declaration 4: whether configuration is
      // enough has to be stated, because Codex proved it sometimes is not.
      assert.equal(typeof manifest.requiresEnablement, 'boolean');
      assert.equal(manifest.requiresEnablement, manifest.enablementNote !== null);
      assert.equal(typeof adapter.detect, 'function');
      assert.equal(typeof adapter.inspect, 'function');
      assert.equal(typeof adapter.verify, 'function');
    }
  });

  it('declares a path relative to its scope, never an absolute one', () => {
    for (const adapter of listHarnessAdapters()) {
      for (const file of adapter.manifest.configFiles) {
        // The adapter resolves these against the home directory or the project root the
        // platform layer supplies, so an absolute path here would bypass both.
        assert.ok(!file.path.startsWith('/'), file.path);
        assert.ok(!/^[A-Za-z]:/.test(file.path), file.path);
        assert.ok(!file.path.startsWith('~'), file.path);
      }
    }
  });
});
