/**
 * The normalized optimization event — RFC 0005 §Normalized event, verbatim.
 *
 * "Raw command text, raw tool output, source code, file paths, prompts, and
 * credentials are not part of the normalized event."
 */

export const OPTIMIZATION_EVENT_SCHEMA_VERSION = 1;

export const MEASUREMENT_CLASSES = [
  'exact-local',
  'estimated-local',
  'counterfactual',
  'end-to-end-billed',
] as const;

export type MeasurementClass = (typeof MEASUREMENT_CLASSES)[number];

export function isMeasurementClass(value: string): value is MeasurementClass {
  return (MEASUREMENT_CLASSES as readonly string[]).includes(value);
}

export interface OptimizationEvent {
  schemaVersion: typeof OPTIMIZATION_EVENT_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;

  provider: {
    id: string;
    version: string | null;
  };

  context: {
    projectId: string;
    harnessId: string;
    sessionId: string | null;
    operationId: string;
    pipelineId: string | null;
    pipelineOrder: number | null;
    toolFamily: string | null;
    capability: string;
  };

  measurement: {
    class: MeasurementClass;
    beforeChars: number | null;
    afterChars: number | null;
    beforeTokens: number | null;
    afterTokens: number | null;
    tokenizer: string | null;
    confidenceLow: number | null;
    confidenceHigh: number | null;
  };

  outcome: {
    changed: boolean;
    bypassReason: string | null;
    originalReference: string | null;
    latencyMs: number | null;
    errorCode: string | null;
  };

  source: {
    nativeEventId: string | null;
    importedAt: string;
  };
}

/**
 * RFC 0005 §Measurement classes: "These classes are never merged into an
 * unlabeled exact total." Two figures may be summed only within one class *and*
 * one unit, which is why this predicate exists at the domain level rather than
 * as a convention inside a report.
 */
export function isSummableWith(a: OptimizationEvent, b: OptimizationEvent): boolean {
  if (a.measurement.class !== b.measurement.class) return false;
  const aTokens = a.measurement.beforeTokens !== null;
  const bTokens = b.measurement.beforeTokens !== null;
  return aTokens === bTokens;
}

/**
 * RFC 0005 §A measured reduction is not always a realized one: a `dryrun` event
 * describes bytes that stayed in context, so it never counts as a saving.
 */
export function isRealizedSaving(event: OptimizationEvent): boolean {
  return event.outcome.changed && event.measurement.class !== 'counterfactual';
}
