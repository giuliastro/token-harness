import {
  diagnostic,
  type Diagnostic,
  type HarnessId,
  type PlannedAction,
} from '@token-harness/core';

import type { ProviderContext } from './contract.js';
import {
  mcptoonVersionAtLeast,
  parseMcptoonManifestCapabilities,
  parseMcptoonVersion,
} from './mcptoon-candidate.js';

/**
 * Reviewed instruction-only activation for mcptoon.
 *
 * mcptoon is a CLI, not an MCP server that should be registered directly in an agent. Upstream's
 * integration contract is correspondingly small: Claude Code consumes a SKILL.md, while Codex
 * consumes AGENTS.md instructions. This slice owns only those instructions. It never runs
 * `mcptoon init`, `mcptoon add`, starts a server, or rewrites ~/.mcptoon/config.json.
 */
export const MCPTOON_REVIEWED_INSTALL_VERSION = '0.7.10';
/** Backwards-compatible alias. Managed admission is exact, not a semver floor. */
export const MCPTOON_MANAGED_MINIMUM_VERSION = MCPTOON_REVIEWED_INSTALL_VERSION;
export const MCPTOON_MARKER_BEGIN = 'TOKEN-HARNESS:MCPTOON:BEGIN';
export const MCPTOON_MARKER_END = 'TOKEN-HARNESS:MCPTOON:END';

export const MCPTOON_AGENT_INSTRUCTIONS = `Use mcptoon as the CLI gateway for MCP tools when a task needs one.

- Discover tool names with \`mcptoon manifest --compact\` before requesting full schemas.
- Call an existing configured tool with \`mcptoon call <server> <tool> '<json-args>' --toon\`.
- Prefer compact/TOON output so MCP schemas and JSON wrappers do not consume avoidable context.
- Treat \`~/.mcptoon/config.json\` and project \`.mcptoon.json\` as user-owned configuration.
- Do not run \`mcptoon init\`, \`mcptoon add\`, or destructive tool calls unless the user explicitly asks to change MCP configuration or perform that operation.
`;

export const MCPTOON_CLAUDE_SKILL = `---
name: mcptoon
description: Use configured MCP tools through the mcptoon CLI with compact discovery and TOON results instead of loading full MCP schemas into agent context.
---

# mcptoon

${MCPTOON_AGENT_INSTRUCTIONS}`;

export interface McptoonManagedActivationPlan {
  harness: HarnessId;
  target: string | null;
  actions: PlannedAction[];
  diagnostics: Diagnostic[];
}

export type McptoonManagedVerificationState =
  | 'verified'
  | 'not-configured'
  | 'candidate-unavailable'
  | 'degraded';

export interface McptoonManagedVerification {
  state: McptoonManagedVerificationState;
  target: string | null;
  detail: string;
}

export interface McptoonManagedRuntime {
  ready: boolean;
  absent: boolean;
  version: string | null;
  executable: string | null;
  detail: string;
}

export async function observeMcptoonManagedRuntime(
  context: ProviderContext,
): Promise<McptoonManagedRuntime> {
  const versionOutcome = await context.runner.run({
    executable: 'mcptoon',
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
      detail: `mcptoon --version failed: ${versionOutcome.failure.reason}`,
    };
  }
  const version = parseMcptoonVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  if (
    versionOutcome.exitCode !== 0 ||
    version === null ||
    !mcptoonVersionAtLeast(version, MCPTOON_MANAGED_MINIMUM_VERSION)
  ) {
    return {
      ready: false,
      absent: false,
      version,
      executable: versionOutcome.executablePath,
      detail:
        version === null
          ? 'mcptoon did not report a semantic version'
          : `mcptoon ${version} predates the managed runtime floor ${MCPTOON_MANAGED_MINIMUM_VERSION}`,
    };
  }

  const help = await context.runner.run({
    executable: 'mcptoon',
    args: ['--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const capabilities =
    help.failure === null && help.exitCode === 0
      ? parseMcptoonManifestCapabilities(`${help.stdout}\n${help.stderr}`)
      : { compact: false, json: false };
  const ready = capabilities.compact && capabilities.json;
  return {
    ready,
    absent: false,
    version,
    executable: versionOutcome.executablePath,
    detail: ready
      ? `mcptoon ${version} exposes the compact/JSON CLI surfaces used by the managed integration`
      : `mcptoon ${version} no longer advertises the compact/JSON CLI surfaces required by the managed integration`,
  };
}

const DECODER = new TextDecoder();

function mcptoonInstallAction(): PlannedAction {
  return {
    kind: 'package-manager-install',
    id: `mcptoon:install:${MCPTOON_REVIEWED_INSTALL_VERSION}`,
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pipx'],
    preconditions: ['pipx remains runnable and the reviewed mcptoon release remains installable'],
    postconditions: [`mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} is installed through pipx`],
    rollbackData: 'package-inventory',
    explanation: `Install reviewed mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} in an isolated pipx environment`,
    packageManager: 'pipx',
    packageName: 'mcptoon',
    version: MCPTOON_REVIEWED_INSTALL_VERSION,
  };
}

function directoryAction(harness: HarnessId, path: string, index: number): PlannedAction {
  return {
    kind: 'create-directory',
    id: `mcptoon:${harness}:directory:${String(index)}`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: ['The directory is still absent'],
    postconditions: ['The mcptoon instruction directory exists'],
    rollbackData: 'file-snapshot',
    explanation: 'Create the directory for Token Harness-owned mcptoon agent instructions',
    path,
  };
}

async function planClaudeActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<McptoonManagedActivationPlan> {
  const diagnostics: Diagnostic[] = [];
  const directories = [
    context.fs.join(context.paths.home, '.claude'),
    context.fs.join(context.paths.home, '.claude', 'skills'),
    context.fs.join(context.paths.home, '.claude', 'skills', 'mcptoon'),
  ];
  const target = context.fs.join(directories[2]!, 'SKILL.md');
  if (!context.fs.isInside(target, context.paths.home)) {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'mcptoon-target-outside-home',
          subject: harness,
          message: 'The resolved mcptoon skill target is outside the user home directory',
          path: target,
          remediation: 'Inspect the resolved home directory before enabling mcptoon guidance',
        }),
      ],
    };
  }

  const actions: PlannedAction[] = [];
  for (const [index, directory] of directories.entries()) {
    const stat = await context.fs.stat(directory);
    if (stat !== null && stat.kind !== 'directory') {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'mcptoon-skill-path-conflict',
          subject: harness,
          message: 'A non-directory path occupies the Claude mcptoon skill location',
          path: directory,
          remediation: 'Keep the existing path user-owned and resolve it manually',
        }),
      );
      return { harness, target, actions: [], diagnostics };
    }
    if (stat === null) actions.push(directoryAction(harness, directory, index));
  }

  const targetStat = await context.fs.stat(target);
  if (targetStat !== null) {
    if (targetStat.kind === 'file') {
      const live = DECODER.decode(await context.fs.readFile(target));
      if (live === MCPTOON_CLAUDE_SKILL) {
        diagnostics.push(
          diagnostic({
            severity: 'info',
            code: 'mcptoon-guidance-already-present',
            subject: harness,
            message: 'The reviewed mcptoon Claude skill is already present',
            path: target,
            remediation: null,
          }),
        );
        return { harness, target, actions: [], diagnostics };
      }
    }
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'mcptoon-guidance-user-owned',
        subject: harness,
        message: 'An existing mcptoon Claude skill is left user-owned and will not be overwritten',
        path: target,
        remediation: 'Review the existing skill manually before replacing it',
      }),
    );
    return { harness, target, actions: [], diagnostics };
  }

  actions.push({
    kind: 'write-owned-file',
    id: `mcptoon:${harness}:skill`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['The mcptoon SKILL.md is still absent'],
    postconditions: ['SKILL.md matches the reviewed mcptoon guidance'],
    rollbackData: 'file-snapshot',
    explanation: 'Install reviewed mcptoon guidance for Claude Code',
    path: target,
    content: MCPTOON_CLAUDE_SKILL,
    mode: null,
    expectedDigest: null,
  });
  return { harness, target, actions, diagnostics };
}

async function planCodexActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<McptoonManagedActivationPlan> {
  const target = context.fs.join(context.projectRoot, 'AGENTS.md');
  const stat = await context.fs.stat(target);
  if (stat !== null && stat.kind !== 'file') {
    return {
      harness,
      target,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'mcptoon-agents-path-conflict',
          subject: harness,
          message: 'AGENTS.md is not a regular file, so mcptoon guidance cannot be patched safely',
          path: target,
          remediation: 'Resolve the path conflict manually before enabling mcptoon guidance',
        }),
      ],
    };
  }

  if (stat !== null) {
    const text = DECODER.decode(await context.fs.readFile(target));
    const hasBegin = text.includes(MCPTOON_MARKER_BEGIN);
    const hasEnd = text.includes(MCPTOON_MARKER_END);
    if (hasBegin || hasEnd) {
      const expected = [
        `<!-- ${MCPTOON_MARKER_BEGIN} -->`,
        MCPTOON_AGENT_INSTRUCTIONS.trimEnd(),
        `<!-- ${MCPTOON_MARKER_END} -->`,
      ].join('\n');
      if (hasBegin && hasEnd && text.includes(expected)) {
        return {
          harness,
          target,
          actions: [],
          diagnostics: [
            diagnostic({
              severity: 'info',
              code: 'mcptoon-guidance-already-present',
              subject: harness,
              message: 'The reviewed mcptoon Codex instruction block is already present',
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
            code: 'mcptoon-guidance-user-owned',
            subject: harness,
            message: 'An existing mcptoon marker block is not rewritten automatically',
            path: target,
            remediation: 'Review the existing block manually before replacing it',
          }),
        ],
      };
    }
  }

  const action: PlannedAction = {
    kind: 'patch-marker-block',
    id: `mcptoon:${harness}:agents`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['The Token Harness mcptoon marker block is still absent'],
    postconditions: ['AGENTS.md contains exactly one reviewed mcptoon instruction block'],
    rollbackData: 'file-snapshot',
    explanation: 'Add reviewed mcptoon guidance to Codex project instructions',
    path: target,
    markerBegin: MCPTOON_MARKER_BEGIN,
    markerEnd: MCPTOON_MARKER_END,
    commentPrefix: '<!--',
    commentSuffix: '-->',
    body: MCPTOON_AGENT_INSTRUCTIONS.trimEnd(),
    expectedBodyDigest: null,
    createIfMissing: true,
  };
  return { harness, target, actions: [action], diagnostics: [] };
}

/**
 * Plan the reviewed mcptoon lifecycle slice without touching MCP configuration.
 *
 * A missing CLI is installed through the generic pipx package transaction first, then the narrow
 * Claude/Codex instruction surface is applied. A runnable but incompatible third-party build stays
 * user-owned rather than being silently replaced.
 */
export async function planMcptoonManagedActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<McptoonManagedActivationPlan> {
  if (harness !== 'claude' && harness !== 'codex') {
    return {
      harness,
      target: null,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'mcptoon-managed-harness-unsupported',
          subject: harness,
          message: 'Managed mcptoon guidance is currently reviewed only for Claude Code and Codex',
          remediation: null,
        }),
      ],
    };
  }

  const observation = await observeMcptoonManagedRuntime(context);
  const activation =
    harness === 'claude'
      ? await planClaudeActivation(context, harness)
      : await planCodexActivation(context, harness);

  if (observation.ready) return activation;

  if (observation.absent) {
    const activationSatisfied = activation.diagnostics.some(
      (entry) => entry.code === 'mcptoon-guidance-already-present',
    );
    if (activation.actions.length === 0 && !activationSatisfied) {
      return activation;
    }

    const pipx = await context.runner.run({
      executable: 'pipx',
      args: ['--version'],
      cwd: context.projectRoot,
      timeoutMs: 20_000,
    });
    if (pipx.failure !== null || pipx.exitCode !== 0) {
      return {
        harness,
        target: activation.target,
        actions: [],
        diagnostics: [
          ...activation.diagnostics,
          diagnostic({
            severity: 'warning',
            code: 'mcptoon-pipx-unavailable',
            subject: harness,
            message: 'mcptoon is absent and the isolated pipx installer is not available',
            remediation:
              'Install pipx, then refresh Token Harness; Token Harness will not bootstrap a Python package manager implicitly',
          }),
        ],
      };
    }
    return {
      ...activation,
      actions: [mcptoonInstallAction(), ...activation.actions],
      diagnostics: [
        ...activation.diagnostics,
        diagnostic({
          severity: 'info',
          code: 'mcptoon-managed-install-planned',
          subject: harness,
          message: `mcptoon is absent; install reviewed ${MCPTOON_REVIEWED_INSTALL_VERSION} through pipx before enabling agent guidance`,
          remediation: null,
        }),
      ],
    };
  }

  return {
    harness,
    target: null,
    actions: [],
    diagnostics: [
      diagnostic({
        severity: 'warning',
        code: 'mcptoon-managed-prerequisite',
        subject: harness,
        message:
          observation.detail,
        remediation:
          `Update mcptoon to ${MCPTOON_MANAGED_MINIMUM_VERSION} or newer with the required compact/JSON CLI surfaces, then refresh Token Harness`,
      }),
    ],
  };
}

export async function verifyMcptoonManagedActivation(
  context: ProviderContext,
  harness: HarnessId,
): Promise<McptoonManagedVerification> {
  const observation = await observeMcptoonManagedRuntime(context);
  if (!observation.ready) {
    return {
      state: 'candidate-unavailable',
      target: null,
      detail: observation.detail,
    };
  }

  let target: string;
  let configured = false;
  if (harness === 'claude') {
    target = context.fs.join(context.paths.home, '.claude', 'skills', 'mcptoon', 'SKILL.md');
    const stat = await context.fs.stat(target);
    configured =
      stat?.kind === 'file' &&
      DECODER.decode(await context.fs.readFile(target)) === MCPTOON_CLAUDE_SKILL;
  } else if (harness === 'codex') {
    target = context.fs.join(context.projectRoot, 'AGENTS.md');
    const stat = await context.fs.stat(target);
    if (stat?.kind === 'file') {
      const text = DECODER.decode(await context.fs.readFile(target));
      configured =
        text.includes(MCPTOON_MARKER_BEGIN) &&
        text.includes(MCPTOON_MARKER_END) &&
        text.includes(MCPTOON_AGENT_INSTRUCTIONS.trimEnd());
    }
  } else {
    return {
      state: 'not-configured',
      target: null,
      detail: `Managed mcptoon verification is not reviewed for ${harness}`,
    };
  }

  if (!configured) {
    return {
      state: 'not-configured',
      target,
      detail: 'The Token Harness mcptoon agent instructions are not present',
    };
  }

  return {
    state: 'verified',
    target,
    detail:
      `Agent instructions are present and mcptoon ${observation.version ?? ''} exposes the required passive CLI capabilities`,
  };
}
