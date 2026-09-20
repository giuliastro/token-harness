import {
  compareVersions,
  diagnostic,
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
 * not invoke it. This slice owns one exact Claude Code user-scoped JSON entry and relies on the
 * generic `merge-json` transaction action for snapshots, drift refusal and ownership receipts.
 * Codex is deliberately excluded until its native TOML transaction can emit removable ownership
 * for one `mcp_servers` entry; whole-file rollback alone is not enough for surgical uninstall.
 */
export const GITNEXUS_REVIEWED_MCP_VERSION = '1.6.12';
export const GITNEXUS_CLAUDE_MCP_POINTER = 'mcpServers.gitnexus';
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
      ? `GitNexus ${version} exposes the MCP command required by the managed Claude integration`
      : `GitNexus ${version} does not advertise the MCP command required by the managed Claude integration`,
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


export async function planGitNexusManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<GitNexusManagedMcpPlan> {
  if (harness !== 'claude') {
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
            'Managed GitNexus MCP registration is currently reviewed only for Claude Code user configuration',
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
  const harness = 'claude' as HarnessId;
  const target = claudeTarget(context);
  if (
    ownership.kind !== 'owned-json-entry' ||
    ownership.path !== target ||
    ownership.pointer !== GITNEXUS_CLAUDE_MCP_POINTER ||
    ownership.placement !== 'value' ||
    ownership.valueDigest !== jsonValueDigest(GITNEXUS_MCP_SERVER)
  ) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'gitnexus-mcp-ownership-mismatch',
          subject: harness,
          message:
            'The supplied ownership receipt does not identify the reviewed GitNexus MCP entry',
          path: target,
          remediation:
            'Use the ownership receipt from the committed GitNexus MCP activation transaction',
        }),
      ],
    };
  }

  const action: PlannedAction = {
    kind: 'remove-owned-change',
    id: 'gitnexus:claude:mcp-server:remove',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['The owned GitNexus MCP entry still matches its transaction receipt'],
    postconditions: ['Only the Token Harness-owned mcpServers.gitnexus entry is removed'],
    rollbackData: 'file-snapshot',
    explanation: 'Remove the exact GitNexus MCP entry owned by Token Harness',
    path: target,
    reverses: 'gitnexus:claude:mcp-server',
    target: ownership,
  };
  return { harness, target, actions: [action], diagnostics: [] };
}

export async function verifyGitNexusManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<GitNexusManagedMcpVerification> {
  if (harness !== 'claude') {
    return {
      state: 'degraded',
      target: null,
      detail: 'Managed GitNexus MCP verification is currently reviewed only for Claude Code',
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
