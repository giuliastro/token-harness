import type { SmartRoutingTier } from './smart-routing.js';

export const SMART_ROUTING_EVENT_SCHEMA_VERSION = 1;
export const SMART_ROUTING_EVENT_PREFIX = 'smart-routing-';
export const SMART_ROUTING_EVENT_RETENTION_LIMIT = 200;

export type SmartRoutingHarness = 'claude' | 'codex';
export type SmartRoutingMode = 'shadow' | 'conservative';

/**
 * Routing observations are deliberately not OptimizationEvents: a cheaper model choice is not a
 * token reduction and cannot enter RFC 0005's exact/estimated savings totals.
 */
export interface SmartRoutingDecisionEvent {
  schemaVersion: typeof SMART_ROUTING_EVENT_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  source: 'ccr';
  harnessId: SmartRoutingHarness;
  mode: SmartRoutingMode;
  classifierVersion: string;
  tier: SmartRoutingTier;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  reasonCodes: string[];
  requestModel: string | null;
  candidateModel: string | null;
  routeMutationRequested: boolean;
  routeSkipReason: string | null;
  promptChars: number;
  requestInputTokenEstimate: number | null;
  toolCount: number;
  hasImage: boolean;
  decisionLatencyMs: number;
  measurement: {
    status: 'not-measured';
    resolvedModel: null;
    providerInputTokens: null;
    providerOutputTokens: null;
    qualityGate: 'unknown';
  };
}

export interface SmartRoutingMetricsReport {
  schemaVersion: 1;
  retainedDecisionCount: number;
  byHarness: Record<SmartRoutingHarness, number>;
  byMode: Record<SmartRoutingMode, number>;
  byTier: Record<SmartRoutingTier, number>;
  routeMutationRequestCount: number;
  malformedRecordCount: number;
  prunedRecordCount: number;
  retentionLimit: typeof SMART_ROUTING_EVENT_RETENTION_LIMIT;
  savingsStatus: 'not-measured';
  savingsMeasurementCount: 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTier(value: unknown): value is SmartRoutingTier {
  return value === 'simple' || value === 'standard' || value === 'complex' || value === 'critical';
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const ALLOWED_REASON_CODES = new Set([
  'short-prompt',
  'medium-prompt',
  'long-prompt',
  'very-long-prompt',
  'code-present',
  'technical-terms',
  'reasoning-marker',
  'multiple-reasoning-markers',
  'multi-step-request',
  'multiple-questions',
  'simple-language-indicator',
  'image-input',
  'empty-user-text',
  'tool-schema-present',
  'possible-contextual-follow-up',
]);
const ALLOWED_SKIP_REASONS = new Set([
  'shadow-mode',
  'unsupported-mode',
  'complexity-not-simple',
  'simple-model-not-configured',
  'request-model-unavailable',
  'conservative-safety-gate',
  'tool-compatibility-unconfirmed',
  'model-already-selected',
]);

function isSafeModelId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^[A-Za-z0-9_.:/@+-]{1,160}$/.test(value));
}

/** Validate the local CCR decision record without accepting prompt or credential fields. */
export function isSmartRoutingDecisionEvent(value: unknown): value is SmartRoutingDecisionEvent {
  if (!isRecord(value) || !isRecord(value['measurement'])) return false;
  const event = value as unknown as SmartRoutingDecisionEvent;
  const measurement = event.measurement;
  return (
    hasExactKeys(value, [
      'schemaVersion',
      'eventId',
      'timestamp',
      'source',
      'harnessId',
      'mode',
      'classifierVersion',
      'tier',
      'score',
      'confidence',
      'reasonCodes',
      'requestModel',
      'candidateModel',
      'routeMutationRequested',
      'routeSkipReason',
      'promptChars',
      'requestInputTokenEstimate',
      'toolCount',
      'hasImage',
      'decisionLatencyMs',
      'measurement',
    ]) &&
    hasExactKeys(value['measurement'] as Record<string, unknown>, [
      'status',
      'resolvedModel',
      'providerInputTokens',
      'providerOutputTokens',
      'qualityGate',
    ]) &&
    event.schemaVersion === SMART_ROUTING_EVENT_SCHEMA_VERSION &&
    typeof event.eventId === 'string' &&
    /^[0-9]{13}-[a-z0-9]+$/.test(event.eventId) &&
    typeof event.timestamp === 'string' &&
    event.source === 'ccr' &&
    (event.harnessId === 'claude' || event.harnessId === 'codex') &&
    (event.mode === 'shadow' || event.mode === 'conservative') &&
    event.classifierVersion === 'heuristic-v1' &&
    isTier(event.tier) &&
    Number.isFinite(event.score) &&
    (event.confidence === 'low' || event.confidence === 'medium' || event.confidence === 'high') &&
    Array.isArray(value['reasonCodes']) &&
    event.reasonCodes.every((item) => typeof item === 'string' && ALLOWED_REASON_CODES.has(item)) &&
    isSafeModelId(event.requestModel) &&
    isSafeModelId(event.candidateModel) &&
    typeof event.routeMutationRequested === 'boolean' &&
    (event.routeSkipReason === null || ALLOWED_SKIP_REASONS.has(event.routeSkipReason)) &&
    Number.isSafeInteger(event.promptChars) &&
    event.promptChars >= 0 &&
    (event.requestInputTokenEstimate === null ||
      (Number.isSafeInteger(event.requestInputTokenEstimate) &&
        event.requestInputTokenEstimate >= 0)) &&
    Number.isSafeInteger(event.toolCount) &&
    event.toolCount >= 0 &&
    typeof event.hasImage === 'boolean' &&
    Number.isFinite(event.decisionLatencyMs) &&
    event.decisionLatencyMs >= 0 &&
    measurement.status === 'not-measured' &&
    measurement.resolvedModel === null &&
    measurement.providerInputTokens === null &&
    measurement.providerOutputTokens === null &&
    measurement.qualityGate === 'unknown'
  );
}

export function aggregateSmartRoutingEvents(input: {
  events: readonly SmartRoutingDecisionEvent[];
  malformedRecordCount?: number;
  prunedRecordCount?: number;
}): SmartRoutingMetricsReport {
  const report: SmartRoutingMetricsReport = {
    schemaVersion: 1,
    retainedDecisionCount: input.events.length,
    byHarness: { claude: 0, codex: 0 },
    byMode: { shadow: 0, conservative: 0 },
    byTier: { simple: 0, standard: 0, complex: 0, critical: 0 },
    routeMutationRequestCount: 0,
    malformedRecordCount: input.malformedRecordCount ?? 0,
    prunedRecordCount: input.prunedRecordCount ?? 0,
    retentionLimit: SMART_ROUTING_EVENT_RETENTION_LIMIT,
    savingsStatus: 'not-measured',
    savingsMeasurementCount: 0,
  };

  for (const event of input.events) {
    report.byHarness[event.harnessId] += 1;
    report.byMode[event.mode] += 1;
    report.byTier[event.tier] += 1;
    if (event.routeMutationRequested) report.routeMutationRequestCount += 1;
  }
  return report;
}
