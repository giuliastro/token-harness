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

/**
 * Where inside a harness a declaration applies.
 *
 * RFC 0003 resolves ownership over a four-part scope, but a declaration named only a
 * capability and a list of harnesses — two of the four. The missing two are not a detail:
 * RFC 0003 §The table is an intent turns on exactly them, recording that HarnessTrim's
 * Claude adapter matches `Bash` and nothing else while its OpenCode plugin reduces every
 * tool result. A resolver that could not tell those apart would have to treat "reduces
 * Bash output" and "reduces all output" as the same claim, and the RFC's central finding
 * would be inexpressible.
 *
 * So this fills the gap between the four-part scope and the two-part declaration. It is
 * additive to RFC 0002 §Manifest in the same sense as the other member types there, whose
 * comment already notes they are "defined here from the properties the RFC states
 * elsewhere".
 */
export interface CapabilitySurface {
  /** A `HarnessToolFamily.id`, or `'*'` for every family the harness exposes. */
  toolFamily: string;
  /** A `HarnessInterceptionPoint.scopeId`. */
  interceptionPoint: string;
}

/** `'*'` matches whatever the harness exposes, so a wildcard claim covers new families too. */
export const EVERY_TOOL_FAMILY = '*';

export function surfaceCoversToolFamily(surface: CapabilitySurface, toolFamily: string): boolean {
  return surface.toolFamily === EVERY_TOOL_FAMILY || surface.toolFamily === toolFamily;
}

/** RFC 0002 §Manifest — one entry of `capabilities`. */
export interface CapabilityDeclaration {
  capability: CapabilityId;
  mode: CompositionMode;
  /** Harnesses on which the provider actually implements it, per RFC 0003 §Rule. */
  harnesses: HarnessId[];
  /**
   * The surfaces within those harnesses. Empty means the provider claims none, which is a
   * declaration that resolves to no ownership rather than to every scope — RFC 0003 §Rule
   * makes an unevidenced assignment "a planning error, not a configuration to attempt".
   */
  surfaces: CapabilitySurface[];
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
