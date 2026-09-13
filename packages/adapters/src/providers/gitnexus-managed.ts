import {
  diagnostic,
  jsonValueDigest,
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
import { observeGitNexusCandidate } from './gitnexus-candidate.js';

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

function prerequisiteDiagnostic(
  harness: HarnessId,
  version: string | null,
  supportsMcp: boolean,
): Diagnostic {
  return diagnostic({
    severity: 'warning',
    code: 'gitnexus-managed-mcp-prerequisite',
    subject: harness,
    message:
      version === null
        ? 'GitNexus is not available on the reviewed managed MCP surface'
        : supportsMcp
          ? `GitNexus ${version} is not the reviewed managed MCP version ${GITNEXUS_REVIEWED_MCP_VERSION}`
          : `GitNexus ${version} does not advertise the reviewed MCP command`,
    remediation: `Keep the current installation user-owned; this build manages MCP registration only for GitNexus ${GITNEXUS_REVIEWED_MCP_VERSION}`,
  });
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

  const observation = await observeGitNexusCandidate(context);
  if (
    observation.state !== 'benchmark-ready' ||
    observation.version !== GITNEXUS_REVIEWED_MCP_VERSION ||
    !observation.supportsMcp
  ) {
    return {
      harness,
      target: null,
      actions: [],
      diagnostics: [prerequisiteDiagnostic(harness, observation.version, observation.supportsMcp)],
    };
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
            remediation: 'Keep this configuration user-owned or repair it before enabling managed GitNexus MCP',
          }),
        ],
      };
    }

    const segments = parseJsonPointer(GITNEXUS_CLAUDE_MCP_POINTER);
    const live = segments === null ? { found: false, value: undefined } : resolveJsonPointer(parsed.document, segments);
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

  return { harness, target, actions: [action], diagnostics: [] };
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
          message: 'The supplied ownership receipt does not identify the reviewed GitNexus MCP entry',
          path: target,
          remediation: 'Use the ownership receipt from the committed GitNexus MCP activation transaction',
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

  const observation = await observeGitNexusCandidate(context);
  if (
    observation.state !== 'benchmark-ready' ||
    observation.version !== GITNEXUS_REVIEWED_MCP_VERSION ||
    !observation.supportsMcp
  ) {
    return {
      state: 'candidate-unavailable',
      target: null,
      detail: observation.reasons.join('; '),
    };
  }

  const target = claudeTarget(context);
  const stat = await context.fs.stat(target);
  if (stat === null) return { state: 'not-configured', target, detail: 'Claude user config is absent' };
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
  if (segments === null) return { state: 'degraded', target, detail: 'Internal MCP pointer is invalid' };
  const live = resolveJsonPointer(parsed.document, segments);
  if (!live.found || live.value === undefined) {
    return { state: 'not-configured', target, detail: 'GitNexus MCP entry is absent' };
  }
  if (jsonValueDigest(live.value) !== jsonValueDigest(GITNEXUS_MCP_SERVER)) {
    return { state: 'degraded', target, detail: 'GitNexus MCP entry differs from the reviewed command' };
  }
  return {
    state: 'verified',
    target,
    detail: `GitNexus ${GITNEXUS_REVIEWED_MCP_VERSION} is registered through the reviewed Claude MCP entry; verification did not start the MCP server`,
  };
}
