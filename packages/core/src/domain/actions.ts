/**
 * Planned action types.
 *
 * RFC 0002 §Planning fixes the action families and the metadata every action
 * declares. Only `DelegatedProviderInstallAction` is specified field by field
 * upstream; the remaining payloads carry the minimum each family needs to be
 * displayed, serialized, and later executed.
 *
 * These are *types*. The executor is Phase 2 (PLAN §2.3) and deliberately does
 * not exist yet, which is why nothing here contains a closure or a side effect.
 */

import type { ProviderId } from './ids.js';

export type ActionRiskClass = 'read-only' | 'reversible' | 'delegated' | 'destructive';

/** RFC 0002 §Planning: "Every action declares: ..." */
export interface PlannedActionBase {
  /** Deterministic: the same plan input always yields the same ID. */
  id: string;
  riskClass: ActionRiskClass;
  requiresNetwork: boolean;
  requiresElevation: boolean;
  /** Files this action creates, modifies, or removes. */
  affectedPaths: string[];
  /** Executables this action invokes, by resolved name. */
  affectedProcesses: string[];
  preconditions: string[];
  postconditions: string[];
  /** What rollback needs captured before the action runs. */
  rollbackData: 'none' | 'file-snapshot' | 'directory-snapshot' | 'package-inventory';
  /** One sentence a reviewer can read without knowing the action kind. */
  explanation: string;
}

export interface DownloadArtifactAction extends PlannedActionBase {
  kind: 'download-artifact';
  url: string;
  destination: string;
  expectedDigest: string | null;
}

export interface PackageManagerInstallAction extends PlannedActionBase {
  kind: 'package-manager-install';
  packageManager: string;
  packageName: string;
  version: string | null;
}

export interface RunInstallerCommandAction extends PlannedActionBase {
  kind: 'run-installer-command';
  executable: string;
  args: string[];
}

/** RFC 0002 §Delegated provider install — specified verbatim upstream. */
export interface DelegatedProviderInstallAction extends PlannedActionBase {
  kind: 'delegated-provider-install';
  executable: string;
  args: string[];
  /**
   * Directories within which all writes must fall. Fully content-snapshotted
   * before the invocation, so undeclared writes inside the boundary are both
   * detected and reversible.
   */
  containmentBoundary: string[];
  /** Rollback is restore-from-snapshot, never an inverse command. */
  rollbackStrategy: 'restore-snapshot';
  /** True when the provider ships an uninstall command Token Harness may call. */
  upstreamUninstallAvailable: boolean;
}

export interface CreateDirectoryAction extends PlannedActionBase {
  kind: 'create-directory';
  path: string;
}

export interface WriteOwnedFileAction extends PlannedActionBase {
  kind: 'write-owned-file';
  path: string;
}

export interface MergeJsonAction extends PlannedActionBase {
  kind: 'merge-json';
  path: string;
  /** Dotted pointers into the document that this action owns. */
  ownedPointers: string[];
}

export interface MergeTomlAction extends PlannedActionBase {
  kind: 'merge-toml';
  path: string;
  ownedPointers: string[];
}

export interface MergeYamlAction extends PlannedActionBase {
  kind: 'merge-yaml';
  path: string;
  ownedPointers: string[];
}

export interface PatchMarkerBlockAction extends PlannedActionBase {
  kind: 'patch-marker-block';
  path: string;
  markerBegin: string;
  markerEnd: string;
}

export interface RemoveOwnedChangeAction extends PlannedActionBase {
  kind: 'remove-owned-change';
  path: string;
  /** The action ID whose effect this reverses. */
  reverses: string;
}

export interface RegisterMcpServerAction extends PlannedActionBase {
  kind: 'register-mcp-server';
  path: string;
  serverName: string;
}

export interface RegisterHookAction extends PlannedActionBase {
  kind: 'register-hook';
  path: string;
  hookEvent: string;
  matcher: string;
}

export type PlannedAction =
  | DownloadArtifactAction
  | PackageManagerInstallAction
  | RunInstallerCommandAction
  | DelegatedProviderInstallAction
  | CreateDirectoryAction
  | WriteOwnedFileAction
  | MergeJsonAction
  | MergeTomlAction
  | MergeYamlAction
  | PatchMarkerBlockAction
  | RemoveOwnedChangeAction
  | RegisterMcpServerAction
  | RegisterHookAction;

export type PlannedActionKind = PlannedAction['kind'];

/**
 * Display labels used by the plan renderer. RFC 0006 §Golden path fixes
 * "patch marker block" and "write owned file"; the rest follow the same
 * lowercase-words convention.
 */
const ACTION_LABELS: Readonly<Record<PlannedActionKind, string>> = {
  'download-artifact': 'download artifact',
  'package-manager-install': 'package install',
  'run-installer-command': 'run installer',
  'delegated-provider-install': 'delegated install',
  'create-directory': 'create directory',
  'write-owned-file': 'write owned file',
  'merge-json': 'merge json',
  'merge-toml': 'merge toml',
  'merge-yaml': 'merge yaml',
  'patch-marker-block': 'patch marker block',
  'remove-owned-change': 'remove owned change',
  'register-mcp-server': 'register mcp server',
  'register-hook': 'register hook',
};

export function actionLabel(kind: PlannedActionKind): string {
  return ACTION_LABELS[kind];
}

/** The path a plan line points at, or null for actions without a single target. */
export function primaryActionPath(action: PlannedAction): string | null {
  return action.affectedPaths[0] ?? null;
}

/** RFC 0002 §Installation channels and RFC 0004 §Network policy. */
export function planRequiresNetwork(actions: readonly PlannedAction[]): boolean {
  return actions.some((action) => action.requiresNetwork);
}

export function planRequiresElevation(actions: readonly PlannedAction[]): boolean {
  return actions.some((action) => action.requiresElevation);
}

/** RFC 0002 §Planning: no executable closures, so a plan is always serializable. */
export interface ProviderPlan {
  providerId: ProviderId;
  desiredState: 'configured' | 'absent';
  actions: PlannedAction[];
}
