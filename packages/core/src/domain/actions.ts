/**
 * Planned action types.
 *
 * RFC 0002 §Planning fixes the action families and the metadata every action
 * declares. Only `DelegatedProviderInstallAction` is specified field by field
 * upstream; the remaining payloads carry the minimum each family needs to be
 * displayed, serialized, and later executed.
 *
 * These are *types*: nothing here contains a closure or a side effect, per RFC
 * 0002 §Planning — "a provider plan contains no executable closures and can be
 * serialized as JSON".
 *
 * The file-touching families carry their *payload* as data, which PLAN §15 issue 6
 * added to what Phase 1 left as the display minimum. That is not a convenience.
 * RFC 0006 §Plan persistence makes `apply --plan <id>` the mechanism by which "the
 * artifact a human or a reviewer approved is the artifact that runs", and a plan
 * that does not record the bytes it will write is a plan nobody can approve. The
 * same clause is why each of them carries a precondition digest: RFC 0006 rejects a
 * stored plan when "a recorded precondition digest no longer matches".
 */

import type { HarnessId, ProviderId } from './ids.js';
import type { JsonMergeOperation, JsonValue } from './json.js';
import type { YamlMergeOperation } from './yaml.js';
import type { OwnedArtifact } from './ownership.js';

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
  /** Exact provider artifacts that prove this reviewed install completed. */
  expectedArtifacts: Array<{
    path: string;
    digest: string;
  }>;
  /** Paths the installer must leave byte-for-byte unchanged. */
  protectedPaths: string[];
  /** Rollback is restore-from-snapshot, never an inverse command. */
  rollbackStrategy: 'restore-snapshot';
  /** Upper bound on bytes captured from the containment boundary before execution. */
  snapshotSizeCapBytes: number;
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
  /** The exact content to write, UTF-8. */
  content: string;
  /** Four-digit octal POSIX mode, or null to leave it to the platform default. */
  mode: string | null;
  /**
   * What must already be there.
   *
   * Null means the file must not exist. A digest means it must exist with exactly
   * that content — which is how a file the user created since planning stops an
   * overwrite instead of becoming one.
   */
  expectedDigest: string | null;
}

export interface MergeJsonAction extends PlannedActionBase {
  kind: 'merge-json';
  path: string;
  /**
   * Dotted pointers into the document that this action owns.
   *
   * Declared separately from the operations, and checked against them: RFC 0004
   * §Ownership scopes removal to "exact JSON/TOML/YAML entries recorded in its
   * journal", so the claim a reviewer reads must be the claim the executor makes.
   */
  ownedPointers: string[];
  /** What to write, and what must already be there. */
  operations: JsonMergeOperation[];
  /** Whether the document may be created when it does not exist. */
  createIfMissing: boolean;
}

export interface MergeTomlAction extends PlannedActionBase {
  kind: 'merge-toml';
  path: string;
  ownedPointers: string[];
}

/**
 * Atomic user-config mutation through Codex app-server's native config/batchWrite RPC.
 *
 * Phase 18.4 deliberately models this as a first-class action instead of pretending TOML can be
 * edited safely with the generic merge family. Codex owns the parser/serializer; Token Harness
 * owns the transaction boundary, precondition and rollback snapshot.
 */
export interface CodexConfigBatchWriteAction extends PlannedActionBase {
  kind: 'codex-config-batch-write';
  /** Exact user config.toml path that Codex must mutate. */
  path: string;
  edits: Array<{
    keyPath: string;
    value: JsonValue;
    mergeStrategy: 'replace' | 'upsert';
  }>;
  /**
   * Additional executor invariant for optimizer-generated quota policy.
   *
   * `subscription-safe` means this batch may edit only the narrow settings that cannot select
   * another provider, auth path, service tier, or other paid API route. Null keeps this action
   * usable as a generic first-class Codex config transaction for separately reviewed features.
   */
  policyGuard: 'subscription-safe' | null;
  /** Config version returned by the read used to build the plan; null only for fresh/unsupported readers. */
  expectedVersion: string | null;
  /** Whether Codex should hot-reload mutable user config after the atomic write. */
  reloadUserConfig: boolean;
}

export interface MergeYamlAction extends PlannedActionBase {
  kind: 'merge-yaml';
  path: string;
  ownedPointers: string[];
  /** Narrow, serializable operations; currently only block-sequence string append is admitted. */
  operations: YamlMergeOperation[];
  /** Whether a missing YAML document may be created. */
  createIfMissing: boolean;
}

export interface PatchMarkerBlockAction extends PlannedActionBase {
  kind: 'patch-marker-block';
  path: string;
  /** A token, not a whole line: the fence is located by a line containing it. */
  markerBegin: string;
  markerEnd: string;
  /**
   * Comment syntax for the fence lines, in the host file's language: `#` with no
   * suffix for a shell or TOML file, `<!--` and `-->` for Markdown.
   *
   * Carried by the action rather than inferred from the file extension, because a
   * fence written in the wrong syntax is a fence that breaks the file it is in, and
   * the adapter that chose the file knows its language.
   */
  commentPrefix: string;
  commentSuffix: string;
  /** The body between the fences. Everything outside them belongs to the user. */
  body: string;
  /** Null means no block must be there yet; a digest means our block must be exactly that. */
  expectedBodyDigest: string | null;
  /** Whether the file may be created when it does not exist, as `AGENTS.md` often will not. */
  createIfMissing: boolean;
}

export interface RemoveOwnedChangeAction extends PlannedActionBase {
  kind: 'remove-owned-change';
  path: string;
  /** The action ID whose effect this reverses. */
  reverses: string;
  /**
   * What the plan believes it owns, stated in the plan rather than looked up while
   * applying.
   *
   * RFC 0004 §Ownership permits removal only while the claim still holds, so the
   * claim has to be reviewable *before* apply — and it has to be checkable against
   * the live file, which is what turns "user edits block automatic deletion" into a
   * refusal rather than a hope.
   */
  target: OwnedArtifact;
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
  | CodexConfigBatchWriteAction
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
  'codex-config-batch-write': 'codex config batch write',
  'merge-yaml': 'merge yaml',
  'patch-marker-block': 'patch marker block',
  'remove-owned-change': 'remove owned change',
  'register-mcp-server': 'register mcp server',
  'register-hook': 'register hook',
};

export function actionLabel(kind: PlannedActionKind): string {
  return ACTION_LABELS[kind];
}

export function isPlannedActionKind(value: string): value is PlannedActionKind {
  return Object.hasOwn(ACTION_LABELS, value);
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
  /**
   * Harnesses the actions in this plan actually mutate.
   *
   * Optional for third-party/older adapters, with the planner retaining its conservative fallback.
   * Built-in adapters populate it so the transaction journal can distinguish a managed integration
   * from a brownfield installation that merely happens to be configured.
   */
  targetHarnesses?: HarnessId[];
}
