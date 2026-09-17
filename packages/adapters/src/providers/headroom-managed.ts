import {
  diagnostic,
  digestText,
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
import {
  HEADROOM_REVIEWED_BENCHMARK_VERSION,
  observeHeadroomCandidate,
} from './headroom-candidate.js';

export const HEADROOM_REVIEWED_MCP_VERSION = HEADROOM_REVIEWED_BENCHMARK_VERSION;
export const HEADROOM_CLAUDE_MCP_POINTER = 'mcpServers.headroom';
export const HEADROOM_MCP_SERVER: JsonValue = {
  command: 'headroom',
  args: ['mcp', 'serve'],
};
export const HEADROOM_CODEX_MARKER_BEGIN = 'TOKEN-HARNESS:HEADROOM-MCP:BEGIN';
export const HEADROOM_CODEX_MARKER_END = 'TOKEN-HARNESS:HEADROOM-MCP:END';
export const HEADROOM_CODEX_MCP_BODY = `[mcp_servers.headroom]\ncommand = "headroom"\nargs = ["mcp", "serve"]`;

export interface HeadroomManagedMcpPlan {
  harness: HarnessId;
  target: string | null;
  actions: PlannedAction[];
  diagnostics: Diagnostic[];
}

export type HeadroomManagedMcpVerificationState =
  | 'verified'
  | 'not-configured'
  | 'candidate-unavailable'
  | 'degraded';

export interface HeadroomManagedMcpVerification {
  state: HeadroomManagedMcpVerificationState;
  target: string | null;
  detail: string;
}

const DECODER = new TextDecoder();

function directoryAction(harness: HarnessId, path: string): PlannedAction {
  return {
    kind: 'create-directory',
    id: `headroom:${harness}:directory`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: ['The Headroom integration directory is still absent'],
    postconditions: ['The Headroom integration directory exists'],
    rollbackData: 'file-snapshot',
    explanation: 'Create the directory that contains the Token Harness-owned Headroom integration',
    path,
  };
}

async function reviewedMcpCliAvailable(
  context: ProviderContext,
): Promise<{ ok: boolean; detail: string }> {
  const observation = await observeHeadroomCandidate(context);
  if (observation.version !== HEADROOM_REVIEWED_MCP_VERSION) {
    return {
      ok: false,
      detail:
        observation.version === null
          ? `Headroom ${HEADROOM_REVIEWED_MCP_VERSION} is not installed`
          : `Headroom ${observation.version} is installed; managed MCP activation is reviewed only for ${HEADROOM_REVIEWED_MCP_VERSION}`,
    };
  }

  const help = await context.runner.run({
    executable: 'headroom',
    args: ['mcp', 'serve', '--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (help.failure !== null || help.exitCode !== 0) {
    return {
      ok: false,
      detail: `Headroom ${HEADROOM_REVIEWED_MCP_VERSION} is installed but its reviewed MCP server command is unavailable`,
    };
  }
  return {
    ok: true,
    detail: `Headroom ${HEADROOM_REVIEWED_MCP_VERSION} exposes the reviewed local MCP server`,
  };
}

function prerequisite(harness: HarnessId, detail: string): HeadroomManagedMcpPlan {
  return {
    harness,
    target: null,
    actions: [],
    diagnostics: [
      diagnostic({
        severity: 'warning',
        code: 'headroom-managed-mcp-prerequisite',
        subject: harness,
        message: detail,
        remediation: `Install the exact reviewed Headroom ${HEADROOM_REVIEWED_MCP_VERSION} MCP package with your existing Python/uv tooling, then refresh Token Harness. Token Harness will not install Python, uv, or system prerequisites implicitly.`,
      }),
    ],
  };
}

async function planClaude(
  context: ProviderContext,
  harness: HarnessId,
): Promise<HeadroomManagedMcpPlan> {
  const directory = context.fs.join(context.paths.home, '.claude');
  const target = context.fs.join(directory, 'mcp.json');
  if (!context.fs.isInside(target, context.paths.home)) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'headroom-claude-mcp-target-outside-home',
          subject: harness,
          message: 'The resolved Claude MCP configuration is outside the user home directory',
          path: target,
          remediation: 'Inspect the resolved home directory before enabling Headroom MCP',
        }),
      ],
    };
  }

  const actions: PlannedAction[] = [];
  const dirStat = await context.fs.stat(directory);
  if (dirStat !== null && dirStat.kind !== 'directory') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'headroom-claude-directory-conflict',
          subject: harness,
          message: 'Claude configuration directory is occupied by a non-directory path',
          path: directory,
          remediation: 'Resolve the path conflict manually before enabling Headroom MCP',
        }),
      ],
    };
  }
  if (dirStat === null) actions.push(directoryAction(harness, directory));

  const stat = await context.fs.stat(target);
  if (stat !== null && stat.kind !== 'file') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'headroom-claude-mcp-path-conflict',
          subject: harness,
          message: 'Claude MCP configuration is not a regular file',
          path: target,
          remediation: 'Resolve the path conflict manually before enabling Headroom MCP',
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
                ? 'headroom-claude-json-comments'
                : 'headroom-claude-json-malformed',
            subject: harness,
            message:
              parsed.state === 'comments'
                ? 'Claude MCP configuration contains comments that cannot be preserved by the reviewed JSON merge path'
                : `Claude MCP configuration is malformed JSON: ${parsed.reason}`,
            path: target,
            remediation: 'Keep the file user-owned or repair it before enabling Headroom MCP',
          }),
        ],
      };
    }
    const segments = parseJsonPointer(HEADROOM_CLAUDE_MCP_POINTER);
    const live =
      segments === null
        ? { found: false, value: undefined }
        : resolveJsonPointer(parsed.document, segments);
    if (live.found && live.value !== undefined) {
      if (jsonValueDigest(live.value) === jsonValueDigest(HEADROOM_MCP_SERVER)) {
        return {
          harness,
          target,
          actions: [],
          diagnostics: [
            diagnostic({
              severity: 'info',
              code: 'headroom-claude-mcp-already-present',
              subject: harness,
              message: 'The reviewed Headroom MCP entry is already present and remains user-owned',
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
            code: 'headroom-claude-mcp-user-owned',
            subject: harness,
            message: 'A different Headroom MCP entry already exists and will not be overwritten',
            path: target,
            remediation: 'Review the existing mcpServers.headroom entry manually',
          }),
        ],
      };
    }
  }

  actions.push({
    kind: 'merge-json',
    id: 'headroom:claude:mcp-server',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['mcpServers.headroom is still absent'],
    postconditions: ['mcpServers.headroom matches the reviewed local Headroom MCP command'],
    rollbackData: 'file-snapshot',
    explanation: 'Register the installed reviewed Headroom CLI as a Claude Code MCP server',
    path: target,
    ownedPointers: [HEADROOM_CLAUDE_MCP_POINTER],
    operations: [
      {
        kind: 'set',
        pointer: HEADROOM_CLAUDE_MCP_POINTER,
        value: HEADROOM_MCP_SERVER,
        expectedValueDigest: null,
      },
    ],
    createIfMissing: true,
  });
  return { harness, target, actions, diagnostics: [] };
}

async function planCodex(
  context: ProviderContext,
  harness: HarnessId,
): Promise<HeadroomManagedMcpPlan> {
  const directory = context.fs.join(context.paths.home, '.codex');
  const target = context.fs.join(directory, 'config.toml');
  if (!context.fs.isInside(target, context.paths.home)) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'headroom-codex-mcp-target-outside-home',
          subject: harness,
          message: 'The resolved Codex configuration is outside the user home directory',
          path: target,
          remediation: 'Inspect the resolved home directory before enabling Headroom MCP',
        }),
      ],
    };
  }

  const actions: PlannedAction[] = [];
  const dirStat = await context.fs.stat(directory);
  if (dirStat !== null && dirStat.kind !== 'directory') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'headroom-codex-directory-conflict',
          subject: harness,
          message: 'Codex configuration directory is occupied by a non-directory path',
          path: directory,
          remediation: 'Resolve the path conflict manually before enabling Headroom MCP',
        }),
      ],
    };
  }
  if (dirStat === null) actions.push(directoryAction(harness, directory));

  const stat = await context.fs.stat(target);
  if (stat !== null && stat.kind !== 'file') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'headroom-codex-config-path-conflict',
          subject: harness,
          message: 'Codex configuration is not a regular file',
          path: target,
          remediation: 'Resolve the path conflict manually before enabling Headroom MCP',
        }),
      ],
    };
  }

  if (stat !== null) {
    const text = DECODER.decode(await context.fs.readFile(target));
    const expected = [
      `# ${HEADROOM_CODEX_MARKER_BEGIN}`,
      HEADROOM_CODEX_MCP_BODY,
      `# ${HEADROOM_CODEX_MARKER_END}`,
    ].join('\n');
    const hasBegin = text.includes(HEADROOM_CODEX_MARKER_BEGIN);
    const hasEnd = text.includes(HEADROOM_CODEX_MARKER_END);
    if (hasBegin || hasEnd) {
      if (hasBegin && hasEnd && text.includes(expected)) {
        return {
          harness,
          target,
          actions: [],
          diagnostics: [
            diagnostic({
              severity: 'info',
              code: 'headroom-codex-mcp-already-present',
              subject: harness,
              message: 'The reviewed Headroom Codex MCP block is already present',
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
            code: 'headroom-codex-mcp-marker-drift',
            subject: harness,
            message:
              'An existing Token Harness Headroom marker block differs from the reviewed content',
            path: target,
            remediation: 'Review the existing block before changing it',
          }),
        ],
      };
    }
    if (/^\s*\[mcp_servers\.headroom\]\s*$/m.test(text)) {
      return {
        harness,
        target,
        actions: [],
        diagnostics: [
          diagnostic({
            severity: 'warning',
            code: 'headroom-codex-mcp-user-owned',
            subject: harness,
            message:
              'A user-owned mcp_servers.headroom table already exists and will not be overwritten',
            path: target,
            remediation: 'Review the existing Headroom MCP configuration manually',
          }),
        ],
      };
    }
  }

  actions.push({
    kind: 'patch-marker-block',
    id: 'headroom:codex:mcp-server',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['No Headroom MCP table or Token Harness Headroom marker block exists'],
    postconditions: ['Codex config contains exactly one reviewed Headroom MCP server block'],
    rollbackData: 'file-snapshot',
    explanation: 'Register the installed reviewed Headroom CLI as a Codex MCP server',
    path: target,
    markerBegin: HEADROOM_CODEX_MARKER_BEGIN,
    markerEnd: HEADROOM_CODEX_MARKER_END,
    commentPrefix: '#',
    commentSuffix: '',
    body: HEADROOM_CODEX_MCP_BODY,
    expectedBodyDigest: null,
    createIfMissing: true,
  });
  return { harness, target, actions, diagnostics: [] };
}

export async function planHeadroomManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<HeadroomManagedMcpPlan> {
  if (harness !== 'claude' && harness !== 'codex') {
    return {
      harness,
      target: null,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'headroom-managed-mcp-harness-unsupported',
          subject: harness,
          message: 'Managed Headroom MCP is currently reviewed only for Claude Code and Codex',
          remediation: null,
        }),
      ],
    };
  }

  const cli = await reviewedMcpCliAvailable(context);
  if (!cli.ok) return prerequisite(harness, cli.detail);
  return harness === 'claude' ? planClaude(context, harness) : planCodex(context, harness);
}

export function headroomOwnedArtifact(
  context: ProviderContext,
  harness: HarnessId,
): OwnedArtifact | null {
  if (harness === 'claude') {
    return {
      kind: 'owned-json-entry',
      path: context.fs.join(context.paths.home, '.claude', 'mcp.json'),
      pointer: HEADROOM_CLAUDE_MCP_POINTER,
      placement: 'value',
      valueDigest: jsonValueDigest(HEADROOM_MCP_SERVER),
    };
  }
  if (harness === 'codex') {
    return {
      kind: 'owned-marker-block',
      path: context.fs.join(context.paths.home, '.codex', 'config.toml'),
      markerBegin: HEADROOM_CODEX_MARKER_BEGIN,
      markerEnd: HEADROOM_CODEX_MARKER_END,
      bodyDigest: digestText(HEADROOM_CODEX_MCP_BODY),
    };
  }
  return null;
}

export async function verifyHeadroomManagedMcpActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<HeadroomManagedMcpVerification> {
  const cli = await reviewedMcpCliAvailable(context);
  if (!cli.ok) return { state: 'candidate-unavailable', target: null, detail: cli.detail };

  if (harness === 'claude') {
    const target = context.fs.join(context.paths.home, '.claude', 'mcp.json');
    const stat = await context.fs.stat(target);
    if (stat === null)
      return { state: 'not-configured', target, detail: 'Claude MCP config is absent' };
    if (stat.kind !== 'file')
      return { state: 'degraded', target, detail: 'Claude MCP config is not a regular file' };
    const parsed = parseJsonDocumentText(DECODER.decode(await context.fs.readFile(target)));
    if (parsed.state !== 'parsed')
      return { state: 'degraded', target, detail: 'Claude MCP config is not clean JSON' };
    const segments = parseJsonPointer(HEADROOM_CLAUDE_MCP_POINTER);
    if (segments === null)
      return { state: 'degraded', target, detail: 'Internal Headroom MCP pointer is invalid' };
    const live = resolveJsonPointer(parsed.document, segments);
    if (!live.found || live.value === undefined)
      return { state: 'not-configured', target, detail: 'Headroom MCP entry is absent' };
    if (jsonValueDigest(live.value) !== jsonValueDigest(HEADROOM_MCP_SERVER)) {
      return {
        state: 'degraded',
        target,
        detail: 'Headroom MCP entry differs from the reviewed command',
      };
    }
    return {
      state: 'verified',
      target,
      detail: `${cli.detail}; Claude registration matches the reviewed entry`,
    };
  }

  if (harness === 'codex') {
    const target = context.fs.join(context.paths.home, '.codex', 'config.toml');
    const stat = await context.fs.stat(target);
    if (stat === null) return { state: 'not-configured', target, detail: 'Codex config is absent' };
    if (stat.kind !== 'file')
      return { state: 'degraded', target, detail: 'Codex config is not a regular file' };
    const text = DECODER.decode(await context.fs.readFile(target));
    const expected = [
      `# ${HEADROOM_CODEX_MARKER_BEGIN}`,
      HEADROOM_CODEX_MCP_BODY,
      `# ${HEADROOM_CODEX_MARKER_END}`,
    ].join('\n');
    if (!text.includes(expected))
      return {
        state: 'not-configured',
        target,
        detail: 'Reviewed Headroom Codex MCP block is absent',
      };
    return {
      state: 'verified',
      target,
      detail: `${cli.detail}; Codex registration matches the reviewed owned block`,
    };
  }

  return {
    state: 'degraded',
    target: null,
    detail: `Managed Headroom MCP verification is not reviewed for ${harness}`,
  };
}
