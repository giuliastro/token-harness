/**
 * Context-cost observability — RFC 0011 Phase 18.2.
 *
 * Context is reported in native units first. Bytes are bytes; MCP tool inventory is a count.
 * Token Harness never converts either into a fake subscription percentage.
 */

import type { Diagnostic } from './diagnostics.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';
import type { NativeConfigurationEnvironment } from './process.js';

export type ContextObservationState = 'observed' | 'partial' | 'unavailable' | 'absent';
export type ContextObservationSource = 'native-rpc' | 'native-cli' | 'filesystem';

export type ToolDeferralState = 'active' | 'available' | 'inactive' | 'unknown';

/**
 * Read-only lifecycle state for an optimizer that is intentionally outside the active stack.
 * `benchmark-ready` means the local candidate exposes the reviewed observation surfaces; it is
 * not an activation recommendation and says nothing about measured savings or quality.
 */
export type OptimizationCandidateState =
  | 'absent'
  | 'installed'
  | 'benchmark-ready'
  | 'unsupported-version';

export type OptimizationCandidateId = 'headroom' | 'mcptoon' | 'gitnexus';
export type OptimizationCandidateCategory = 'context-minimization' | 'mcp-discovery';

/** Bounded candidate metadata safe to project into product UI. No executable path or raw reason. */
export interface OptimizationCandidateObservation {
  id: OptimizationCandidateId;
  displayName: string;
  category: OptimizationCandidateCategory;
  state: OptimizationCandidateState;
  version: string | null;
  minimumBenchmarkVersion: string;
}

/**
 * Read-only evidence about a mechanism that can keep tool schemas out of the model-visible
 * surface until they are needed. `available` means the reviewed harness build contains the
 * mechanism but Token Harness cannot prove the live model/provider gate; it is deliberately not
 * a synonym for `active`.
 */
export interface ToolDeferralObservation {
  harnessId: HarnessId;
  mechanism: 'native-tool-search' | 'native-defer-loading' | 'external';
  state: ToolDeferralState;
  scope: 'mcp-tools' | 'tool-catalog';
  evidenceSource: ContextObservationSource | 'compatibility';
  reason: string;
}

export interface InstructionFileObservation {
  harnessId: HarnessId;
  path: string;
  scope: 'user' | 'project';
  byteLength: number;
  /**
   * Bytes known to be admitted by the harness loader. Null means the file is only a
   * documented candidate and this build cannot prove how much reached model context.
   */
  loadedBytes: number | null;
  truncated: boolean | null;
  source: 'filesystem';
}

export interface ModelObservation {
  harnessId: HarnessId;
  id: string;
  model: string;
  displayName: string;
  modelSpecialty: string | null;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  source: 'native-rpc';
}

export interface McpServerObservation {
  harnessId: HarnessId;
  name: string;
  toolCount: number | null;
  runtimeStatus: string | null;
  authStatus: string | null;
  pluginId: string | null;
  source: 'native-rpc' | 'native-cli';
}

export type McpExposurePressure = 'low' | 'moderate' | 'high' | 'unknown';
export type McpUsability = 'usable' | 'attention' | 'disabled' | 'unknown';
export type McpAssessmentAction = 'none' | 'review-exposure' | 'fix-or-disable-if-unneeded';

export interface McpServerAssessment {
  harnessId: HarnessId;
  name: string;
  toolCount: number | null;
  exposure: McpExposurePressure;
  usability: McpUsability;
  action: McpAssessmentAction;
  /**
   * False until Token Harness has task relevance or actual per-server usage evidence.
   * A high tool count alone is never enough evidence to recommend removal.
   */
  hasRemovalEvidence: boolean;
  reason: string;
}

export interface ManagedConfigTargetObservation {
  harnessId: HarnessId;
  scope: 'user';
  /** Exact writable native config file, as reported by the harness. */
  path: string;
  /** Native optimistic-concurrency version for this layer. */
  version: string;
  source: 'native-rpc';
}

export interface ManagedConfigFieldOriginObservation {
  harnessId: HarnessId;
  /** Native dotted key path, limited to fields Token Harness may manage in Phase 18.4. */
  keyPath: string;
  /** Raw native layer source type, preserved rather than guessed into precedence classes. */
  sourceType: string;
  path: string | null;
  profile: string | null;
  version: string;
  /** True only when this field currently comes from the exact writable base-user layer. */
  matchesManagedTarget: boolean;
  source: 'native-rpc';
}

/** File-based Claude preference, not a claim about an active session or a native model catalog. */
export interface NativeEffortObservation {
  /** Readability of the persisted user field, independent of managed-write eligibility. */
  preferenceState?: 'configured' | 'unset' | 'unreadable';
  /** Bounded, non-sensitive explanation of the read result. Never raw parser errors. */
  preferenceReason?: string;
  writeBlock?: 'version' | 'cli' | 'environment' | 'custom-root' | 'override' | 'settings' | null;
  harnessVersion: string;
  supported: string[];
  current: string | null;
  source: 'native-cli+filesystem';
  verification: 'config-only';
  writable: boolean;
  reason: string;
  path: string;
  files: Array<{ path: string; digest: string | null }>;
  environment: NativeConfigurationEnvironment | null;
}

/** Policy observed at a task boundary; never proof of the running session's settings. */
export interface BenchmarkPolicySnapshot {
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  verification: 'config-only';
}

export interface HarnessContextObservation {
  /** Optional persisted identity for controlled benchmarking, not an effective-session reading. */
  benchmarkPolicy?: BenchmarkPolicySnapshot | null;
  nativeEffort?: NativeEffortObservation | null;
  harnessId: HarnessId;
  state: ContextObservationState;
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  projectDocMaxBytes: number | null;
  toolOutputTokenLimit: number | null;
  /** Legacy/raw harness feature value. Never treat it as effective deferral by itself. */
  toolSearchEnabled: boolean | null;
  /** Additive evidence; omitted by legacy observations. */
  toolDeferral?: ToolDeferralObservation | null;
  projectRootMarkers: string[] | null;
  projectDocFallbackFilenames: string[];
  /** Bytes of config-level instructions returned by the harness, content never emitted. */
  configInstructionBytes: number | null;
  /**
   * Native writable user-config target, when the harness exposes one together with a version.
   * Null means Token Harness must remain advisory rather than guessing a write path/version.
   */
  managedConfigTarget: ManagedConfigTargetObservation | null;
  /** True only when Codex returned a native origins object, even if a specific field is absent. */
  managedConfigOriginsObserved: boolean;
  /** Effective origins for the native policy fields Token Harness is evaluating. */
  managedConfigFieldOrigins: ManagedConfigFieldOriginObservation[];
  availableModels: ModelObservation[];
  modelCatalogTruncated: boolean;
  mcpServers: McpServerObservation[];
  mcpInventoryTruncated: boolean;
  diagnostics: Diagnostic[];
}

export interface InstructionHierarchyObservation {
  harnessId: HarnessId;
  projectFileCount: number;
  userFileCount: number;
  distinctProjectDirectories: number;
  nestedProjectHierarchy: boolean;
  largestProjectFileBytes: number | null;
  monolithicProjectInstructions: boolean;
  reason: string | null;
}

export interface McpHarnessReport {
  harnessId: HarnessId;
  state: ContextObservationState;
  servers: McpServerObservation[];
  assessments: McpServerAssessment[];
  knownToolCount: number;
  unknownToolServerCount: number;
  inventoryTruncated: boolean;
  diagnostics: Diagnostic[];
}

export interface McpReport {
  platform: PlatformFacts;
  projectRoot: string;
  observedAt: string;
  harnesses: McpHarnessReport[];
}

export interface EffectiveMcpExposure {
  rawServerCount: number;
  rawKnownToolCount: number;
  serverCountForPressure: number;
  knownToolCountForPressure: number;
  deferralState: ToolDeferralState | null;
}

/**
 * Counts only evidence that is actually model-visible for pressure scoring. A merely `available`
 * mechanism cannot reduce the count: only runtime-proven `active` deferral does.
 */
export function effectiveMcpExposure(
  observation: Pick<HarnessContextObservation, 'mcpServers' | 'toolDeferral'>,
): EffectiveMcpExposure {
  const rawServerCount = observation.mcpServers.length;
  const rawKnownToolCount = observation.mcpServers.reduce(
    (total, server) => total + (server.toolCount ?? 0),
    0,
  );
  const deferralState = observation.toolDeferral?.state ?? null;
  return {
    rawServerCount,
    rawKnownToolCount,
    serverCountForPressure: deferralState === 'active' ? 0 : rawServerCount,
    knownToolCountForPressure: deferralState === 'active' ? 0 : rawKnownToolCount,
    deferralState,
  };
}

export interface ContextReport {
  platform: PlatformFacts;
  projectRoot: string;
  observedAt: string;
  instructions: InstructionFileObservation[];
  /** Sum only where loadedBytes is known. Unknown candidates are intentionally excluded. */
  knownLoadedInstructionBytes: number;
  discoveredInstructionBytes: number;
  instructionHierarchy: InstructionHierarchyObservation[];
  harnesses: HarnessContextObservation[];
  /** Additive read-only candidate state. Omitted by older producers and synthetic fixtures. */
  optimizationCandidates?: OptimizationCandidateObservation[];
}

export function assessMcpServer(server: McpServerObservation): McpServerAssessment {
  const exposure: McpExposurePressure =
    server.toolCount === null
      ? 'unknown'
      : server.toolCount >= 20
        ? 'high'
        : server.toolCount >= 10
          ? 'moderate'
          : 'low';

  const status = [server.runtimeStatus, server.authStatus]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();

  const usability: McpUsability = status.includes('disabled')
    ? 'disabled'
    : /fail|error|needs authentication|authenticationrequired|unauthenticated/.test(status)
      ? 'attention'
      : /connected|running|ready/.test(status)
        ? 'usable'
        : 'unknown';

  const action: McpAssessmentAction =
    usability === 'attention'
      ? 'fix-or-disable-if-unneeded'
      : exposure === 'high'
        ? 'review-exposure'
        : 'none';

  const reason =
    usability === 'attention'
      ? 'the server is not currently usable; task relevance is still unknown'
      : exposure === 'high'
        ? 'the server exposes at least 20 known tools; usage and task relevance are not observed'
        : exposure === 'moderate'
          ? 'the server exposes 10-19 known tools; usage and task relevance are not observed'
          : exposure === 'low'
            ? 'the server exposes fewer than 10 known tools; usage and task relevance are not observed'
            : 'tool exposure is unknown; usage and task relevance are not observed';

  return {
    harnessId: server.harnessId,
    name: server.name,
    toolCount: server.toolCount,
    exposure,
    usability,
    action,
    hasRemovalEvidence: false,
    reason,
  };
}

/** Resolve only observed configuration/catalog defaults; do not guess a model from its name. */
export function benchmarkPolicySnapshot(
  observation: HarnessContextObservation | undefined,
): BenchmarkPolicySnapshot | null {
  if (
    observation === undefined ||
    observation.state === 'absent' ||
    observation.state === 'unavailable'
  )
    return null;
  if (observation.benchmarkPolicy !== undefined) return observation.benchmarkPolicy;
  const model = observation.availableModels.find(
    (item) => item.model === observation.model || item.id === observation.model,
  );
  return {
    model: observation.model,
    reasoningEffort:
      observation.reasoningEffort ??
      model?.defaultReasoningEffort ??
      observation.nativeEffort?.current ??
      null,
    verbosity: observation.verbosity,
    verification: 'config-only',
  };
}
