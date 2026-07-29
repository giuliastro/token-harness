import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HarnessId, ProviderId } from '@token-harness/core';

import {
  findHarnessAdapter,
  findProviderAdapter,
  listHarnessAdapters,
  listProviderAdapters,
} from '../src/index.js';

describe('adapter registries', () => {
  it('are empty at 0.1.0, and say so by returning nothing rather than throwing', () => {
    assert.deepEqual([...listHarnessAdapters()], []);
    assert.deepEqual([...listProviderAdapters()], []);
  });

  it('return null for a lookup instead of inventing an adapter', () => {
    assert.equal(findHarnessAdapter('claude' as HarnessId), null);
    assert.equal(findProviderAdapter('rtk' as ProviderId), null);
  });
});
