import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  providerRemovalOrder,
  type CapabilityId,
  type ResolvedCapability,
} from '../src/index.js';

function owned(input: {
  provider: string;
  order: number;
  point?: string;
  capability?: CapabilityId;
}): ResolvedCapability {
  return {
    scope: {
      harness: harnessId('claude'),
      toolFamily: 'Bash',
      interceptionPoint: input.point ?? 'post-tool-use',
      capability: input.capability ?? 'shell.output.deduplicate',
    },
    owner: providerId(input.provider),
    mode: 'chainable',
    order: input.order,
  };
}

describe('provider removal order', () => {
  it('reverses a recorded ordered chain', () => {
    const alpha = providerId('alpha');
    const beta = providerId('beta');
    const gamma = providerId('gamma');
    const ownership = [
      owned({ provider: 'alpha', order: 0 }),
      owned({ provider: 'beta', order: 1 }),
      owned({ provider: 'gamma', order: 2 }),
    ];

    const result = providerRemovalOrder(ownership, [alpha, beta, gamma]);

    assert.deepEqual(result, { ok: true, order: [gamma, beta, alpha] });
  });

  it('uses a stable order for providers with no recorded dependency', () => {
    const alpha = providerId('alpha');
    const middle = providerId('middle');
    const zeta = providerId('zeta');

    const result = providerRemovalOrder([], [zeta, alpha, middle]);

    assert.deepEqual(result, { ok: true, order: [alpha, middle, zeta] });
  });

  it('ignores recorded owners that are not being removed', () => {
    const alpha = providerId('alpha');
    const ownership = [
      owned({ provider: 'alpha', order: 0 }),
      owned({ provider: 'beta', order: 1 }),
    ];

    const result = providerRemovalOrder(ownership, [alpha]);

    assert.deepEqual(result, { ok: true, order: [alpha] });
  });

  it('refuses contradictory dependency chains instead of guessing', () => {
    const alpha = providerId('alpha');
    const beta = providerId('beta');
    const ownership = [
      owned({ provider: 'alpha', order: 0, point: 'pre-tool-use' }),
      owned({ provider: 'beta', order: 1, point: 'pre-tool-use' }),
      owned({ provider: 'beta', order: 0, point: 'post-tool-use' }),
      owned({ provider: 'alpha', order: 1, point: 'post-tool-use' }),
    ];

    const result = providerRemovalOrder(ownership, [alpha, beta]);

    assert.deepEqual(result, {
      ok: false,
      reason: 'dependency-cycle',
      providers: [alpha, beta],
    });
  });

  it('refuses two providers recorded at the same position in one chain', () => {
    const alpha = providerId('alpha');
    const beta = providerId('beta');
    const ownership = [
      owned({ provider: 'alpha', order: 0 }),
      owned({ provider: 'beta', order: 0 }),
    ];

    const result = providerRemovalOrder(ownership, [alpha, beta]);

    assert.deepEqual(result, {
      ok: false,
      reason: 'ambiguous-recorded-order',
      providers: [alpha, beta],
    });
  });
});
