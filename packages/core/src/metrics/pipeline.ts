/**
 * Pipeline-operation accounting — RFC 0005 §Pipeline attribution.
 *
 * Provider rows are marginal. A pipeline total is different: it is raw-to-final once per
 * operation, never the sum of claims against overlapping baselines. The normalized event already
 * carries the two coordinates that make this possible — `operationId` and `pipelineOrder` —
 * but until this module nothing enforced that their stage boundaries are actually comparable.
 */

import type { ProviderId } from '../domain/ids.js';

import type { MeasurementClass, OptimizationEvent } from './events.js';

export type PipelineMeasurementUnit = 'tokens' | 'chars';

export type PipelineOperationIncomparableReason =
  | 'pipeline-id-missing'
  | 'pipeline-id-mismatch'
  | 'operation-id-mismatch'
  | 'counterfactual-stage'
  | 'stage-error'
  | 'measurement-missing'
  | 'measurement-class-mismatch'
  | 'measurement-unit-mismatch'
  | 'pipeline-order-missing'
  | 'pipeline-order-ambiguous'
  | 'stage-boundary-mismatch'
  | 'unrealized-stage';

export type PipelineOperationMeasurement =
  | {
      status: 'measured';
      pipelineId: string;
      operationId: string;
      class: MeasurementClass;
      unit: PipelineMeasurementUnit;
      before: number;
      after: number;
      saved: number;
      providers: ProviderId[];
      stages: number;
    }
  | {
      status: 'incomparable';
      pipelineId: string | null;
      operationId: string | null;
      reason: PipelineOperationIncomparableReason;
      providers: ProviderId[];
      stages: number;
    };

interface StageFigure {
  event: OptimizationEvent;
  unit: PipelineMeasurementUnit;
  before: number;
  after: number;
}

function figure(event: OptimizationEvent): StageFigure | null {
  const measurement = event.measurement;
  if (measurement.beforeTokens !== null && measurement.afterTokens !== null) {
    return {
      event,
      unit: 'tokens',
      before: measurement.beforeTokens,
      after: measurement.afterTokens,
    };
  }
  if (measurement.beforeChars !== null && measurement.afterChars !== null) {
    return {
      event,
      unit: 'chars',
      before: measurement.beforeChars,
      after: measurement.afterChars,
    };
  }
  return null;
}

function providerList(events: readonly OptimizationEvent[]): ProviderId[] {
  const providers: ProviderId[] = [];
  for (const event of events) {
    const provider = event.provider.id as ProviderId;
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

function incomparable(
  events: readonly OptimizationEvent[],
  reason: PipelineOperationIncomparableReason,
): PipelineOperationMeasurement {
  const pipelineIds = new Set(events.map((event) => event.context.pipelineId));
  const operationIds = new Set(events.map((event) => event.context.operationId));
  return {
    status: 'incomparable',
    pipelineId: pipelineIds.size === 1 ? (events[0]?.context.pipelineId ?? null) : null,
    operationId: operationIds.size === 1 ? (events[0]?.context.operationId ?? null) : null,
    reason,
    providers: providerList(events),
    stages: events.length,
  };
}

/**
 * Measures one observed operation through one validated pipeline.
 *
 * For a chain `raw -> A -> B`, A's event must end where B's begins. The operation total is then
 * `raw - B.final`. Summing A and B happens to produce the same saving when those boundaries are
 * stage-local, but checking raw-to-final is what catches the dangerous case where B reports a
 * second baseline against raw and would otherwise double-count it.
 */
export function measurePipelineOperation(
  events: readonly OptimizationEvent[],
): PipelineOperationMeasurement {
  if (events.length === 0) return incomparable(events, 'measurement-missing');

  const pipelineId = events[0]?.context.pipelineId ?? null;
  if (pipelineId === null) return incomparable(events, 'pipeline-id-missing');
  if (events.some((event) => event.context.pipelineId !== pipelineId)) {
    return incomparable(events, 'pipeline-id-mismatch');
  }

  const operationId = events[0]?.context.operationId ?? '';
  if (events.some((event) => event.context.operationId !== operationId)) {
    return incomparable(events, 'operation-id-mismatch');
  }

  if (events.some((event) => event.measurement.class === 'counterfactual')) {
    return incomparable(events, 'counterfactual-stage');
  }
  if (events.some((event) => event.outcome.errorCode !== null)) {
    return incomparable(events, 'stage-error');
  }

  const figures = events.map(figure);
  if (figures.some((entry) => entry === null)) {
    return incomparable(events, 'measurement-missing');
  }
  const measured = figures as StageFigure[];

  const measurementClass = measured[0]?.event.measurement.class;
  if (
    measurementClass === undefined ||
    measured.some((entry) => entry.event.measurement.class !== measurementClass)
  ) {
    return incomparable(events, 'measurement-class-mismatch');
  }

  const unit = measured[0]?.unit;
  if (unit === undefined || measured.some((entry) => entry.unit !== unit)) {
    return incomparable(events, 'measurement-unit-mismatch');
  }

  // changed=false means the model saw the input unchanged. If the recorded after figure differs,
  // that figure is a road not taken even if an importer mislabeled its measurement class.
  if (measured.some((entry) => !entry.event.outcome.changed && entry.before !== entry.after)) {
    return incomparable(events, 'unrealized-stage');
  }

  if (events.length > 1 && measured.some((entry) => entry.event.context.pipelineOrder === null)) {
    return incomparable(events, 'pipeline-order-missing');
  }

  const orders = measured.map((entry) => entry.event.context.pipelineOrder);
  const numbered = orders.filter((order): order is number => order !== null);
  if (new Set(numbered).size !== numbered.length) {
    return incomparable(events, 'pipeline-order-ambiguous');
  }

  const ordered =
    measured.length === 1
      ? measured
      : [...measured].sort(
          (left, right) =>
            (left.event.context.pipelineOrder ?? 0) - (right.event.context.pipelineOrder ?? 0),
        );

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.after !== current.before) {
      return incomparable(events, 'stage-boundary-mismatch');
    }
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) {
    return incomparable(events, 'measurement-missing');
  }

  return {
    status: 'measured',
    pipelineId,
    operationId,
    class: measurementClass,
    unit,
    before: first.before,
    after: last.after,
    saved: first.before - last.after,
    providers: ordered.map((entry) => entry.event.provider.id as ProviderId),
    stages: ordered.length,
  };
}
