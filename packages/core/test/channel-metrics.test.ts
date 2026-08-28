import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateChannelMetrics,
  harnessId,
  providerId,
  summarizePipelineTotal,
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

describe('pipeline metric total', () => {
  it('measures the one fully comparable channel without re-summing provider rows', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
        stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 }),
      ],
    );

    const total = summarizePipelineTotal(rows);
    assert.deepEqual(total, {
      status: 'measured',
      reason: null,
      class: 'exact-local',
      unit: 'tokens',
      before: 1000,
      after: 200,
      saved: 800,
      channels: 1,
      note: 'raw-to-final total for the single applied channel in this report',
    });
  });

  it('refuses to add two independently measured channels without cross-channel proof', () => {
    const second: MetricsChannelExpectation = {
      ...CHANNEL,
      toolFamily: 'PowerShell',
    };
    const rows = aggregateChannelMetrics(
      [CHANNEL, second],
      [
        stage({
          id: 'a-bash',
          provider: 'alpha',
          operation: 'bash',
          order: 0,
          before: 1000,
          after: 300,
        }),
        stage({
          id: 'b-bash',
          provider: 'beta',
          operation: 'bash',
          order: 1,
          before: 300,
          after: 200,
        }),
        stage({
          id: 'a-powershell',
          provider: 'alpha',
          operation: 'powershell',
          order: 0,
          before: 500,
          after: 250,
          toolFamily: 'PowerShell',
        }),
        stage({
          id: 'b-powershell',
          provider: 'beta',
          operation: 'powershell',
          order: 1,
          before: 250,
          after: 100,
          toolFamily: 'PowerShell',
        }),
      ],
    );

    const total = summarizePipelineTotal(rows);
    assert.equal(total.status, 'incomparable');
    assert.equal(total.reason, 'cross-channel-comparability-unproven');
    assert.equal(total.saved, null);
  });

  it('refuses a single channel whose window contains multiple measurement classes', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({
          id: 'a1',
          provider: 'alpha',
          operation: 'exact',
          order: 0,
          before: 1000,
          after: 300,
        }),
        stage({
          id: 'b1',
          provider: 'beta',
          operation: 'exact',
          order: 1,
          before: 300,
          after: 200,
        }),
        stage({
          id: 'a2',
          provider: 'alpha',
          operation: 'estimated',
          order: 0,
          before: 800,
          after: 400,
          unit: 'chars',
          measurementClass: 'estimated-local',
        }),
        stage({
          id: 'b2',
          provider: 'beta',
          operation: 'estimated',
          order: 1,
          before: 400,
          after: 300,
          unit: 'chars',
          measurementClass: 'estimated-local',
        }),
      ],
    );

    const total = summarizePipelineTotal(rows);
    assert.equal(total.status, 'incomparable');
    assert.equal(total.reason, 'measurement-class-or-unit-mismatch');
    assert.equal(total.saved, null);
  });

  it('does not call a partial measured window a pipeline total when unattributed residue exists', () => {
    const rows = aggregateChannelMetrics(
      [CHANNEL],
      [
        stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
        stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 }),
        stage({
          id: 'legacy',
          provider: 'alpha',
          operation: 'legacy',
          pipelineId: null,
          order: null,
          harness: 'unknown',
          toolFamily: null,
        }),
      ],
    );

    assert.equal(rows[0]?.status, 'measured');
    assert.equal(rows[0]?.unattributedOperations, 1);
    const total = summarizePipelineTotal(rows);
    assert.equal(total.status, 'unavailable');
    assert.equal(total.reason, 'channel-residue');
    assert.equal(total.saved, null);
  });

  it('reports an empty applied-channel inventory as unavailable rather than zero', () => {
    const total = summarizePipelineTotal([]);
    assert.equal(total.status, 'unavailable');
    assert.equal(total.reason, 'no-applied-channels');
    assert.equal(total.saved, null);
  });
});
