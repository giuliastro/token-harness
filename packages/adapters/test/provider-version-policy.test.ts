import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyVersion } from '@token-harness/core';

import {
  CURRENT_PROVIDER_RELEASES,
  CURRENT_PROVIDER_VERSION_RANGES,
} from '../src/providers/index.js';

describe('current provider release policy', () => {
  it('recognises the current HarnessTrim stable release', () => {
    assert.equal(CURRENT_PROVIDER_RELEASES.harnesstrim, '0.3.0');
    assert.equal(classifyVersion('0.3.0', CURRENT_PROVIDER_VERSION_RANGES.harnesstrim), 'in-range');
    assert.equal(
      classifyVersion('0.3.1', CURRENT_PROVIDER_VERSION_RANGES.harnesstrim),
      'unknown-newer',
    );
  });

  it('recognises the current RTK stable release', () => {
    assert.equal(CURRENT_PROVIDER_RELEASES.rtk, '0.49.0');
    assert.equal(classifyVersion('0.49.0', CURRENT_PROVIDER_VERSION_RANGES.rtk), 'in-range');
    assert.equal(classifyVersion('0.50.0', CURRENT_PROVIDER_VERSION_RANGES.rtk), 'unknown-newer');
  });

  it('keeps older supported builds in range without calling them current', () => {
    assert.equal(classifyVersion('0.44.0', CURRENT_PROVIDER_VERSION_RANGES.rtk), 'in-range');
    assert.equal(classifyVersion('0.1.0', CURRENT_PROVIDER_VERSION_RANGES.harnesstrim), 'in-range');
  });
});
