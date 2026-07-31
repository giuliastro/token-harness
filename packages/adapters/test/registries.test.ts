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
      ['claude', 'codex', 'opencode'],
    );
  });

  it('carries the provider adapters this build ships, and no others', () => {
    // RTK first: RFC 0003's compatibility rule gives it `shell.output.reduce` when both claim the
    // scope, and the resolver reads a rule's provider order to pick the owner.
    assert.deepEqual(
      listProviderAdapters().map((adapter) => adapter.manifest.id),
      ['rtk', 'harnesstrim'],
    );
  });

  it('finds a registered adapter and returns null for an unregistered one', () => {
    assert.notEqual(findHarnessAdapter('claude' as HarnessId), null);
    assert.notEqual(findHarnessAdapter('codex' as HarnessId), null);
    assert.notEqual(findHarnessAdapter('opencode' as HarnessId), null);
    // The three PLAN §2 criterion 1 names. `hermes` and `pi` are in the managed set and have
    // no adapter, which is what keeps this assertion about what ships rather than what exists.
    assert.equal(findHarnessAdapter('hermes' as HarnessId), null);
    assert.notEqual(findProviderAdapter('rtk' as ProviderId), null);
    assert.notEqual(findProviderAdapter('harnesstrim' as ProviderId), null);
    assert.equal(findProviderAdapter('dejavu' as ProviderId), null);
  });

  it('declares a complete contract for every registered provider', () => {
    for (const adapter of listProviderAdapters()) {
      const { manifest } = adapter;
      assert.ok(manifest.capabilities.length > 0, 'no capabilities declared');
      // RFC 0003 §Rule: an assignment "requires a demonstrated capability ... evidenced
      // in the provider's own source at a recorded version".
      for (const capability of manifest.capabilities) {
        assert.notEqual(capability.evidence, null, `${capability.capability} has no evidence`);
        assert.ok((capability.evidence?.upstreamVersion.length ?? 0) > 0);
      }
      assert.ok(manifest.installationChannels.length > 0, 'no installation channels declared');
      // PLAN §10: "do not parse human `rtk gain` output when JSON is available."
      assert.notEqual(manifest.metrics.source, 'none');
      assert.equal(typeof adapter.detect, 'function');
      assert.equal(typeof adapter.verify, 'function');
      // Every lifecycle method the contract declares, for every registered provider — so a second
      // provider cannot ship with a method the first one has and it lacks.
      assert.equal(typeof adapter.plan, 'function');
      assert.equal(typeof adapter.collectMetrics, 'function');
      assert.equal(typeof adapter.identifiesCommand, 'function');
      // RFC 0003 §Rule keeps the harness dimension, so a capability has to say where it applies.
      for (const capability of manifest.capabilities) {
        assert.ok(capability.harnesses.length > 0, `${capability.capability} names no harness`);
        assert.ok(capability.surfaces.length > 0, `${capability.capability} names no surface`);
      }
    }
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
