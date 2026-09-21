import {
  compareVersions,
  diagnostic,
  digestText,
  harnessId,
  jsonValueDigest,
  parseSemanticVersion,
  parseJsonDocumentText,
  parseJsonPointer,
  resolveJsonPointer,
  type Diagnostic,
  type HarnessId,
  type JsonValue,
  type OwnedArtifact,
  type PlannedAction,
} from '@token-harness/core';

import type { ProviderContext } from './contract.js';
import { parseGitNexusCliCapabilities, parseGitNexusVersion } from './gitnexus-candidate.js';

/**
 * First reviewed managed MCP slice for GitNexus.
 *
 * Upstream `gitnexus setup` also manages skills and other editor surfaces, so Token Harness does
 * not invoke it. This slice owns one exact MCP registration per harness: a Claude Code user-scoped
 * JSON entry or a marker-fenced Codex TOML block. The generic transaction actions preserve
 * unrelated user configuration and emit ownership receipts for surgical uninstall.
 */
export const GITNEXUS_REVIEWED_MCP_VERSION = '1.6.12';
export const GITNEXUS_CLAUDE_MCP_POINTER = 'mcpServers.gitnexus';
export const GITNEXUS_CODEX_MARKER_BEGIN = 'TOKEN-HARNESS:GITNEXUS-MCP:BEGIN';
export const GITNEXUS_CODEX_MARKER_END = 'TOKEN-HARNESS:GITNEXUS-MCP:END';
export const GITNEXUS_CODEX_MCP_BODY =
  '[mcp_servers.gitnexus]\ncommand = "gitnexus"\nargs = ["mcp"]';
export const GITNEXUS_MCP_SERVER: JsonValue = {
  command: 'gitnexus',
  args: ['mcp'],
};

export interface GitNexusManagedMcpPlan {
  harness: HarnessId;
  target: string | null;
  actions: PlannedAction[];
  diagnostics: Diagnostic[];
}

export type GitNexusManagedMcpVerificationState =
  | 'verified'
  | 'not-configured'
  | 'candidate-unavailable'
  | 'degraded';

export interface GitNexusManagedMcpVerification {
  state: GitNexusManagedMcpVerificationState;
  target: string | null;
  detail: string;
}

const DECODER = new TextDecoder();

function claudeTarget(context: ProviderContext): string {
  return context.fs.join(context.paths.home, '.claude.json');
}

function codexTarget(context: ProviderContext): string {
  return context.fs.join(context.paths.home, '.codex', 'config.toml');
}

function codexExpectedBlock(): string {
  return [
    `# ${GITNEXUS_CODEX_MARKER_BEGIN}`,
    GITNEXUS_CODEX_MCP_BODY,
    `# ${GITNEXUS_CODEX_MARKER_END}`,
  ].join('\n');
}

export interface GitNexusManagedRuntime {
  ready: boolean;
  absent: boolean;
  version: string | null;
  executable: string | null;
  supportsMcp: boolean;
  detail: string;
}

export async function observeGitNexusManagedRuntime(
  context: ProviderContext,
): Promise<GitNexusManagedRuntime> {
  const versionOutcome = await context.runner.run({
    executable: 'gitnexus',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (versionOutcome.failure !== null) {
    return {
      ready: false,
      absent: versionOutcome.failure.reason === 'executable-not-found',
      version: null,
      executable: versionOutcome.executablePath,
      supportsMcp: false,
      detail: `gitnexus --version failed: ${versionOutcome.failure.reason}`,
    };
  }
  const version = parseGitNexusVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  const actual = version === null ? null : parseSemanticVersion(version);
  const floor = parseSemanticVersion(GITNEXUS_REVIEWED_MCP_VERSION);
  const newEnough = actual !== null && floor !== null && compareVersions(actual, floor) >= 0;
  if (versionOutcome.exitCode !== 0 || !newEnough) {
    return {
      ready: false,
      absent: false,
      version,
      executable: versionOutcome.executablePath,
      supportsMcp: false,
      detail:
        version === null
          ? 'GitNexus did not report a semantic version'
          : `GitNexus ${version} predates the managed MCP floor ${GITNEXUS_REVIEWED_MCP_VERSION}`,
    };
  }

  const help = await context.runner.run({
    executable: 'gitnexus',
    args: ['--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const capabilities =
    help.failure === null && help.exitCode === 0
      ? parseGitNexusCliCapabilities(`${help.stdout}\n${help.stderr}`, '')
      : { query: false, context: false, statusJson: false, mcp: false };
  return {
    ready: capabilities.mcp,
    absent: false,
    version,
    executable: versionOutcome.executablePath,
    supportsMcp: capabilities.mcp,
    detail: capabilities.mcp
      ? `GitNexus ${version} exposes the MCP command required by the managed integration`
      : `GitNexus ${version} does not advertise the MCP command required by the managed integration`,
  };
}

function prerequisiteDiagnostic(harness: HarnessId, detail: string): Diagnostic {
  return diagnostic({
    severity: 'warning',
    code: 'gitnexus-managed-mcp-prerequisite',
    subject: harness,
    message: detail,
    remediation: `Install or update GitNexus to ${GITNEXUS_REVIEWED_MCP_VERSION} or newer with the MCP command, then refresh Token Harness`,
  });
}

function gitnexusInstallAction(): PlannedAction {
  return {
    kind: 'package-manager-install',
    id: `gitnexus:install:${GITNEXUS_REVIEWED_MCP_VERSION}`,
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['npm'],
    preconditions: [
      'npm remains runnable',
      `the reviewed GitNexus ${GITNEXUS_REVIEWED_MCP_VERSION} package remains installable`,
    ],
    postconditions: [
      `GitNexus ${GITNEXUS_REVIEWED_MCP_VERSION} is installed and exposes the mcp command`,
    ],
    rollbackData: 'package-inventory',
    explanation: `Install the reviewed GitNexus ${GITNEXUS_REVIEWED_MCP_VERSION} CLI through npm`,
    packageManager: 'npm',
    packageName: 'gitnexus',
    version: GITNEXUS_REVIEWED_MCP_VERSION,
  };
}

function codexDirectoryAction(harness: HarnessId, path: string): PlannedAction {
  return {
    kind: 'create-directory',
    id: `gitnexus:${harness}:directory`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: ['The GitNexus Codex configuration directory is still absent'],
    postconditions: ['The GitNexus Codex configuration directory exists'],
    rollbackData: 'file-snapshot',
    explanation:
      'Create the directory that contains the Token Harness-owned GitNexus Codex integration',
    path,
  };
}

async function planCodexRegistration(
  context: ProviderContext,
  harness: HarnessId,
): Promise<GitNexusManagedMcpPlan> {
  const directory = context.fs.join(context.paths.home, '.codex');
  const target = codexTarget(context);
  if (!context.fs.isInside(target, context.paths.home)) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'gitnexus-codex-mcp-target-outside-home',
          subject: harness,
          message: 'The resolved Codex MCP configuration is outside the user home directory',
          path: target,
          remediation: 'Inspect the resolved home directory before managing GitNexus MCP',
        }),
      ],
    };
  }

  const actions: PlannedAction[] = [];
  const directoryStat = await context.fs.stat(directory);
  if (directoryStat !== null && directoryStat.kind !== 'directory') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-codex-directory-conflict',
          subject: harness,
          message: 'Codex configuration directory is occupied by a non-directory path',
          path: directory,
          remediation: 'Resolve the path conflict manually before enabling managed GitNexus MCP',
        }),
      ],
    };
  }
  if (directoryStat === null) actions.push(codexDirectoryAction(harness, directory));

  const stat = await context.fs.stat(target);
  if (stat !== null && stat.kind !== 'file') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-codex-config-path-conflict',
          subject: harness,
          message: 'Codex configuration is not a regular file',
          path: target,
          remediation: 'Resolve the path conflict manually before enabling managed GitNexus MCP',
        }),
      ],
    };
  }

  if (stat !== null) {
    const text = DECODER.decode(await context.fs.readFile(target));
    const hasBegin = text.includes(GITNEXUS_CODEX_MARKER_BEGIN);
    const hasEnd = text.includes(GITNEXUS_CODEX_MARKER_END);
    if (hasBegin || hasEnd) {
      if (hasBegin && hasEnd && text.includes(codexExpectedBlock())) {
        return {
          harness,
          target,
          actions: [],
          diagnostics: [
            diagnostic({
              severity: 'info',
              code: 'gitnexus-codex-mcp-already-present',
              subject: harness,
              message: 'The reviewed GitNexus Codex MCP block is already present',
              path: target,
              remediation: null,
            }),
          ],
        };
      }
      return {
        harness,
        target,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'gitnexus-codex-mcp-marker-drift',
            subject: harness,
            message:
              'An existing Token Harness GitNexus marker block differs from the reviewed content',
            path: target,
            remediation: 'Review the existing block before changing it',
          }),
        ],
      };
    }
    if (/^\s*\[mcp_servers\.gitnexus\]\s*$/m.test(text)) {
      return {
        harness,
        target,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'gitnexus-codex-mcp-user-owned',
            subject: harness,
            message:
              'A user-owned mcp_servers.gitnexus table already exists and will not be overwritten',
            path: target,
            remediation: 'Review the existing GitNexus MCP configuration manually',
          }),
        ],
      };
    }
  }

  actions.push({
    kind: 'patch-marker-block',
    id: 'gitnexus:codex:mcp-server',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['No GitNexus MCP table or Token Harness GitNexus marker block exists'],
    postconditions: ['Codex config contains exactly one Token Harness GitNexus MCP server block'],
    rollbackData: 'file-snapshot',
    explanation: 'Register the installed reviewed GitNexus CLI as a Codex MCP server',
    path: target,
    markerBegin: GITNEXUS_CODEX_MARKER_BEGIN,
    markerEnd: GITNEXUS_CODEX_MARKER_END,
    commentPrefix: '#',
    commentSuffix: '',
    body: GITNEXUS_CODEX_MCP_BODY,
    expectedBodyDigest: null,
    createIfMissing: true,
  });
  return { harness, target, actions, diagnostics: [] };
}

export async function planGitNexusManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<GitNexusManagedMcpPlan> {
  if (harness !== 'claude' && harness !== 'codex') {
    return {
      harness,
      target: null,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-managed-mcp-harness-unsupported',
          subject: harness,
          message:
            'Managed GitNexus MCP registration is currently reviewed only for Claude Code and Codex',
          remediation:
            'Keep this harness configuration user-owned until Token Harness has a surgical ownership path for it',
        }),
      ],
    };
  }

  const observation = await observeGitNexusManagedRuntime(context);
  const installActions: PlannedAction[] = [];
  if (!observation.ready) {
    if (!observation.absent) {
      return {
        harness,
        target: null,
        actions: [],
        diagnostics: [prerequisiteDiagnostic(harness, observation.detail)],
      };
    }

    const npm = await context.runner.run({
      executable: 'npm',
      args: ['--version'],
      cwd: context.projectRoot,
      timeoutMs: 20_000,
    });
    if (npm.failure !== null || npm.exitCode !== 0) {
      return {
        harness,
        target: null,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'gitnexus-npm-unavailable',
            subject: harness,
            message: 'GitNexus is absent and npm is not available in this terminal',
            remediation:
              'Make npm available on PATH, then refresh Token Harness. Token Harness will not bootstrap Node.js or administrator prerequisites.',
          }),
        ],
      };
    }
    installActions.push(gitnexusInstallAction());
  }

  if (harness === 'codex') {
    const activation = await planCodexRegistration(context, harness);
    return { ...activation, actions: [...installActions, ...activation.actions] };
  }

  const target = claudeTarget(context);
  if (!context.fs.isInside(target, context.paths.home)) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'gitnexus-mcp-target-outside-home',
          subject: harness,
          message: 'The resolved Claude MCP configuration is outside the user home directory',
          path: target,
          remediation: 'Inspect the resolved home directory before managing GitNexus MCP',
        }),
      ],
    };
  }

  const stat = await context.fs.stat(target);
  if (stat !== null && stat.kind !== 'file') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-mcp-config-path-conflict',
          subject: harness,
          message: 'Claude user configuration is not a regular file, so it cannot be merged safely',
          path: target,
          remediation: 'Resolve the path conflict manually before enabling managed GitNexus MCP',
        }),
      ],
    };
  }

  if (stat !== null) {
    const parsed = parseJsonDocumentText(DECODER.decode(await context.fs.readFile(target)));
    if (parsed.state !== 'parsed') {
      return {
        harness,
        target,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code:
              parsed.state === 'comments'
                ? 'gitnexus-mcp-json-comments-unsupported'
                : 'gitnexus-mcp-json-malformed',
            subject: harness,
            message:
              parsed.state === 'comments'
                ? 'Claude user configuration contains comments that Token Harness cannot preserve with the reviewed JSON merge path'
                : `Claude user configuration is malformed JSON: ${parsed.reason}`,
            path: target,
            remediation:
              'Keep this configuration user-owned or repair it before enabling managed GitNexus MCP',
          }),
        ],
      };
    }

    const segments = parseJsonPointer(GITNEXUS_CLAUDE_MCP_POINTER);
    const live =
      segments === null
        ? { found: false, value: undefined }
        : resolveJsonPointer(parsed.document, segments);
    if (live.found && live.value !== undefined) {
      if (jsonValueDigest(live.value) === jsonValueDigest(GITNEXUS_MCP_SERVER)) {
        return {
          harness,
          target,
          actions: [],
          diagnostics: [
            diagnostic({
              severity: 'info',
              code: 'gitnexus-mcp-already-present',
              subject: harness,
              message: 'The reviewed GitNexus MCP entry is already present and remains user-owned',
              path: target,
              remediation: null,
            }),
          ],
        };
      }
      return {
        harness,
        target,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'gitnexus-mcp-entry-user-owned',
            subject: harness,
            message: 'A different GitNexus MCP entry already exists and will not be overwritten',
            path: target,
            remediation: 'Review the existing mcpServers.gitnexus entry manually',
          }),
        ],
      };
    }
  }

  const action: PlannedAction = {
    kind: 'merge-json',
    id: 'gitnexus:claude:mcp-server',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['mcpServers.gitnexus is still absent'],
    postconditions: ['mcpServers.gitnexus matches the reviewed local GitNexus MCP command'],
    rollbackData: 'file-snapshot',
    explanation: 'Register the installed reviewed GitNexus CLI as a Claude Code MCP server',
    path: target,
    ownedPointers: [GITNEXUS_CLAUDE_MCP_POINTER],
    operations: [
      {
        kind: 'set',
        pointer: GITNEXUS_CLAUDE_MCP_POINTER,
        value: GITNEXUS_MCP_SERVER,
        expectedValueDigest: null,
      },
    ],
    createIfMissing: true,
  };

  return { harness, target, actions: [...installActions, action], diagnostics: [] };
}

/**
 * Build the surgical uninstall action from an ownership receipt emitted by `merge-json`.
 * A byte-identical brownfield entry never yields such a receipt, so this helper cannot claim it
 * retroactively. The generic executor re-checks the entry digest before removal and refuses user
 * edits.
 */
export function planGitNexusManagedMcpRemoval(
  context: ProviderContext,
  ownership: OwnedArtifact,
): GitNexusManagedMcpPlan {
  const claude = gitnexusOwnedArtifact(context, harnessId('claude')) as Extract<
    OwnedArtifact,
    { kind: 'owned-json-entry' }
  >;
  const codex = gitnexusOwnedArtifact(context, harnessId('codex')) as Extract<
    OwnedArtifact,
    { kind: 'owned-marker-block' }
  >;
  const matchesClaude =
    ownership.kind === 'owned-json-entry' &&
    ownership.path === claude.path &&
    ownership.pointer === GITNEXUS_CLAUDE_MCP_POINTER &&
    ownership.placement === 'value' &&
    ownership.valueDigest === jsonValueDigest(GITNEXUS_MCP_SERVER);
  const matchesCodex =
    ownership.kind === 'owned-marker-block' &&
    ownership.path === codex.path &&
    ownership.markerBegin === codex.markerBegin &&
    ownership.markerEnd === codex.markerEnd &&
    ownership.bodyDigest === codex.bodyDigest;
  const harness = matchesCodex ? ('codex' as HarnessId) : ('claude' as HarnessId);
  const target = matchesCodex ? codex : claude;
  if (!matchesClaude && !matchesCodex) {
    return {
      harness,
      target: target.path,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-mcp-ownership-mismatch',
          subject: harness,
          message:
            'The supplied ownership receipt does not identify the reviewed GitNexus MCP entry',
          path: target.path,
          remediation:
            'Use the ownership receipt from the committed GitNexus MCP activation transaction',
        }),
      ],
    };
  }

  const action: PlannedAction = {
    kind: 'remove-owned-change',
    id: `gitnexus:${harness}:mcp-server:remove`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.path],
    affectedProcesses: [],
    preconditions: ['The owned GitNexus MCP entry still matches its transaction receipt'],
    postconditions: ['Only the Token Harness-owned GitNexus MCP integration is removed'],
    rollbackData: 'file-snapshot',
    explanation: `Remove the exact GitNexus ${harness} MCP integration owned by Token Harness`,
    path: target.path,
    reverses: `gitnexus:${harness}:mcp-server`,
    target: ownership,
  };
  return { harness, target: target.path, actions: [action], diagnostics: [] };
}

export function gitnexusOwnedArtifact(
  context: ProviderContext,
  harness: HarnessId,
): OwnedArtifact | null {
  if (harness === 'claude') {
    return {
      kind: 'owned-json-entry',
      path: claudeTarget(context),
      pointer: GITNEXUS_CLAUDE_MCP_POINTER,
      placement: 'value',
      valueDigest: jsonValueDigest(GITNEXUS_MCP_SERVER),
    };
  }
  if (harness === 'codex') {
    return {
      kind: 'owned-marker-block',
      path: codexTarget(context),
      markerBegin: GITNEXUS_CODEX_MARKER_BEGIN,
      markerEnd: GITNEXUS_CODEX_MARKER_END,
      bodyDigest: digestText(GITNEXUS_CODEX_MCP_BODY),
    };
  }
  return null;
}

export async function verifyGitNexusManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<GitNexusManagedMcpVerification> {
  if (harness !== 'claude' && harness !== 'codex') {
    return {
      state: 'degraded',
      target: null,
      detail:
        'Managed GitNexus MCP verification is currently reviewed only for Claude Code and Codex',
    };
  }

  const observation = await observeGitNexusManagedRuntime(context);
  if (!observation.ready) {
    return {
      state: 'candidate-unavailable',
      target: null,
      detail: observation.detail,
    };
  }

  if (harness === 'codex') {
    const target = codexTarget(context);
    const stat = await context.fs.stat(target);
    if (stat === null) return { state: 'not-configured', target, detail: 'Codex config is absent' };
    if (stat.kind !== 'file')
      return { state: 'degraded', target, detail: 'Codex config is not a regular file' };
    const text = DECODER.decode(await context.fs.readFile(target));
    const hasBegin = text.includes(GITNEXUS_CODEX_MARKER_BEGIN);
    const hasEnd = text.includes(GITNEXUS_CODEX_MARKER_END);
    if (hasBegin || hasEnd) {
      if (hasBegin && hasEnd && text.includes(codexExpectedBlock())) {
        return {
          state: 'verified',
          target,
          detail: `GitNexus ${observation.version ?? ''} is registered through the Token Harness-owned Codex MCP block; verification did not start the MCP server`,
        };
      }
      return {
        state: 'degraded',
        target,
        detail: 'The Token Harness GitNexus Codex marker block differs from the reviewed content',
      };
    }
    if (/^\s*\[mcp_servers\.gitnexus\]\s*$/m.test(text)) {
      return {
        state: 'degraded',
        target,
        detail: 'A user-owned mcp_servers.gitnexus table is present in Codex config',
      };
    }
    return { state: 'not-configured', target, detail: 'GitNexus Codex MCP block is absent' };
  }

  const target = claudeTarget(context);
  const stat = await context.fs.stat(target);
  if (stat === null)
    return { state: 'not-configured', target, detail: 'Claude user config is absent' };
  if (stat.kind !== 'file') {
    return { state: 'degraded', target, detail: 'Claude user config is not a regular file' };
  }

  const parsed = parseJsonDocumentText(DECODER.decode(await context.fs.readFile(target)));
  if (parsed.state !== 'parsed') {
    return {
      state: 'degraded',
      target,
      detail:
        parsed.state === 'comments'
          ? 'Claude user config contains unsupported JSON comments'
          : `Claude user config is malformed: ${parsed.reason}`,
    };
  }
  const segments = parseJsonPointer(GITNEXUS_CLAUDE_MCP_POINTER);
  if (segments === null)
    return { state: 'degraded', target, detail: 'Internal MCP pointer is invalid' };
  const live = resolveJsonPointer(parsed.document, segments);
  if (!live.found || live.value === undefined) {
    return { state: 'not-configured', target, detail: 'GitNexus MCP entry is absent' };
  }
  if (jsonValueDigest(live.value) !== jsonValueDigest(GITNEXUS_MCP_SERVER)) {
    return {
      state: 'degraded',
      target,
      detail: 'GitNexus MCP entry differs from the reviewed command',
    };
  }
  return {
    state: 'verified',
    target,
    detail: `GitNexus ${observation.version ?? ''} is registered through the Token Harness-owned Claude MCP entry; verification did not start the MCP server`,
  };
}
