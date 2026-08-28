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
    const result = providerRemovalOrder(
      [
        owned({ provider: 'alpha', order: 0 }),
        owned({ provider: 'beta', order: 1 }),
        owned({ provider: 'gamma', order: 2 }),
      ],
      [providerId('alpha'), providerId('beta'), providerId('gamma')],
    );

    assert.deepEqual(result, {
      ok: true,
      order: [providerId('gamma'), providerId('beta'), providerId('alpha')],
    });
  });

  it('uses a stable order for providers with no recorded dependency', () => {
    const result = providerRemovalOrder(
      [],
      [providerId('zeta'), providerId('alpha'), providerId('middle')],
    );

    assert.deepEqual(result, {
      ok: true,
      order: [providerId('alpha'), providerId('middle'), providerId('zeta')],
    });
  });

  it('ignores recorded owners that are not being removed', () => {
    const result = providerRemovalOrder(
      [
        owned({ provider: 'alpha', order: 0 }),
        owned({ provider: 'beta', order: 1 }),
      ],
      [providerId('alpha')],
    );

    assert.deepEqual(result, { ok: true, order: [providerId('alpha')] });
  });

  it('refuses contradictory dependency chains instead of guessing', () => {
    const result = providerRemovalOrder(
      [
        owned({ provider: 'alpha', order: 0, point: 'pre-tool-use' }),
        owned({ provider: 'beta', order: 1, point: 'pre-tool-use' }),
        owned({ provider: 'beta', order: 0, point: 'post-tool-use' }),
        owned({ provider: 'alpha', order: 1, point: 'post-tool-use' }),
      ],
      [providerId('alpha'), providerId('beta')],
    );

    assert.deepEqual(result, {
      ok: false,
      reason: 'dependency-cycle',
      providers: [providerId('alpha'), providerId('beta')],
    });
  });

  it('refuses two providers recorded at the same position in one chain', () => {
    const result = providerRemovalOrder(
      [
        owned({ provider: 'alpha', order: 0 }),
        owned({ provider: 'beta', order: 0 }),
      ],
      [providerId('alpha'), providerId('beta')],
    );

    assert.deepEqual(result, {
      ok: false,
      reason: 'ambiguous-recorded-order',
      providers: [providerId('alpha'), providerId('beta')],
    });
  });
});
