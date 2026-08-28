/**
 * The metrics report — the result object behind `token-harness metrics`.
 *
 * Shaped by RFC 0006 §Golden path and constrained by RFC 0005 §Measurement
 * classes: each row carries its own class and unit, and nothing in this type
 * lets two rows with different units or classes be added together.
 */

import type { HarnessId, ProviderId } from '../domain/ids.js';
import {
  aggregateChannelMetrics,
  summarizePipelineTotal,
  type ChannelMetricsRow,
  type MetricsChannelExpectation,
  type PipelineMetricTotal,
} from './channels.js';
import { MEASUREMENT_CLASSES, type MeasurementClass, type OptimizationEvent } from './events.js';

export type SavingsUnit = 'tokens' | 'chars';

export interface MeasurementClassRow {
  class: MeasurementClass;
  /** Null when nothing was recorded for this class. */
  unit: SavingsUnit | null;
  before: number | null;
  after: number | null;
  saved: number | null;
  /** Replaces the figures when there is none, e.g. "none recorded". */
  note: string | null;
}

export interface ProviderSavingsRow {
  providerId: ProviderId;
  saved: number;
  unit: SavingsUnit;
  class: MeasurementClass;
  operations: number;
  harnesses: HarnessId[];
  /** RFC 0004 §Brownfield adoption; rendered as "adopted, not managed". */
  managedByTokenHarness: boolean;
  /**
   * RFC 0005: an event's class depends on the adapter mode, so the mode the
   * importer relied on is reported next to the figure it produced.
   */
  adapterMode: string | null;
}

export interface MetricsReport {
  /** Inclusive window start, ISO 8601 date. */
  windowStart: string;
  /** Inclusive window end, ISO 8601 date. */
  windowEnd: string;
  pipelineId: string | null;
  /** One row per measurement class, always all four, in RFC order. */
  classes: MeasurementClassRow[];
  providers: ProviderSavingsRow[];
  /**
   * Raw-to-final measurements for the channels in the applied pipeline.
   *
   * Optional for compatibility with reports produced without an applied pipeline inventory.
   */
  channels?: ChannelMetricsRow[];
  /**
   * A single raw-to-final number only when the applied pipeline is fully comparable.
   *
   * Optional when no applied pipeline inventory was supplied to aggregation.
   */
  pipelineTotal?: PipelineMetricTotal;
  /**
   * Share of operations in which the optimization actually changed the payload.
   *
   * Null when the window holds no operations at all. `0%` would read as "nothing was
   * optimized" where the truth is "nothing happened", and those two call for different
   * responses from whoever is reading.
   */
  coveragePercent: number | null;
  bypassed: number;
  /**
   * Operations in which the payload the model saw got *larger*.
   *
   * Not a rounding artefact. RTK inflated 240 of 2,847 payloads on the machine this was
   * written against, and its own `saved_tokens` column floors each command at zero, so
   * `rtk gain` cannot report them at all and its total is a sum of clamped values.
   *
   * A net figure that quietly absorbs them would be arithmetically right and misleading:
   * "saved 38,850" reads very differently once you know 87 operations pushed the other way.
   * Reported separately so the net figure keeps its meaning and the inflation keeps its.
   */
  inflatedOperations: number;
  errors: number;
  /**
   * Median overhead the optimization *added*, across events that recorded one.
   *
   * Null when no event in the window carries a latency, which is the common case rather than
   * an edge one: RTK records how long each command took but not what it spent, so there is
   * nothing to report. Zero would claim the overhead was measured and found negligible — a
   * much stronger statement than "not measured", and one no source available here supports.
   */
  addedMedianLatencyMs: number | null;
}

/** Which unit an event's measurement is in, or null when it recorded neither. */
export function measurementUnit(event: OptimizationEvent): SavingsUnit | null {
  if (event.measurement.beforeTokens !== null && event.measurement.afterTokens !== null) {
    return 'tokens';
  }
  if (event.measurement.beforeChars !== null && event.measurement.afterChars !== null) {
    return 'chars';
  }
  return null;
}

function figures(event: OptimizationEvent, unit: SavingsUnit): { before: number; after: number } {
  return unit === 'tokens'
    ? { before: event.measurement.beforeTokens ?? 0, after: event.measurement.afterTokens ?? 0 }
    : { before: event.measurement.beforeChars ?? 0, after: event.measurement.afterChars ?? 0 };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return Math.round(((sorted[middle - 1] ?? 0) + upper) / 2);
}

/** What a class row says instead of figures when it has none. Pinned by RFC 0006. */
const EMPTY_CLASS_NOTES: Readonly<Record<MeasurementClass, string>> = {
  'exact-local': 'none recorded',
  'estimated-local': 'none recorded',
  counterfactual: 'none recorded',
  'end-to-end-billed': 'no A/B run',
};

export interface AggregateInput {
  events: readonly OptimizationEvent[];
  /** Inclusive window start, ISO 8601 date. */
  windowStart: string;
  /** Inclusive window end, ISO 8601 date. */
  windowEnd: string;
  /**
   * Which installations Token Harness applied itself — RFC 0004 §Brownfield adoption. A
   * provider absent from this set renders as "adopted, not managed", which is the honest
   * default on a machine Token Harness has only read.
   */
  managedProviders?: readonly string[];
  /** The mode each importer ran in, for the note beside that provider's figure. */
  adapterModes?: Readonly<Record<string, string | null>>;
  /** Applied pipeline channels whose raw-to-final savings may be attributable in this window. */
  channels?: readonly MetricsChannelExpectation[];
}

interface ClassTotal {
  class: MeasurementClass;
  unit: SavingsUnit;
  before: number;
  after: number;
}

interface ProviderTotal {
  providerId: string;
  class: MeasurementClass;
  unit: SavingsUnit;
  saved: number;
  operations: number;
  harnesses: Set<string>;
}

/**
 * Events become a report — RFC 0005 §Measurement classes, structurally.
 *
 * The rule the whole function is built around: **"These classes are never merged into an
 * unlabeled exact total."** A class row is keyed by class *and* unit, and a provider row by
 * provider, class, and unit, so no path through this code adds tokens to characters, or an
 * estimate to an exact figure. `isSummableWith` states that rule for a pair of events; this
 * enforces it across a window.
 *
 * `counterfactual` events are counted on their own class line and are deliberately absent
 * from provider rows and from coverage. RFC 0005 §A measured reduction is not always a
 * realized one: those bytes stayed in context, so the figure describes a saving that did not
 * occur, and putting it beside a realized one is the failure the classes exist to prevent.
 */
export function aggregateEvents(input: AggregateInput): MetricsReport {
  const classTotals = new Map<string, ClassTotal>();
  const providerTotals = new Map<string, ProviderTotal>();

  let realized = 0;
  let bypassed = 0;
  let inflated = 0;
  let errors = 0;
  let pipelineId: string | null = null;
  let pipelineIsAmbiguous = false;
  const latencies: number[] = [];

  // RFC 0005 §Deduplicating a stream without event IDs makes the identity what a restarted
  // import "relies on to discard what it already has". An append-only store cannot do that at
  // write time, so it happens here — the last place before a figure is claimed.
  //
  // This is not hypothetical tidiness. A cursor bug re-imported RTK's whole table on every
  // run, and every number in the report doubled. The cursor is fixed; this is what makes the
  // report survive the next such bug instead of reporting twice the truth with confidence.
  const seen = new Set<string>();

  for (const event of input.events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);

    if (event.outcome.errorCode !== null) errors += 1;

    // A window spanning two pipelines has no single pipeline to name, and naming the first
    // would attribute the whole report to it.
    if (event.context.pipelineId !== null) {
      if (pipelineId === null) pipelineId = event.context.pipelineId;
      else if (pipelineId !== event.context.pipelineId) pipelineIsAmbiguous = true;
    }

    if (event.outcome.latencyMs !== null) latencies.push(event.outcome.latencyMs);

    const isCounterfactual = event.measurement.class === 'counterfactual';

    // Coverage counts operations that could have been optimized. A counterfactual measures a
    // road not taken, so it is neither covered nor bypassed.
    if (!isCounterfactual) {
      if (event.outcome.changed) realized += 1;
      else bypassed += 1;
    }

    const unit = measurementUnit(event);
    if (unit === null) continue;
    const { before, after } = figures(event, unit);
    if (!isCounterfactual && after > before) inflated += 1;

    const classKey = `${event.measurement.class} ${unit}`;
    const classRow: ClassTotal = classTotals.get(classKey) ?? {
      class: event.measurement.class,
      unit,
      before: 0,
      after: 0,
    };
    classRow.before += before;
    classRow.after += after;
    classTotals.set(classKey, classRow);

    // Every *modified* payload reaches a provider row, including one that grew: its
    // contribution is negative, so a provider row's total is the net effect and agrees with
    // its class line by construction. Summing only the reductions would make the two
    // disagree with nothing on the page to explain the gap.
    //
    // An unchanged interception stays out. It is real information — it is the `bypassed`
    // count — but it is not a saving of any sign.
    if (isCounterfactual || !event.outcome.changed) continue;

    const providerKey = `${event.provider.id} ${event.measurement.class} ${unit}`;
    const providerRow: ProviderTotal = providerTotals.get(providerKey) ?? {
      providerId: event.provider.id,
      class: event.measurement.class,
      unit,
      saved: 0,
      operations: 0,
      harnesses: new Set<string>(),
    };
    providerRow.saved += before - after;
    providerRow.operations += 1;
    // `unknown` is what an importer records when the source does not say which harness ran
    // the operation. Listing it beside real harness names would read as a harness.
    if (event.context.harnessId !== 'unknown') providerRow.harnesses.add(event.context.harnessId);
    providerTotals.set(providerKey, providerRow);
  }

  const managed = new Set<string>(input.managedProviders ?? []);
  const modes = input.adapterModes ?? {};

  const classes: MeasurementClassRow[] = MEASUREMENT_CLASSES.map((measurementClass) => {
    const rows = [...classTotals.values()].filter((row) => row.class === measurementClass);

    // Two units inside one class cannot be summed, so the line carries no figure and says
    // which units are present. Nothing observed does this yet; picking one silently is how a
    // report starts lying.
    if (rows.length > 1) {
      return {
        class: measurementClass,
        unit: null,
        before: null,
        after: null,
        saved: null,
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
        note: EMPTY_CLASS_NOTES[measurementClass],
      };
    }

    return {
      class: measurementClass,
      unit: row.unit,
      before: row.before,
      after: row.after,
      saved: row.before - row.after,
      note: null,
    };
  });

  const providers: ProviderSavingsRow[] = [...providerTotals.values()]
    // Largest saving first: the question the report answers is which provider is earning its
    // place. Ties break by name so the output is deterministic.
    .sort(
      (left, right) => right.saved - left.saved || left.providerId.localeCompare(right.providerId),
    )
    .map((row) => ({
      providerId: row.providerId as ProviderId,
      saved: row.saved,
      unit: row.unit,
      class: row.class,
      operations: row.operations,
      harnesses: [...row.harnesses].sort() as HarnessId[],
      managedByTokenHarness: managed.has(row.providerId),
      adapterMode: modes[row.providerId] ?? null,
    }));

  const operations = realized + bypassed;
  const channels =
    input.channels === undefined
      ? undefined
      : aggregateChannelMetrics(input.channels, input.events);

  return {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    pipelineId: pipelineIsAmbiguous ? null : pipelineId,
    classes,
    providers,
    ...(channels === undefined
      ? {}
      : { channels, pipelineTotal: summarizePipelineTotal(channels) }),
    coveragePercent: operations === 0 ? null : Math.round((realized / operations) * 100),
    bypassed,
    inflatedOperations: inflated,
    errors,
    addedMedianLatencyMs: median(latencies),
  };
}
