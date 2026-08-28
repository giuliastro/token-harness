import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateChannelMetrics,
  harnessId,
  providerId,
  type MetricsChannelExpectation,
  type OptimizationEvent,
} from '../src/index.js';

const CHANNEL: MetricsChannelExpectation = {
  pipelineId: 'pipe-1',
  harness: harnessId('claude'),
  toolFamily: 'Bash',
  capability: 'shell.output.reduce',
  owners: [providerId('alpha'), providerId('beta')],
};

function stage(input: {
  id: string;
  provider: string;
  operation?: string;
  order?: number | null;
  before?: number;
  after?: number;
  pipelineId?: string | null;
  harness?: string;
  toolFamily?: string | null;
  capability?: string;
  measurementClass?: 'exact-local' | 'estimated-local';
  unit?: 'tokens' | 'chars';
}): OptimizationEvent {
  const before = input.before ?? 1000;
  const after = input.after ?? 300;
  const unit = input.unit ?? 'tokens';
  return {
    schemaVersion: 1,
    eventId: input.id,
    timestamp: '2026-08-28T09:00:00.000Z',
    provider: { id: input.provider, version: '1.0.0' },
    context: {
      projectId: 'p_test',
      harnessId: input.harness ?? 'claude',
      sessionId: null,
      operationId: input.operation ?? 'op-1',
      pipelineId: input.pipelineId === undefined ? 'pipe-1' : input.pipelineId,
      pipelineOrder: input.order === undefined ? 0 : input.order,
      toolFamily: input.toolFamily === undefined ? 'Bash' : input.toolFamily,
      capability: input.capability ?? 'shell.output.reduce',
    },
    measurement: {
      class: input.measurementClass ?? 'exact-local',
      beforeChars: unit === 'chars' ? before : null,
      afterChars: unit === 'chars' ? after : null,
      beforeTokens: unit === 'tokens' ? before : null,
      afterTokens: unit === 'tokens' ? after : null,
      tokenizer: unit === 'tokens' ? 'test' : null,
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: before !== after,
      bypassReason: null,
      originalReference: null,
      latencyMs: null,
      errorCode: null,
    },
    source: { nativeEventId: input.id, importedAt: '2026-08-28T09:01:00.000Z' },
  };
}

describe('channel metrics', () => {
  it('measures a complete applied channel raw to final', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
        stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 }),
      ],
    );

    const row = rows[0];
    assert.ok(row);
    assert.equal(row.status, 'measured');
    assert.equal(row.operations, 1);
    assert.equal(row.incomparableOperations, 0);
    const exact = row.classes.find((entry) => entry.class === 'exact-local');
    assert.ok(exact);
    assert.equal(exact.saved, 800);
    assert.equal(exact.operations, 1);
  });

  it('refuses to call one observed owner a complete two-owner channel', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 })],
    );

    const row = rows[0];
    assert.ok(row);
    assert.equal(row.status, 'incomparable');
    assert.equal(row.operations, 0);
    assert.equal(row.incomparableOperations, 1);
    assert.deepEqual(row.incomparableReasons, ['owner-stage-mismatch']);
  });

  it('reports historical provider events with no pipeline identity as unattributable', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({
          id: 'legacy',
          provider: 'alpha',
          pipelineId: null,
          order: null,
          harness: 'unknown',
          toolFamily: null,
        }),
      ],
    );

    const row = rows[0];
    assert.ok(row);
    assert.equal(row.status, 'attribution-unavailable');
    assert.equal(row.unattributedOperations, 1);
    assert.equal(row.operations, 0);
  });

  it('reports no measurement instead of zero when the channel has no events', () => {
    const row = aggregateChannelMetrics([CHANNEL], [])[0];
    assert.ok(row);
    assert.equal(row.status, 'unmeasured');
    assert.equal(row.operations, 0);
    assert.equal(row.classes.find((entry) => entry.class === 'exact-local')?.saved, null);
  });

  it('keeps measurement classes separate inside one channel', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({
          id: 'a1',
          provider: 'alpha',
          operation: 'op-exact',
          order: 0,
          before: 1000,
          after: 300,
        }),
        stage({
          id: 'b1',
          provider: 'beta',
          operation: 'op-exact',
          order: 1,
          before: 300,
          after: 200,
        }),
        stage({
          id: 'a2',
          provider: 'alpha',
          operation: 'op-estimated',
          order: 0,
          before: 900,
          after: 400,
          unit: 'chars',
          measurementClass: 'estimated-local',
        }),
        stage({
          id: 'b2',
          provider: 'beta',
          operation: 'op-estimated',
          order: 1,
          before: 400,
          after: 250,
          unit: 'chars',
          measurementClass: 'estimated-local',
        }),
      ],
    );

    const row = rows[0];
    assert.ok(row);
    assert.equal(row.status, 'measured');
    assert.equal(row.operations, 2);
    assert.equal(row.classes.find((entry) => entry.class === 'exact-local')?.saved, 800);
    assert.equal(row.classes.find((entry) => entry.class === 'estimated-local')?.saved, 650);
  });

  it('does not assign events from a different pipeline to this channel', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({
          id: 'other',
          provider: 'alpha',
          pipelineId: 'pipe-2',
          order: 0,
        }),
      ],
    );

    assert.equal(rows[0]?.status, 'unmeasured');
  });

  it('deduplicates repeated event ids before channel accounting', () => {
    const alpha = stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 });
    const beta = stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 });
    const row = aggregateChannelMetrics([CHANNEL], [alpha, alpha, beta, beta])[0];

    assert.ok(row);
    assert.equal(row.status, 'measured');
    assert.equal(row.operations, 1);
    assert.equal(row.classes.find((entry) => entry.class === 'exact-local')?.saved, 800);
  });
});
