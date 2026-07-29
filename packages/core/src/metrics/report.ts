/**
 * The metrics report — the result object behind `token-harness metrics`.
 *
 * Shaped by RFC 0006 §Golden path and constrained by RFC 0005 §Measurement
 * classes: each row carries its own class and unit, and nothing in this type
 * lets two rows with different units or classes be added together.
 */

import type { HarnessId, ProviderId } from '../domain/ids.js';
import type { MeasurementClass } from './events.js';

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
  coveragePercent: number;
  bypassed: number;
  errors: number;
  addedMedianLatencyMs: number;
}
