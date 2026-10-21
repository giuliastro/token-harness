import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEASUREMENT_CLASSES,
  aggregateEvents,
  dailySavings,
  isMeasurementClass,
  isRealizedSaving,
  isSummableWith,
  type OptimizationEvent,
} from '../src/index.js';

function event(overrides: {
  class: OptimizationEvent['measurement']['class'];
  tokens?: boolean;
  changed?: boolean;
  id?: string;
  provider?: string;
  harness?: string;
  errorCode?: string | null;
}): OptimizationEvent {
  const tokens = overrides.tokens ?? false;
  return {
    schemaVersion: 1,
    eventId: overrides.id ?? 'e1',
    timestamp: '2026-07-29T10:12:04Z',
    provider: { id: overrides.provider ?? 'harnesstrim', version: '0.0.5' },
    context: {
      projectId: 'p_1',
      harnessId: overrides.harness ?? 'opencode',
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
      errorCode: overrides.errorCode ?? null,
    },
    source: { nativeEventId: null, importedAt: '2026-07-29T10:13:00Z' },
  };
}

describe('metrics error breakdown', () => {
  it('groups historical errors by code while retaining providers and harnesses', () => {
    const report = aggregateEvents({
      events: [
        event({
          id: 'failure-1',
          class: 'estimated-local',
          changed: false,
          provider: 'harnesstrim',
          harness: 'opencode',
          errorCode: 'harnesstrim-reducer-failed:test-output-slim',
        }),
        event({
          id: 'failure-2',
          class: 'estimated-local',
          changed: false,
          provider: 'harnesstrim',
          harness: 'pi',
          errorCode: 'harnesstrim-reducer-failed:test-output-slim',
        }),
        event({
          id: 'other-failure',
          class: 'estimated-local',
          changed: false,
          provider: 'rtk',
          harness: 'claude',
          errorCode: 'provider-timeout',
        }),
      ],
      windowStart: '2026-08-26',
      windowEnd: '2026-09-02',
    });

    assert.equal(report.errors, 3);
    assert.deepEqual(report.errorBreakdown, [
      {
        code: 'harnesstrim-reducer-failed:test-output-slim',
        count: 2,
        providerIds: ['harnesstrim'],
        harnesses: ['opencode', 'pi'],
      },
      {
        code: 'provider-timeout',
        count: 1,
        providerIds: ['rtk'],
        harnesses: ['claude'],
      },
    ]);
  });

  it('deduplicates repeated event ids before counting errors', () => {
    const failure = event({
      id: 'same',
      class: 'estimated-local',
      changed: false,
      errorCode: 'harnesstrim-reducer-failed:lint-output-slim',
    });
    const report = aggregateEvents({
      events: [failure, failure],
      windowStart: '2026-08-26',
      windowEnd: '2026-09-02',
    });

    assert.equal(report.errors, 1);
    assert.equal(report.errorBreakdown[0]?.count, 1);
  });
});

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

describe('dailySavings', () => {
  function at(id: string, timestamp: string, extra: Parameters<typeof event>[0]): OptimizationEvent {
    return { ...event({ ...extra, id }), timestamp };
  }

  it('groups by UTC date and keeps classes and units apart', () => {
    const events = [
      at('a', '2026-07-29T23:59:59Z', { class: 'exact-local', tokens: true }),
      at('b', '2026-07-30T00:00:00Z', { class: 'exact-local', tokens: true }),
      at('c', '2026-07-30T05:00:00Z', { class: 'exact-local', tokens: false }),
      at('d', '2026-07-30T06:00:00Z', { class: 'estimated-local' }),
      at('e', '2026-07-30T07:00:00Z', { class: 'counterfactual' }),
      at('f', '2026-07-30T08:00:00Z', { class: 'exact-local', tokens: true, changed: false }),
    ];
    const rows = dailySavings(events, '2026-07-31');
    assert.deepEqual(
      rows.map((r) => [r.date, r.class, r.unit, r.saved, r.operations]),
      [
        ['2026-07-29', 'exact-local', 'tokens', 150, 1],
        ['2026-07-30', 'estimated-local', 'chars', 600, 1],
        ['2026-07-30', 'exact-local', 'chars', 600, 1],
        ['2026-07-30', 'exact-local', 'tokens', 150, 1],
      ],
    );
  });

  it('counts a duplicated event id once and sums to the provider rows', () => {
    const events = [
      at('a', '2026-07-29T10:00:00Z', { class: 'exact-local', tokens: true }),
      at('a', '2026-07-29T10:00:00Z', { class: 'exact-local', tokens: true }),
      at('b', '2026-07-30T10:00:00Z', { class: 'exact-local', tokens: true }),
    ];
    const rows = dailySavings(events, '2026-07-31');
    const report = aggregateEvents({
      events,
      windowStart: '2026-07-24',
      windowEnd: '2026-07-31',
    });
    assert.equal(
      rows.reduce((sum, r) => sum + r.saved, 0),
      report.providers.reduce((sum, r) => sum + r.saved, 0),
    );
    assert.equal(rows.length, 2);
  });

  it('keeps only the last 90 days of the window', () => {
    const events = [
      at('old', '2026-05-03T10:00:00Z', { class: 'exact-local', tokens: true }),
      at('edge', '2026-05-04T10:00:00Z', { class: 'exact-local', tokens: true }),
    ];
    // 90 days ending 2026-08-01 begin on 2026-05-04.
    assert.deepEqual(
      dailySavings(events, '2026-08-01').map((r) => r.date),
      ['2026-05-04'],
    );
  });

  it('returns nothing for no events', () => {
    assert.deepEqual(dailySavings([], '2026-07-31'), []);
  });
});
