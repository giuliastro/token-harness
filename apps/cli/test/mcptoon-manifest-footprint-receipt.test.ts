import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseMcptoonManifestFootprintReceipt,
  type McptoonManifestFootprintReceipt,
} from '../src/commands/mcptoon-manifest-footprint.js';

function validReceipt(): McptoonManifestFootprintReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: 'mcptoon-footprint-s-1',
    projectId: 'p_test',
    variant: 'optimized',
    measuredAt: '2026-09-13T12:00:00.000Z',
    state: 'observed',
    version: '0.7.10',
    serverCount: 2,
    toolCount: 20,
    jsonBytes: 20_000,
    compactBytes: 1_000,
    reductionBytes: 19_000,
    reductionPercent: 95,
    oldestCacheEntryAt: '2026-09-13T11:55:00.000Z',
    newestCacheEntryAt: '2026-09-13T11:59:00.000Z',
    reason: 'test',
  };
}

describe('mcptoon manifest footprint receipt parser', () => {
  it('accepts a self-consistent exact-version observation', () => {
    const receipt = validReceipt();
    assert.deepEqual(parseMcptoonManifestFootprintReceipt(receipt, receipt.benchmarkId), receipt);
  });

  it('rejects observed evidence whose reduction arithmetic was altered', () => {
    const receipt = validReceipt();
    assert.equal(
      parseMcptoonManifestFootprintReceipt(
        { ...receipt, reductionBytes: receipt.reductionBytes! - 1 },
        receipt.benchmarkId,
      ),
      null,
    );
    assert.equal(
      parseMcptoonManifestFootprintReceipt(
        { ...receipt, reductionPercent: 99.9 },
        receipt.benchmarkId,
      ),
      null,
    );
  });

  it('rejects observed evidence from an unreviewed version or with missing aggregates', () => {
    const receipt = validReceipt();
    assert.equal(
      parseMcptoonManifestFootprintReceipt({ ...receipt, version: '0.8.0' }, receipt.benchmarkId),
      null,
    );
    assert.equal(
      parseMcptoonManifestFootprintReceipt({ ...receipt, toolCount: null }, receipt.benchmarkId),
      null,
    );
  });

  it('rejects invalid measurement/cache timestamps', () => {
    const receipt = validReceipt();
    assert.equal(
      parseMcptoonManifestFootprintReceipt(
        { ...receipt, measuredAt: 'not-a-date' },
        receipt.benchmarkId,
      ),
      null,
    );
    assert.equal(
      parseMcptoonManifestFootprintReceipt(
        {
          ...receipt,
          oldestCacheEntryAt: '2026-09-13T12:01:00.000Z',
          newestCacheEntryAt: '2026-09-13T11:59:00.000Z',
        },
        receipt.benchmarkId,
      ),
      null,
    );
  });

  it('requires non-observed receipts to keep all footprint aggregates null', () => {
    const receipt = validReceipt();
    const unavailable = {
      ...receipt,
      state: 'unavailable',
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
    } as const;
    assert.notEqual(
      parseMcptoonManifestFootprintReceipt(unavailable, unavailable.benchmarkId),
      null,
    );
    assert.equal(
      parseMcptoonManifestFootprintReceipt(
        { ...unavailable, jsonBytes: 20_000 },
        unavailable.benchmarkId,
      ),
      null,
    );
  });
});
