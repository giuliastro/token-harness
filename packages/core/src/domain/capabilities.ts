/**
 * Capability taxonomy, composition modes, and scoped ownership.
 *
 * RFC 0003 §Capability taxonomy fixes the initial capability IDs, §Composition
 * modes fixes the defaults, and §Scope fixes the ownership address format.
 */

import type { ProviderId, HarnessId } from './ids.js';

export const CAPABILITY_IDS = [
  'shell.command.rewrite',
  'shell.output.reduce',
  'shell.output.deduplicate',
  'tool.output.reduce',
  'mcp.schema.lazy',
  'mcp.result.sandbox',
  'repo.context.retrieve',
  'conversation.compact',
  'instructions.progressive',
  'model.output.terse',
  'reasoning.effort.route',
  'metrics.observe',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export function isCapabilityId(value: string): value is CapabilityId {
  return (CAPABILITY_IDS as readonly string[]).includes(value);
}

export type CompositionMode = 'exclusive' | 'chainable' | 'observational';

/** RFC 0003 §Composition modes — the declared defaults, as data. */
const DEFAULT_COMPOSITION_MODES: Readonly<Record<CapabilityId, CompositionMode>> = {
  'shell.command.rewrite': 'exclusive',
  'shell.output.reduce': 'exclusive',
  'shell.output.deduplicate': 'chainable',
  'tool.output.reduce': 'exclusive',
  'mcp.schema.lazy': 'chainable',
  'mcp.result.sandbox': 'chainable',
  'repo.context.retrieve': 'chainable',
  'conversation.compact': 'exclusive',
  'instructions.progressive': 'chainable',
  'model.output.terse': 'chainable',
  'reasoning.effort.route': 'exclusive',
  'metrics.observe': 'observational',
};

export function defaultCompositionMode(capability: CapabilityId): CompositionMode {
  return DEFAULT_COMPOSITION_MODES[capability];
}

/**
 * RFC 0003 §Scope: ownership is resolved over
 * `<harness>/<tool-family>/<interception-point>/<capability>`.
 */
export interface CapabilityScope {
  harness: HarnessId;
  toolFamily: string;
  interceptionPoint: string;
  capability: CapabilityId;
}

export function formatCapabilityScope(scope: CapabilityScope): string {
  return `${scope.harness}/${scope.toolFamily}/${scope.interceptionPoint}/${scope.capability}`;
}

export function parseCapabilityScope(value: string): CapabilityScope | null {
  const parts = value.split('/');
  if (parts.length !== 4) return null;
  const [harness, toolFamily, interceptionPoint, capability] = parts;
  if (
    harness === undefined ||
    toolFamily === undefined ||
    interceptionPoint === undefined ||
    capability === undefined
  ) {
    return null;
  }
  if (harness === '' || toolFamily === '' || interceptionPoint === '') return null;
  if (!isCapabilityId(capability)) return null;
  return {
    harness: harness as HarnessId,
    toolFamily,
    interceptionPoint,
    capability,
  };
}

/** RFC 0002 §Manifest — one entry of `capabilities`. */
export interface CapabilityDeclaration {
  capability: CapabilityId;
  mode: CompositionMode;
  /** Harnesses on which the provider actually implements it, per RFC 0003 §Rule. */
  harnesses: HarnessId[];
  /**
   * RFC 0003 §Rule: an assignment "requires a demonstrated capability ...
   * evidenced in the provider's own source at a recorded version".
   */
  evidence: {
    sourceReference: string;
    upstreamVersion: string;
  } | null;
}

/** RFC 0003 §Planner result — the resolved owner of one scope. */
export interface ResolvedCapability {
  scope: CapabilityScope;
  owner: ProviderId;
  mode: CompositionMode;
  /** Position in a chain; 0 for an exclusive or observational owner. */
  order: number;
}

/** RFC 0003 §Planner result — a provider excluded from a scope, and why. */
export interface CapabilityExclusion {
  scope: CapabilityScope;
  excluded: ProviderId;
  /** The provider that kept the scope, when one did. */
  retained: ProviderId | null;
  /** One reason per rendered line, so human and JSON stay in step. */
  reason: string[];
}
