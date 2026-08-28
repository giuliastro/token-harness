import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  measurePipelineOperation,
  type MeasurementClass,
  type OptimizationEvent,
} from '../src/index.js';

function stage(input: {
  id: string;
  provider: string;
  order: number | null;
  before: number | null;
  after: number | null;
  pipelineId?: string | null;
  operationId?: string;
  measurementClass?: MeasurementClass;
  unit?: 'tokens' | 'chars';
  changed?: boolean;
  errorCode?: string | null;
}): OptimizationEvent {
  const unit = input.unit ?? 'tokens';
  return {
    schemaVersion: 1,
    eventId: input.id,
    timestamp: '2026-08-28T09:00:00.000Z',
    provider: { id: input.provider, version: '1.0.0' },
    context: {
      projectId: 'p_test',
      harnessId: 'claude',
      sessionId: null,
      operationId: input.operationId ?? 'op-1',
      pipelineId: input.pipelineId === undefined ? 'pipe-1' : input.pipelineId,
      pipelineOrder: input.order,
      toolFamily: 'Bash',
      capability: 'shell.output.reduce',
    },
    measurement: {
      class: input.measurementClass ?? 'exact-local',
      beforeChars: unit === 'chars' ? input.before : null,
      afterChars: unit === 'chars' ? input.after : null,
      beforeTokens: unit === 'tokens' ? input.before : null,
      afterTokens: unit === 'tokens' ? input.after : null,
      tokenizer: unit === 'tokens' ? 'test' : null,
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: input.changed ?? input.before !== input.after,
      bypassReason: null,
      originalReference: null,
      latencyMs: null,
      errorCode: input.errorCode ?? null,
    },
    source: { nativeEventId: input.id, importedAt: '2026-08-28T09:01:00.000Z' },
  };
}

describe('pipeline operation accounting', () => {
  it('counts an ordered chain raw to final exactly once', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 }),
    ]);

    assert.deepEqual(result, {
      status: 'measured',
      pipelineId: 'pipe-1',
      operationId: 'op-1',
      class: 'exact-local',
      unit: 'tokens',
      before: 1000,
      after: 200,
      saved: 800,
      providers: ['alpha', 'beta'],
      stages: 2,
    });
  });

  it('sorts stages by pipelineOrder before measuring them', () => {
    const result = measurePipelineOperation([
      stage({ id: 'b', provider: 'beta', order: 1, before: 300, after: 200 }),
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
    ]);

    assert.equal(result.status, 'measured');
    if (result.status !== 'measured') return;
    assert.equal(result.saved, 800);
    assert.deepEqual(result.providers, ['alpha', 'beta']);
  });

  it('refuses a second stage that claims the raw baseline again', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({ id: 'b', provider: 'beta', order: 1, before: 1000, after: 200 }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'stage-boundary-mismatch');
  });

  it('refuses to mix measurement classes in one chain', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({
        id: 'b',
        provider: 'beta',
        order: 1,
        before: 300,
        after: 200,
        measurementClass: 'estimated-local',
      }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'measurement-class-mismatch');
  });

  it('refuses to mix tokens and characters in one chain', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({
        id: 'b',
        provider: 'beta',
        order: 1,
        before: 300,
        after: 200,
        unit: 'chars',
      }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'measurement-unit-mismatch');
  });

  it('refuses a counterfactual stage in a realized pipeline total', () => {
    const result = measurePipelineOperation([
      stage({
        id: 'dry',
        provider: 'alpha',
        order: 0,
        before: 1000,
        after: 300,
        measurementClass: 'counterfactual',
        changed: false,
      }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'counterfactual-stage');
  });

  it('refuses a mislabeled stage whose payload was not actually changed', () => {
    const result = measurePipelineOperation([
      stage({
        id: 'dry',
        provider: 'alpha',
        order: 0,
        before: 1000,
        after: 300,
        changed: false,
      }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'unrealized-stage');
  });

  it('accepts an unchanged stage when its output really equals its input', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 1000 }),
      stage({ id: 'b', provider: 'beta', order: 1, before: 1000, after: 200 }),
    ]);

    assert.equal(result.status, 'measured');
    if (result.status !== 'measured') return;
    assert.equal(result.saved, 800);
  });

  it('requires an ordered coordinate when more than one stage is present', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: null, before: 1000, after: 300 }),
      stage({ id: 'b', provider: 'beta', order: null, before: 300, after: 200 }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'pipeline-order-missing');
  });

  it('refuses duplicate positions instead of choosing an arbitrary stage', () => {
    const result = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({ id: 'b', provider: 'beta', order: 0, before: 300, after: 200 }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'pipeline-order-ambiguous');
  });

  it('requires one pipeline and one operation identity', () => {
    const pipelineMismatch = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({
        id: 'b',
        provider: 'beta',
        order: 1,
        before: 300,
        after: 200,
        pipelineId: 'pipe-2',
      }),
    ]);
    assert.equal(pipelineMismatch.status, 'incomparable');
    if (pipelineMismatch.status === 'incomparable') {
      assert.equal(pipelineMismatch.reason, 'pipeline-id-mismatch');
    }

    const operationMismatch = measurePipelineOperation([
      stage({ id: 'a', provider: 'alpha', order: 0, before: 1000, after: 300 }),
      stage({
        id: 'b',
        provider: 'beta',
        order: 1,
        before: 300,
        after: 200,
        operationId: 'op-2',
      }),
    ]);
    assert.equal(operationMismatch.status, 'incomparable');
    if (operationMismatch.status === 'incomparable') {
      assert.equal(operationMismatch.reason, 'operation-id-mismatch');
    }
  });

  it('does not promote an unattributed event into a pipeline measurement', () => {
    const result = measurePipelineOperation([
      stage({
        id: 'a',
        provider: 'alpha',
        order: null,
        before: 1000,
        after: 300,
        pipelineId: null,
      }),
    ]);

    assert.equal(result.status, 'incomparable');
    if (result.status !== 'incomparable') return;
    assert.equal(result.reason, 'pipeline-id-missing');
  });
});
