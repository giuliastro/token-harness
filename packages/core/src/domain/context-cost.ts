/**
 * Context-cost observability — RFC 0011 Phase 18.2.
 *
 * Context is reported in native units first. Bytes are bytes; MCP tool inventory is a count.
 * Token Harness never converts either into a fake subscription percentage.
 */

import type { Diagnostic } from './diagnostics.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';

export type ContextObservationState = 'observed' | 'partial' | 'unavailable' | 'absent';
export type ContextObservationSource = 'native-rpc' | 'native-cli' | 'filesystem';

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

export interface NativeConfigOrigin {
  type: string;
  filePath: string | null;
  profile: string | null;
}

export interface NativePolicyTarget {
  kind: 'codex-user-config';
  filePath: string;
  version: string;
  profile: string | null;
  reasoningEffortOrigin: NativeConfigOrigin | null;
  verbosityOrigin: NativeConfigOrigin | null;
}

export interface HarnessContextObservation {
  harnessId: HarnessId;
  state: ContextObservationState;
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  projectDocMaxBytes: number | null;
  toolOutputTokenLimit: number | null;
  toolSearchEnabled: boolean | null;
  projectRootMarkers: string[] | null;
  projectDocFallbackFilenames: string[];
  /** Bytes of config-level instructions returned by the harness, content never emitted. */
  configInstructionBytes: number | null;
  availableModels: ModelObservation[];
  modelCatalogTruncated: boolean;
  mcpServers: McpServerObservation[];
  mcpInventoryTruncated: boolean;
  /** Writable native target discovered through a versioned harness-native read surface. */
  nativePolicyTarget: NativePolicyTarget | null;
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
