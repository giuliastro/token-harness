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
