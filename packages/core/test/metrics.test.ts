import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEASUREMENT_CLASSES,
  isMeasurementClass,
  isRealizedSaving,
  isSummableWith,
  type OptimizationEvent,
} from '../src/index.js';

function event(overrides: {
  class: OptimizationEvent['measurement']['class'];
  tokens?: boolean;
  changed?: boolean;
}): OptimizationEvent {
  const tokens = overrides.tokens ?? false;
  return {
    schemaVersion: 1,
    eventId: 'e1',
    timestamp: '2026-07-29T10:12:04Z',
    provider: { id: 'harnesstrim', version: '0.0.5' },
    context: {
      projectId: 'p_1',
      harnessId: 'opencode',
      sessionId: null,
      operationId: 'op_1',
      pipelineId: 'b41e',
      pipelineOrder: 0,
      toolFamily: 'bash',
      capability: 'shell.output.reduce',
    },
    measurement: {
      class: overrides.class,
      beforeChars: 1000,
      afterChars: 400,
      beforeTokens: tokens ? 250 : null,
      afterTokens: tokens ? 100 : null,
      tokenizer: tokens ? 'o200k_base' : null,
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: overrides.changed ?? true,
      bypassReason: null,
      originalReference: null,
      latencyMs: 3,
      errorCode: null,
    },
    source: { nativeEventId: null, importedAt: '2026-07-29T10:13:00Z' },
  };
}

describe('measurement classes', () => {
  it('carries the four RFC 0005 classes', () => {
    assert.deepEqual(
      [...MEASUREMENT_CLASSES],
      ['exact-local', 'estimated-local', 'counterfactual', 'end-to-end-billed'],
    );
    assert.equal(isMeasurementClass('estimated-local'), true);
    assert.equal(isMeasurementClass('roughly'), false);
  });

  it('refuses to sum across classes', () => {
    assert.equal(
      isSummableWith(
        event({ class: 'exact-local', tokens: true }),
        event({ class: 'estimated-local' }),
      ),
      false,
    );
  });

  it('refuses to sum tokens with characters inside one class', () => {
    assert.equal(
      isSummableWith(
        event({ class: 'estimated-local', tokens: true }),
        event({ class: 'estimated-local', tokens: false }),
      ),
      false,
    );
  });

  it('sums within one class and one unit', () => {
    assert.equal(
      isSummableWith(event({ class: 'estimated-local' }), event({ class: 'estimated-local' })),
      true,
    );
  });

  it('never counts a dryrun reduction as a realized saving', () => {
    // RFC 0005: a `dryrun` event describes bytes that stayed in context.
    assert.equal(isRealizedSaving(event({ class: 'counterfactual', changed: false })), false);
    assert.equal(isRealizedSaving(event({ class: 'estimated-local', changed: true })), true);
    assert.equal(isRealizedSaving(event({ class: 'estimated-local', changed: false })), false);
  });
});
