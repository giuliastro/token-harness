import {
  FileJournalStore,
  diagnostic,
  digestBytes,
  type Diagnostic,
  type FileStat,
  type FileSystemPort,
  type HarnessId,
  type PlannedAction,
} from '@token-harness/core';

/** Generated from skills/token-harness/SKILL.md; integration tests keep it byte-identical. */
export const TOKEN_HARNESS_AGENT_SKILL =
  "---\nname: token-harness\ndescription: Optimizes local Claude Code or Codex work against observed subscription allowance, context pressure, quality floors, and project-local benchmark evidence using the Token Harness CLI. Use when the user asks to conserve or maximize coding-agent allowance, choose reasoning/model/verbosity deliberately, check whether a task fits current quota, or explicitly asks to use Token Harness.\n---\n\n# Token Harness\n\nUse Token Harness as a local deterministic policy engine. Do not reproduce its quota math or invent provider conversions yourself.\n\n## Default workflow\n\n1. Confirm `token-harness --version` works. If it is missing, do not install it silently. If the user asked to install or set up Token Harness, follow that request; otherwise explain that the local CLI is required.\n2. Identify the harness you are currently running as: `claude` for Claude Code or `codex` for Codex. Do not guess from repository files.\n3. Classify the current task conservatively:\n   - `mechanical`: formatting, rename, lookup, simple edits, deterministic scaffolding.\n   - `standard`: ordinary implementation, tests, focused bug fixes.\n   - `hard`: multi-file reasoning, ambiguous failures, migrations, difficult reviews.\n   - `critical`: architecture, security-sensitive work, releases, or high-regression-risk changes.\n   If uncertain between two classes, use the higher class.\n4. For a substantial task, or whenever the user asks about allowance/efficiency, run:\n\n   `token-harness optimize --harness <claude|codex> --task <class> --profile balanced --json`\n\n5. Treat the JSON result as evidence, not as permission to mutate configuration. Prefer recommendations that reduce avoidable context or session overhead before lowering a quality floor.\n6. Continue with the user's task. Mention Token Harness only when it materially changes the plan, recommends a user-visible action, or lacks enough evidence.\n\nDo not run Token Harness before every trivial tool call. One observation at a meaningful task boundary is normally enough; re-observe when the task class changes materially, after a quota reset, after a substantial session/context change, or when the user asks.\n\n## Explicit workload\n\nOnly pass `--tasks-left N` when the remaining accepted-task count is explicit from the user or an explicit task list already in the conversation. Never infer it from token history, source files, GitHub issues, or a guessed backlog. When it is explicit, add it to the same advisory call:\n\n`token-harness optimize --harness <claude|codex> --task <class> --profile balanced --tasks-left <N> --json`\n\nFor multiple independent new tasks whose explicit list can be classified by task class, Token Harness can compare Claude and Codex with:\n\n`token-harness schedule --current <current> --candidate <other> --workload mechanical=N,standard=N,hard=N,critical=N --json`\n\nOmit zero-count classes. This is for queued new work, not an in-progress handoff. Never switch harnesses automatically from this result.\n\n## Persistent native changes\n\n`optimize` is advisory. If it recommends a persistent model/reasoning/verbosity change and the user wants it applied:\n\n1. Build a reviewed plan with `token-harness plan --harness <claude|codex> --native-policy --task <class> --profile balanced --json`.\n2. Summarize the exact proposed change, scope, and any limitations to the user.\n3. Apply only after the user explicitly approves the proposed mutation. Use the returned plan id with `token-harness apply --plan <id> --yes`.\n4. Do not treat a persisted preference as a live change to an already-running session. Follow the plan/result instructions about when it takes effect.\n\nNever silently change authentication, billing, provider, model routing, hooks, trust, or purchase/redeem credits.\n\n## Evidence rules\n\n- Never equate local token counts with subscription quota.\n- Never compare raw Claude and Codex percentages as if they were the same currency.\n- Unknown allowance or benchmark evidence stays unknown.\n- Preserve task quality floors; do not lower effort merely because a cheaper setting exists.\n- Prefer project-local measured outcomes and backend quota deltas when Token Harness exposes them.\n- Do not add an MCP server or background model just to use this skill. The local CLI is the tool surface.\n";

const ENCODER = new TextEncoder();
const SKILL_DIGEST = digestBytes(ENCODER.encode(TOKEN_HARNESS_AGENT_SKILL));
const TARGETS: Readonly<Record<string, readonly string[]>> = {
  claude: ['.claude', 'skills', 'token-harness'],
  codex: ['.agents', 'skills', 'token-harness'],
};

export interface AgentSkillInstallPlan {
  target: string | null;
  actions: PlannedAction[];
  diagnostics: Diagnostic[];
}

export type AgentSkillObservationState =
  | 'managed'
  | 'external'
  | 'absent'
  | 'conflict'
  | 'unavailable';

export interface AgentSkillObservation {
  state: AgentSkillObservationState;
  target: string | null;
  detail: string;
}

function targetFor(
  fsPort: FileSystemPort,
  home: string,
  harness: 'claude' | 'codex',
): { directory: string; target: string } {
  let cursor = home;
  for (const segment of TARGETS[harness] ?? []) cursor = fsPort.join(cursor, segment);
  return { directory: cursor, target: fsPort.join(cursor, 'SKILL.md') };
}

export async function observeAgentSkill(input: {
  fs: FileSystemPort;
  home: string | null;
  stateRoot: string | null;
  harness: 'claude' | 'codex';
}): Promise<AgentSkillObservation> {
  if (input.home === null) {
    return {
      state: 'unavailable',
      target: null,
      detail:
        'The user home directory is unavailable, so the Agent Skill location cannot be checked.',
    };
  }
  const resolved = targetFor(input.fs, input.home, input.harness);
  if (!input.fs.isInside(resolved.target, input.home)) {
    return {
      state: 'unavailable',
      target: resolved.target,
      detail: 'The resolved Agent Skill location is outside the user home directory.',
    };
  }
  const directoryStat = await input.fs.stat(resolved.directory);
  if (directoryStat === null) {
    return {
      state: 'absent',
      target: resolved.target,
      detail: 'In-session guidance is not installed for this agent.',
    };
  }
  if (directoryStat.kind !== 'directory') {
    return {
      state: 'conflict',
      target: resolved.target,
      detail: 'A user-owned path occupies the Token Harness Agent Skill location.',
    };
  }
  const targetStat = await input.fs.stat(resolved.target);
  if (targetStat?.kind !== 'file') {
    return {
      state: 'conflict',
      target: resolved.target,
      detail:
        'A token-harness skill directory exists without the expected SKILL.md file. It is kept user-owned.',
    };
  }
  const liveDigest = digestBytes(await input.fs.readFile(resolved.target));

  let latestRelevant: Awaited<ReturnType<FileJournalStore['list']>>[number] | null = null;
  if (input.stateRoot !== null) {
    const journalRoot = input.fs.join(input.stateRoot, 'journals');
    if ((await input.fs.stat(journalRoot))?.kind === 'directory') {
      const journals = new FileJournalStore({
        fs: input.fs,
        journalRoot,
        backupRoot: input.fs.join(input.stateRoot, 'backups'),
      });
      for (const journal of await journals.list()) {
        const relevant = journal.entries.some(
          (entry) =>
            entry.snapshots.some((snapshot) => snapshot.path === resolved.target) ||
            entry.ownership.some((artifact) => artifact.path === resolved.target),
        );
        if (!relevant) continue;
        // The newest relevant transaction is authoritative even when it was rolled back.
        // Falling through to an older commit could resurrect a stale ownership claim.
        latestRelevant = journal;
        break;
      }
    }
  }

  if (latestRelevant?.outcome === 'dirty' || latestRelevant?.outcome === 'in-progress') {
    return {
      state: 'unavailable',
      target: resolved.target,
      detail: 'A relevant Token Harness transaction is incomplete, so ownership is not claimed.',
    };
  }
  const owned =
    latestRelevant?.outcome === 'committed' &&
    latestRelevant.ownership.some(
      (artifact) =>
        artifact.kind === 'owned-file' &&
        artifact.path === resolved.target &&
        artifact.digest === SKILL_DIGEST,
    );
  if (liveDigest !== SKILL_DIGEST) {
    return {
      state: 'conflict',
      target: resolved.target,
      detail: owned
        ? 'The Token Harness-managed Agent Skill was modified after installation. It will not be overwritten automatically.'
        : 'A custom token-harness Agent Skill exists here. It remains user-owned and is not overwritten.',
    };
  }
  if (owned) {
    return {
      state: 'managed',
      target: resolved.target,
      detail:
        'Enabled and managed by Token Harness. The installed file matches the bundled Agent Skill.',
    };
  }
  return {
    state: 'external',
    target: resolved.target,
    detail:
      'A matching Token Harness Agent Skill is enabled but was not installed by the current Token Harness ownership journal.',
  };
}

function createDirectoryAction(harness: HarnessId, path: string, index: number): PlannedAction {
  return {
    kind: 'create-directory',
    id: `agent-skill:${harness}:directory:${String(index)}`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: ['The directory is still absent'],
    postconditions: ['The Agent Skills directory exists'],
    rollbackData: 'file-snapshot',
    explanation: 'Create the Token Harness-owned Agent Skill directory',
    path,
  };
}

export async function planAgentSkillInstall(input: {
  fs: FileSystemPort;
  home: string | null;
  harness: HarnessId;
  version: string | null;
}): Promise<AgentSkillInstallPlan> {
  const diagnostics: Diagnostic[] = [];
  const segments = TARGETS[input.harness];
  if (segments === undefined) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'agent-skill-harness-unsupported',
        subject: input.harness,
        message:
          'In-session Token Harness guidance is currently packaged only for Claude Code and Codex',
        remediation: null,
      }),
    );
    return { target: null, actions: [], diagnostics };
  }
  if (input.home === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'agent-skill-home-unavailable',
        subject: input.harness,
        message:
          'The user home directory is unavailable, so the Agent Skill target cannot be resolved safely',
        remediation: 'Start Token Harness from a normal signed-in user environment',
      }),
    );
    return { target: null, actions: [], diagnostics };
  }
  if (input.version === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'agent-skill-version-unavailable',
        subject: input.harness,
        message:
          'The installed agent version could not be recorded, so a persistent skill change is not proposed',
        remediation: 'Fix the agent installation or PATH, then refresh Token Harness',
      }),
    );
    return { target: null, actions: [], diagnostics };
  }

  const directories: string[] = [];
  let cursor = input.home;
  for (const segment of segments) {
    cursor = input.fs.join(cursor, segment);
    directories.push(cursor);
  }
  const skillDirectory = directories.at(-1)!;
  const target = input.fs.join(skillDirectory, 'SKILL.md');
  if (!input.fs.isInside(target, input.home)) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'agent-skill-target-outside-home',
        subject: input.harness,
        message: 'The resolved Agent Skill target is outside the user home directory',
        path: target,
        remediation: 'Do not apply this plan; inspect the resolved home directory',
      }),
    );
    return { target, actions: [], diagnostics };
  }

  const stats = new Map<string, FileStat | null>();
  for (const directory of directories) {
    const stat = await input.fs.stat(directory);
    stats.set(directory, stat);
    if (stat !== null && stat.kind !== 'directory') {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'agent-skill-path-conflict',
          subject: input.harness,
          message: 'A non-directory path already occupies part of the Agent Skills location',
          path: directory,
          remediation:
            'Keep the existing path user-owned and resolve it manually before enabling guidance',
        }),
      );
      return { target, actions: [], diagnostics };
    }
  }

  if (stats.get(skillDirectory) !== null) {
    const targetStat = await input.fs.stat(target);
    if (targetStat?.kind === 'file') {
      const liveDigest = digestBytes(await input.fs.readFile(target));
      if (liveDigest === SKILL_DIGEST) {
        diagnostics.push(
          diagnostic({
            severity: 'info',
            code: 'agent-skill-already-present',
            subject: input.harness,
            message: 'The Token Harness Agent Skill is already present with the expected content',
            path: target,
            remediation: null,
          }),
        );
        return { target, actions: [], diagnostics };
      }
    }
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'agent-skill-target-owned-by-user',
        subject: input.harness,
        message: 'A token-harness skill directory already exists and is not adopted or overwritten',
        path: skillDirectory,
        remediation:
          'Review that existing skill manually; Token Harness will not claim ownership of it',
      }),
    );
    return { target, actions: [], diagnostics };
  }

  const actions: PlannedAction[] = [];
  directories.forEach((directory, index) => {
    if (stats.get(directory) === null)
      actions.push(createDirectoryAction(input.harness, directory, index));
  });
  actions.push({
    kind: 'write-owned-file',
    id: `agent-skill:${input.harness}:write`,
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target],
    affectedProcesses: [],
    preconditions: ['The Token Harness Agent Skill file is still absent'],
    postconditions: ['SKILL.md matches the reviewed Token Harness Agent Skill'],
    rollbackData: 'file-snapshot',
    explanation: 'Install the reviewed Token Harness Agent Skill for in-session guidance',
    path: target,
    content: TOKEN_HARNESS_AGENT_SKILL,
    mode: '0644',
    expectedDigest: null,
  });
  return { target, actions, diagnostics };
}
