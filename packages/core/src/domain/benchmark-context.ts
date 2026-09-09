/**
 * Context-exposure evidence for paired task benchmarks.
 *
 * This deliberately records inventory/deferral facts in their native units. A lower MCP tool
 * count or lower effective static exposure is evidence about context shape, not proof of lower
 * Claude/Codex subscription quota consumption.
 */

import {
  effectiveMcpExposure,
  type HarnessContextObservation,
  type ToolDeferralObservation,
  type ToolDeferralState,
} from './context-cost.js';

export interface TaskBenchmarkContextSnapshot {
  observationState: Extract<HarnessContextObservation['state'], 'observed' | 'partial'>;
  rawMcpServerCount: number;
  rawKnownMcpToolCount: number;
  unknownMcpToolServerCount: number;
  effectiveStaticMcpServerCount: number;
  effectiveStaticMcpToolCount: number;
  toolDeferralState: ToolDeferralState | null;
  toolDeferralMechanism: ToolDeferralObservation['mechanism'] | null;
}

export type TaskBenchmarkContextVerdict = 'reduced' | 'same' | 'increased' | 'unknown';

export interface TaskBenchmarkContextComparison {
  verdict: TaskBenchmarkContextVerdict;
  baseline: TaskBenchmarkContextSnapshot | null;
  optimized: TaskBenchmarkContextSnapshot | null;
  reason: string;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const DEFERRAL_STATES = new Set<ToolDeferralState>(['active', 'available', 'inactive', 'unknown']);
const DEFERRAL_MECHANISMS = new Set<ToolDeferralObservation['mechanism']>([
  'native-tool-search',
  'native-defer-loading',
  'external',
]);

/** Convert one context observation into a bounded benchmark witness without storing tool names. */
export function taskBenchmarkContextSnapshot(
  observation: HarnessContextObservation | undefined,
): TaskBenchmarkContextSnapshot | null {
  if (
    observation === undefined ||
    (observation.state !== 'observed' && observation.state !== 'partial')
  ) {
    return null;
  }

  const exposure = effectiveMcpExposure(observation);
  return {
    observationState: observation.state,
    rawMcpServerCount: exposure.rawServerCount,
    rawKnownMcpToolCount: exposure.rawKnownToolCount,
    unknownMcpToolServerCount: observation.mcpServers.filter((server) => server.toolCount === null)
      .length,
    effectiveStaticMcpServerCount: exposure.serverCountForPressure,
    effectiveStaticMcpToolCount: exposure.knownToolCountForPressure,
    toolDeferralState: observation.toolDeferral?.state ?? null,
    toolDeferralMechanism: observation.toolDeferral?.mechanism ?? null,
  };
}

/** Runtime parser for additive schema-1 benchmark context evidence. */
export function parseTaskBenchmarkContextSnapshot(
  value: unknown,
): TaskBenchmarkContextSnapshot | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const observationState = row['observationState'];
  const rawMcpServerCount = nonNegativeInteger(row['rawMcpServerCount']);
  const rawKnownMcpToolCount = nonNegativeInteger(row['rawKnownMcpToolCount']);
  const unknownMcpToolServerCount = nonNegativeInteger(row['unknownMcpToolServerCount']);
  const effectiveStaticMcpServerCount = nonNegativeInteger(row['effectiveStaticMcpServerCount']);
  const effectiveStaticMcpToolCount = nonNegativeInteger(row['effectiveStaticMcpToolCount']);
  const toolDeferralState = row['toolDeferralState'];
  const toolDeferralMechanism = row['toolDeferralMechanism'];

  if (
    (observationState !== 'observed' && observationState !== 'partial') ||
    rawMcpServerCount === undefined ||
    rawKnownMcpToolCount === undefined ||
    unknownMcpToolServerCount === undefined ||
    effectiveStaticMcpServerCount === undefined ||
    effectiveStaticMcpToolCount === undefined ||
    !(
      toolDeferralState === null ||
      (typeof toolDeferralState === 'string' &&
        DEFERRAL_STATES.has(toolDeferralState as ToolDeferralState))
    ) ||
    !(
      toolDeferralMechanism === null ||
      (typeof toolDeferralMechanism === 'string' &&
        DEFERRAL_MECHANISMS.has(toolDeferralMechanism as ToolDeferralObservation['mechanism']))
    ) ||
    unknownMcpToolServerCount > rawMcpServerCount ||
    effectiveStaticMcpServerCount > rawMcpServerCount ||
    effectiveStaticMcpToolCount > rawKnownMcpToolCount
  ) {
    return undefined;
  }

  return {
    observationState,
    rawMcpServerCount,
    rawKnownMcpToolCount,
    unknownMcpToolServerCount,
    effectiveStaticMcpServerCount,
    effectiveStaticMcpToolCount,
    toolDeferralState: toolDeferralState as ToolDeferralState | null,
    toolDeferralMechanism: toolDeferralMechanism as ToolDeferralObservation['mechanism'] | null,
  };
}

/**
 * Compare context exposure separately from the benchmark's quality/quota verdict.
 *
 * Effective static MCP exposure is primary because runtime-proven deferral can legitimately keep a
 * large raw inventory out of the static model-visible surface. Raw inventory is a secondary tie
 * breaker. Neither result is a subscription-quota claim.
 */
export function compareTaskBenchmarkContextSnapshots(
  baseline: TaskBenchmarkContextSnapshot | null | undefined,
  optimized: TaskBenchmarkContextSnapshot | null | undefined,
): TaskBenchmarkContextComparison {
  const left = baseline ?? null;
  const right = optimized ?? null;
  if (left === null || right === null) {
    return {
      verdict: 'unknown',
      baseline: left,
      optimized: right,
      reason:
        'both benchmark variants need observed context evidence before exposure can be compared',
    };
  }

  if (right.effectiveStaticMcpToolCount !== left.effectiveStaticMcpToolCount) {
    return {
      verdict:
        right.effectiveStaticMcpToolCount < left.effectiveStaticMcpToolCount
          ? 'reduced'
          : 'increased',
      baseline: left,
      optimized: right,
      reason:
        'effective static MCP tool exposure changed; this is context-shape evidence, not subscription quota',
    };
  }

  if (right.effectiveStaticMcpServerCount !== left.effectiveStaticMcpServerCount) {
    return {
      verdict:
        right.effectiveStaticMcpServerCount < left.effectiveStaticMcpServerCount
          ? 'reduced'
          : 'increased',
      baseline: left,
      optimized: right,
      reason:
        'effective static MCP server exposure changed; this is context-shape evidence, not subscription quota',
    };
  }

  if (right.rawKnownMcpToolCount !== left.rawKnownMcpToolCount) {
    return {
      verdict: right.rawKnownMcpToolCount < left.rawKnownMcpToolCount ? 'reduced' : 'increased',
      baseline: left,
      optimized: right,
      reason:
        'raw known MCP tool inventory changed while effective static exposure tied; inventory is not proof of model-visible token cost',
    };
  }

  return {
    verdict: 'same',
    baseline: left,
    optimized: right,
    reason: 'observed MCP inventory and effective static exposure were unchanged',
  };
}
