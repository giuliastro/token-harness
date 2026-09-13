import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeMcptoonManifestFootprintEvidence } from '../src/commands/candidate-benchmark.js';
import type { McptoonManifestFootprintReceipt } from '../src/commands/mcptoon-manifest-footprint.js';

function receipt(
  measuredAt: string,
  overrides: Partial<McptoonManifestFootprintReceipt> = {},
): McptoonManifestFootprintReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: `mcptoon-${measuredAt}`,
    projectId: 'p_test',
    variant: 'optimized',
    measuredAt,
    state: 'observed',
    version: '0.7.10',
    serverCount: 2,
    toolCount: 20,
    jsonBytes: 20_000,
    compactBytes: 1_000,
    reductionBytes: 19_000,
    reductionPercent: 95,
    oldestCacheEntryAt: '2026-09-13T10:00:00.000Z',
    newestCacheEntryAt: '2026-09-13T10:05:00.000Z',
    reason: 'test',
    ...overrides,
  };
}

describe('mcptoon manifest footprint campaign evidence', () => {
  it('reports the latest observed snapshot instead of summing repeated inventory snapshots', () => {
    const first = receipt('2026-09-13T10:10:00.000Z', {
      jsonBytes: 20_000,
      compactBytes: 1_000,
      reductionBytes: 19_000,
      reductionPercent: 95,
    });
    const latest = receipt('2026-09-13T11:10:00.000Z', {
      jsonBytes: 22_000,
      compactBytes: 1_100,
      reductionBytes: 20_900,
      reductionPercent: 95,
    });

    const result = summarizeMcptoonManifestFootprintEvidence([first, latest]);

    assert.equal(result.observedPairs, 2);
    assert.equal(result.nonObservedPairs, 0);
    assert.equal(result.latest?.measuredAt, latest.measuredAt);
    assert.equal(result.latest?.jsonBytes, 22_000);
    assert.equal(result.latest?.compactBytes, 1_100);
    assert.notEqual(result.latest?.jsonBytes, 42_000);
    assert.match(
      result.reason,
      /does not claim model-visible token, quota, or subscription savings/,
    );
  });

  it('counts missing or non-observed snapshots without converting them into zero savings', () => {
    const unavailable = receipt('2026-09-13T10:10:00.000Z', {
      state: 'unavailable',
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
    });

    const result = summarizeMcptoonManifestFootprintEvidence([null, unavailable]);

    assert.equal(result.observedPairs, 0);
    assert.equal(result.nonObservedPairs, 2);
    assert.equal(result.latest, null);
    assert.match(result.reason, /no completed optimized pair/);
  });

  it('keeps the newest observation by measurement time even if receipts arrive out of order', () => {
    const result = summarizeMcptoonManifestFootprintEvidence([
      receipt('2026-09-13T12:00:00.000Z', { toolCount: 30 }),
      receipt('2026-09-13T11:00:00.000Z', { toolCount: 10 }),
    ]);

    assert.equal(result.latest?.toolCount, 30);
    assert.equal(result.latest?.measuredAt, '2026-09-13T12:00:00.000Z');
  });
});
