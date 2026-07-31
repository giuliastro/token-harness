/**
 * `aggregateEvents` and `resolveMetricsWindow` — RFC 0005 §Measurement classes and
 * RFC 0006 §Golden path.
 *
 * The rule under test throughout: "These classes are never merged into an unlabeled exact
 * total." Most of these cases exist because a plausible implementation would break it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_WINDOW,
  aggregateEvents,
  measurementUnit,
  resolveMetricsWindow,
  type MeasurementClass,
  type OptimizationEvent,
} from '../src/index.js';

const WINDOW = { windowStart: '2026-07-24', windowEnd: '2026-07-31' };

function event(overrides: {
  id?: string;
  provider?: string;
  harness?: string;
  pipelineId?: string | null;
  measurementClass?: MeasurementClass;
  beforeTokens?: number | null;
  afterTokens?: number | null;
  beforeChars?: number | null;
  afterChars?: number | null;
  changed?: boolean;
  latencyMs?: number | null;
  errorCode?: string | null;
}): OptimizationEvent {
  const beforeTokens = overrides.beforeTokens === undefined ? 100 : overrides.beforeTokens;
  const afterTokens = overrides.afterTokens === undefined ? 40 : overrides.afterTokens;
  return {
    schemaVersion: 1,
    eventId: overrides.id ?? 'e1',
    timestamp: '2026-07-30T10:00:00.000Z',
    provider: { id: overrides.provider ?? 'rtk', version: '0.42.0' },
    context: {
      projectId: 'p_1',
      harnessId: overrides.harness ?? 'claude',
      sessionId: null,
      operationId: overrides.id ?? 'e1',
      pipelineId: overrides.pipelineId ?? null,
      pipelineOrder: null,
      toolFamily: null,
      capability: 'shell.output.reduce',
    },
    measurement: {
      class: overrides.measurementClass ?? 'exact-local',
      beforeChars: overrides.beforeChars ?? null,
      afterChars: overrides.afterChars ?? null,
      beforeTokens,
      afterTokens,
      tokenizer: 'rtk',
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: overrides.changed ?? true,
      bypassReason: null,
      originalReference: null,
      latencyMs: overrides.latencyMs ?? null,
      errorCode: overrides.errorCode ?? null,
    },
    source: { nativeEventId: null, importedAt: '2026-07-31T09:00:00.000Z' },
  };
}

function classRow(report: ReturnType<typeof aggregateEvents>, id: MeasurementClass) {
  const row = report.classes.find((entry) => entry.class === id);
  assert.ok(row, `no ${id} row`);
  return row;
}

describe('measurement classes stay apart', () => {
  it('always emits all four classes, in RFC order', () => {
    const report = aggregateEvents({ events: [], ...WINDOW });
    assert.deepEqual(
      report.classes.map((row) => row.class),
      ['exact-local', 'estimated-local', 'counterfactual', 'end-to-end-billed'],
    );
  });

  it('never adds tokens to characters', () => {
    const report = aggregateEvents({
      events: [
        event({ id: 'a', beforeTokens: 100, afterTokens: 40 }),
        event({
          id: 'b',
          measurementClass: 'estimated-local',
          beforeTokens: null,
          afterTokens: null,
          beforeChars: 900,
          afterChars: 300,
        }),
      ],
      ...WINDOW,
    });

    assert.equal(classRow(report, 'exact-local').saved, 60);
    assert.equal(classRow(report, 'exact-local').unit, 'tokens');
    assert.equal(classRow(report, 'estimated-local').saved, 600);
    assert.equal(classRow(report, 'estimated-local').unit, 'chars');
  });

  it('refuses to pick a unit when one class carries two', () => {
    const report = aggregateEvents({
      events: [
        event({ id: 'a', beforeTokens: 100, afterTokens: 40 }),
        event({
          id: 'b',
          beforeTokens: null,
          afterTokens: null,
          beforeChars: 900,
          afterChars: 300,
        }),
      ],
      ...WINDOW,
    });

    const row = classRow(report, 'exact-local');
    // Picking one silently is how a report starts lying; the line says why it has no figure.
    assert.equal(row.saved, null);
    assert.match(row.note ?? '', /not addable/);
  });

  it('says "no A/B run" for end-to-end-billed and "none recorded" for the rest', () => {
    const report = aggregateEvents({ events: [], ...WINDOW });
    assert.equal(classRow(report, 'end-to-end-billed').note, 'no A/B run');
    assert.equal(classRow(report, 'counterfactual').note, 'none recorded');
  });
});

describe('a counterfactual is not a saving', () => {
  const events = [
    event({ id: 'real', beforeTokens: 100, afterTokens: 40 }),
    event({
      id: 'dry',
      measurementClass: 'counterfactual',
      beforeTokens: 1000,
      afterTokens: 10,
      changed: false,
    }),
  ];

  it('appears on its own class line', () => {
    const report = aggregateEvents({ events, ...WINDOW });
    assert.equal(classRow(report, 'counterfactual').saved, 990);
  });

  it('never reaches a provider row', () => {
    const report = aggregateEvents({ events, ...WINDOW });
    // RFC 0005: those bytes stayed in context. 990 in a provider total would be a saving
    // that did not occur, next to one that did.
    assert.equal(report.providers.length, 1);
    assert.equal(report.providers[0]?.saved, 60);
  });

  it('counts as neither covered nor bypassed', () => {
    const report = aggregateEvents({ events, ...WINDOW });
    assert.equal(report.coveragePercent, 100);
    assert.equal(report.bypassed, 0);
  });
});

describe('an inflated payload', () => {
  const events = [
    event({ id: 'shrank', beforeTokens: 100, afterTokens: 40 }),
    // The real case: 240 rows on the machine this was written against, and RTK's own
    // `saved_tokens` floors each of them at zero.
    event({ id: 'grew', beforeTokens: 100, afterTokens: 150 }),
  ];

  it('is counted, and named', () => {
    const report = aggregateEvents({ events, ...WINDOW });
    assert.equal(report.inflatedOperations, 1);
  });

  it('leaves the class line and the provider row in agreement', () => {
    const report = aggregateEvents({ events, ...WINDOW });
    // Summing only the reductions made these two disagree by 1,149 tokens on a real report,
    // with nothing on the page to explain the gap. Both are now the net effect.
    assert.equal(classRow(report, 'exact-local').saved, 10);
    assert.equal(report.providers[0]?.saved, 10);
  });

  it('can take a provider total negative rather than clamping it', () => {
    const report = aggregateEvents({
      events: [event({ id: 'grew', beforeTokens: 100, afterTokens: 300 })],
      ...WINDOW,
    });
    // Clamping at zero is what RTK's own column does, and it is why `rtk gain` cannot report
    // this at all.
    assert.equal(report.providers[0]?.saved, -200);
  });
});

describe('provider rows', () => {
  it('are one per provider, class, and unit', () => {
    const report = aggregateEvents({
      events: [
        event({ id: 'a', provider: 'rtk' }),
        event({ id: 'b', provider: 'rtk' }),
        event({
          id: 'c',
          provider: 'harnesstrim',
          measurementClass: 'estimated-local',
          beforeTokens: null,
          afterTokens: null,
          beforeChars: 900,
          afterChars: 300,
        }),
      ],
      ...WINDOW,
    });

    assert.equal(report.providers.length, 2);
    // Largest saving first: the question the report answers is which provider earns its place.
    assert.equal(report.providers[0]?.providerId, 'harnesstrim');
    assert.equal(report.providers[0]?.unit, 'chars');
    assert.equal(report.providers[1]?.operations, 2);
  });

  it('omit `unknown` from the harness list', () => {
    const report = aggregateEvents({
      events: [event({ id: 'a', harness: 'unknown' })],
      ...WINDOW,
    });
    // What an importer records when the source does not say. Beside real names it reads as one.
    assert.deepEqual(report.providers[0]?.harnesses, []);
  });

  it('are "adopted, not managed" unless named as managed', () => {
    const events = [event({ id: 'a' })];
    assert.equal(aggregateEvents({ events, ...WINDOW }).providers[0]?.managedByTokenHarness, false);
    assert.equal(
      aggregateEvents({ events, managedProviders: ['rtk'], ...WINDOW }).providers[0]
        ?.managedByTokenHarness,
      true,
    );
  });

  it('carry the importer mode beside the figure it produced', () => {
    const report = aggregateEvents({
      events: [event({ id: 'a' })],
      adapterModes: { rtk: 'native' },
      ...WINDOW,
    });
    assert.equal(report.providers[0]?.adapterMode, 'native');
  });

  it('exclude an unchanged interception', () => {
    const report = aggregateEvents({
      events: [event({ id: 'a', beforeTokens: 40, afterTokens: 40, changed: false })],
      ...WINDOW,
    });
    assert.deepEqual(report.providers, []);
    assert.equal(report.bypassed, 1);
  });
});

describe('duplicates', () => {
  it('are counted once', () => {
    // A cursor bug re-imported RTK's whole table on every run and every figure doubled. This
    // is RFC 0005's stated safety net — the identity discarding what is already held.
    const report = aggregateEvents({
      events: [event({ id: 'same' }), event({ id: 'same' }), event({ id: 'same' })],
      ...WINDOW,
    });
    assert.equal(classRow(report, 'exact-local').saved, 60);
    assert.equal(report.providers[0]?.operations, 1);
  });
});

describe('the summary line', () => {
  it('reports coverage as null when nothing happened', () => {
    const report = aggregateEvents({ events: [], ...WINDOW });
    // `0%` would say nothing was optimized where the truth is that nothing happened.
    assert.equal(report.coveragePercent, null);
  });

  it('reports latency as null when no event measured one', () => {
    const report = aggregateEvents({ events: [event({ id: 'a' })], ...WINDOW });
    // Zero would claim the overhead was measured and found negligible.
    assert.equal(report.addedMedianLatencyMs, null);
  });

  it('takes the median of the events that did measure one', () => {
    const report = aggregateEvents({
      events: [
        event({ id: 'a', latencyMs: 5 }),
        event({ id: 'b', latencyMs: 11 }),
        event({ id: 'c', latencyMs: 99 }),
        event({ id: 'd', latencyMs: null }),
      ],
      ...WINDOW,
    });
    assert.equal(report.addedMedianLatencyMs, 11);
  });

  it('counts errors', () => {
    const report = aggregateEvents({
      events: [event({ id: 'a', errorCode: 'spawn-failed' })],
      ...WINDOW,
    });
    assert.equal(report.errors, 1);
  });

  it('names a pipeline only when the window has exactly one', () => {
    const one = aggregateEvents({ events: [event({ id: 'a', pipelineId: 'b41e' })], ...WINDOW });
    assert.equal(one.pipelineId, 'b41e');

    const two = aggregateEvents({
      events: [event({ id: 'a', pipelineId: 'b41e' }), event({ id: 'b', pipelineId: 'other' })],
      ...WINDOW,
    });
    // Naming the first would attribute the whole report to it.
    assert.equal(two.pipelineId, null);
  });
});

describe('measurementUnit', () => {
  it('prefers tokens, and reports neither when both are absent', () => {
    assert.equal(measurementUnit(event({ beforeTokens: 1, afterTokens: 1 })), 'tokens');
    assert.equal(
      measurementUnit(
        event({ beforeTokens: null, afterTokens: null, beforeChars: 1, afterChars: 1 }),
      ),
      'chars',
    );
    assert.equal(measurementUnit(event({ beforeTokens: null, afterTokens: null })), null);
  });
});

describe('resolveMetricsWindow', () => {
  const NOW = '2026-07-31T12:00:00.000Z';

  it('defaults to a week, matching the RFC transcript', () => {
    const resolved = resolveMetricsWindow({ now: NOW });
    assert.ok(resolved.ok);
    assert.equal(DEFAULT_WINDOW, '7d');
    assert.equal(resolved.window.windowStart, '2026-07-24');
    assert.equal(resolved.window.windowEnd, '2026-07-31');
  });

  const durations: ReadonlyArray<readonly [string, string]> = [
    ['7d', '2026-07-24'],
    ['1d', '2026-07-30'],
    ['2w', '2026-07-17'],
    ['12h', '2026-07-31'],
    ['30m', '2026-07-31'],
  ];

  for (const [value, expectedStart] of durations) {
    it(`accepts ${value}`, () => {
      const resolved = resolveMetricsWindow({ since: value, now: NOW });
      assert.ok(resolved.ok);
      assert.equal(resolved.window.windowStart, expectedStart);
    });
  }

  it('accepts an absolute date, anchored to midnight UTC', () => {
    const resolved = resolveMetricsWindow({ since: '2026-07-22', now: NOW });
    assert.ok(resolved.ok);
    // Not local midnight: a boundary that moves with the reader's timezone is not
    // reproducible, and RFC 0005 stamps events in UTC.
    assert.equal(resolved.window.sinceInstant, '2026-07-22T00:00:00.000Z');
  });

  it('includes the whole day named by --until', () => {
    const resolved = resolveMetricsWindow({ since: '2026-07-22', until: '2026-07-29', now: NOW });
    assert.ok(resolved.ok);
    // The exclusive instant is the following midnight, so the 29th is reported rather than
    // truncated at the moment it began.
    assert.equal(resolved.window.untilInstant, '2026-07-30T00:00:00.000Z');
    assert.equal(resolved.window.windowEnd, '2026-07-29');
  });

  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['a word', 'banana'],
    ['a duration with no unit', '7'],
    ['an unknown unit', '7y'],
    ['trailing junk', '7dx'],
    ['a reversed duration', 'd7'],
    ['a partial date', '2026-07'],
    // Matches the date pattern and is not a day.
    ['an impossible date', '2026-02-31'],
    ['a zero duration', '0d'],
  ];

  for (const [name, value] of rejected) {
    it(`rejects ${name}`, () => {
      const resolved = resolveMetricsWindow({ since: value, now: NOW });
      assert.equal(resolved.ok, false);
    });
  }

  it('rejects a window whose start is not before its end', () => {
    const resolved = resolveMetricsWindow({ since: '2026-07-29', until: '2026-07-22', now: NOW });
    assert.ok(!resolved.ok);
    assert.equal(resolved.failure, 'start-after-end');
  });
});
