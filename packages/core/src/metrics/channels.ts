/**
 * Per-channel metrics derived from an applied pipeline and normalized RFC 0005 events.
 *
 * A channel row is intentionally stricter than a provider row. Provider rows can report a valid
 * marginal observation with no pipeline identity; a channel total claims raw-to-final behaviour of
 * a particular applied pipeline, so every stage must be attributable to that pipeline and channel.
 */

import type { CapabilityId } from '../domain/capabilities.js';
import type { HarnessId, ProviderId } from '../domain/ids.js';

import { MEASUREMENT_CLASSES, type MeasurementClass, type OptimizationEvent } from './events.js';
import { measurePipelineOperation, type PipelineOperationIncomparableReason } from './pipeline.js';

export type ChannelMetricStatus =
  | 'measured'
  | 'unmeasured'
  | 'attribution-unavailable'
  | 'incomparable';

export type ChannelMetricIncomparableReason =
  | PipelineOperationIncomparableReason
  | 'owner-stage-mismatch';

export interface MetricsChannelExpectation {
  pipelineId: string;
  harness: HarnessId;
  toolFamily: string;
  capability: CapabilityId;
  /** Ordered owners from the applied pipeline receipt. */
  owners: ProviderId[];
}

export interface ChannelMeasurementClassRow {
  class: MeasurementClass;
  unit: 'tokens' | 'chars' | null;
  before: number | null;
  after: number | null;
  saved: number | null;
  operations: number;
  note: string | null;
}

export interface ChannelMetricsRow extends MetricsChannelExpectation {
  status: ChannelMetricStatus;
  /** Realized operations with a comparable raw-to-final figure. */
  operations: number;
  /** Attributed operations that cannot produce a comparable raw-to-final figure. */
  incomparableOperations: number;
  /** Potentially relevant operations whose source cannot prove this pipeline/channel. */
  unattributedOperations: number;
  incomparableReasons: ChannelMetricIncomparableReason[];
  /** Measurement classes are never merged, even within one channel. */
  classes: ChannelMeasurementClassRow[];
  note: string | null;
}

interface ChannelClassTotal {
  class: MeasurementClass;
  unit: 'tokens' | 'chars';
  before: number;
  after: number;
  operations: number;
}

const EMPTY_NOTES: Readonly<Record<MeasurementClass, string>> = {
  'exact-local': 'none measured',
  'estimated-local': 'none measured',
  counterfactual: 'not a realized channel saving',
  'end-to-end-billed': 'no A/B run',
};

function uniqueEvents(events: readonly OptimizationEvent[]): OptimizationEvent[] {
  const seen = new Set<string>();
  const unique: OptimizationEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    unique.push(event);
  }
  return unique;
}

function classRows(totals: ReadonlyMap<string, ChannelClassTotal>): ChannelMeasurementClassRow[] {
  return MEASUREMENT_CLASSES.map((measurementClass) => {
    const rows = [...totals.values()].filter((row) => row.class === measurementClass);
    if (rows.length > 1) {
      return {
        class: measurementClass,
        unit: null,
        before: null,
        after: null,
        saved: null,
        operations: rows.reduce((sum, row) => sum + row.operations, 0),
        note: `recorded in ${rows.map((row) => row.unit).join(' and ')}, which are not addable`,
      };
    }

    const row = rows[0];
    if (row === undefined) {
      return {
        class: measurementClass,
        unit: null,
        before: null,
        after: null,
        saved: null,
        operations: 0,
        note: EMPTY_NOTES[measurementClass],
      };
    }

    return {
      class: measurementClass,
      unit: row.unit,
      before: row.before,
      after: row.after,
      saved: row.before - row.after,
      operations: row.operations,
      note: null,
    };
  });
}

function operationCount(events: readonly OptimizationEvent[]): number {
  return new Set(events.map((event) => event.context.operationId)).size;
}

function sameOwners(
  events: readonly OptimizationEvent[],
  expected: readonly ProviderId[],
): boolean {
  const observed = new Set(events.map((event) => event.provider.id));
  const wanted = new Set<string>(expected);
  if (observed.size !== wanted.size) return false;
  for (const provider of observed) {
    if (!wanted.has(provider)) return false;
  }
  return true;
}

function directlyAttributed(event: OptimizationEvent, channel: MetricsChannelExpectation): boolean {
  return (
    event.context.pipelineId === channel.pipelineId &&
    event.context.harnessId === channel.harness &&
    event.context.toolFamily === channel.toolFamily &&
    event.context.capability === channel.capability &&
    channel.owners.includes(event.provider.id as ProviderId)
  );
}

/**
 * An event can prove that a provider observed the channel family without proving that it belongs
 * to this applied pipeline. RTK's history is the canonical example: provider and capability are
 * known, while harness, tool family, pipeline id and order are not. Such a row is evidence for
 * "attribution unavailable", never evidence for a saving on every channel the provider owns.
 */
function couldBelongToChannel(
  event: OptimizationEvent,
  channel: MetricsChannelExpectation,
): boolean {
  if (!channel.owners.includes(event.provider.id as ProviderId)) return false;
  if (event.context.capability !== channel.capability) return false;
  if (event.context.pipelineId !== null && event.context.pipelineId !== channel.pipelineId) {
    return false;
  }
  if (event.context.harnessId !== 'unknown' && event.context.harnessId !== channel.harness) {
    return false;
  }
  return !directlyAttributed(event, channel);
}

export function aggregateChannelMetrics(
  expectations: readonly MetricsChannelExpectation[],
  events: readonly OptimizationEvent[],
): ChannelMetricsRow[] {
  const unique = uniqueEvents(events);

  return expectations.map((channel) => {
    const attributed = unique.filter((event) => directlyAttributed(event, channel));
    const groups = new Map<string, OptimizationEvent[]>();
    for (const event of attributed) {
      const group = groups.get(event.context.operationId) ?? [];
      group.push(event);
      groups.set(event.context.operationId, group);
    }

    const totals = new Map<string, ChannelClassTotal>();
    const reasons = new Set<ChannelMetricIncomparableReason>();
    let measuredOperations = 0;
    let incomparableOperations = 0;

    for (const group of groups.values()) {
      if (!sameOwners(group, channel.owners)) {
        incomparableOperations += 1;
        reasons.add('owner-stage-mismatch');
        continue;
      }

      const measured = measurePipelineOperation(group);
      if (measured.status === 'incomparable') {
        incomparableOperations += 1;
        reasons.add(measured.reason);
        continue;
      }

      measuredOperations += 1;
      const key = `${measured.class} ${measured.unit}`;
      const total = totals.get(key) ?? {
        class: measured.class,
        unit: measured.unit,
        before: 0,
        after: 0,
        operations: 0,
      };
      total.before += measured.before;
      total.after += measured.after;
      total.operations += 1;
      totals.set(key, total);
    }

    const unattributed = unique.filter((event) => couldBelongToChannel(event, channel));
    const unattributedOperations = operationCount(unattributed);

    let status: ChannelMetricStatus;
    let note: string | null = null;
    if (measuredOperations > 0) {
      status = 'measured';
      const residue: string[] = [];
      if (incomparableOperations > 0) {
        residue.push(`${String(incomparableOperations)} incomparable`);
      }
      if (unattributedOperations > 0) {
        residue.push(`${String(unattributedOperations)} without safe pipeline attribution`);
      }
      note = residue.length === 0 ? null : residue.join('; ');
    } else if (incomparableOperations > 0) {
      status = 'incomparable';
      note =
        `${String(incomparableOperations)} attributed operation` +
        `${incomparableOperations === 1 ? '' : 's'} cannot form a comparable raw-to-final total`;
    } else if (unattributedOperations > 0) {
      status = 'attribution-unavailable';
      note =
        `${String(unattributedOperations)} provider operation` +
        `${unattributedOperations === 1 ? '' : 's'} may belong here but do not carry enough ` +
        'pipeline identity to attribute safely';
    } else {
      status = 'unmeasured';
      note = 'no attributable operation was recorded for this channel in the window';
    }

    return {
      ...channel,
      status,
      operations: measuredOperations,
      incomparableOperations,
      unattributedOperations,
      incomparableReasons: [...reasons].sort(),
      classes: classRows(totals),
      note,
    };
  });
}
