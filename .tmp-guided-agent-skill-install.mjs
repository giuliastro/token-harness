import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected exactly one replacement anchor`);
  }
  fs.writeFileSync(path, text.slice(0, first) + after + text.slice(first + before.length));
}

function replaceAllExact(path, before, after, expected) {
  const text = fs.readFileSync(path, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} occurrences, found ${count}`);
  fs.writeFileSync(path, text.split(before).join(after));
}

// Loading cards must use exactly the same card padding as their loaded state.
replaceAllExact(
  'apps/cli/src/guided-assets.ts',
  'class="panel loading-card"',
  'class="panel agent loading-card"',
  2,
);

replaceOnce(
  'apps/cli/src/argv.ts',
  `  /** Phase 18.4: include reviewed native harness policy edits in plan/apply. */\n  nativePolicy: boolean;\n`,
  `  /** Phase 18.4: include reviewed native harness policy edits in plan/apply. */\n  nativePolicy: boolean;\n  /** Guided/internal: install the portable Token Harness Agent Skill for the selected harness. */\n  agentSkill: boolean;\n`,
);
replaceOnce(
  'apps/cli/src/argv.ts',
  `const BOOLEAN_FLAGS = new Set(['--json', '--native-policy', '--verbose', '--yes']);`,
  `const BOOLEAN_FLAGS = new Set([\n  '--json',\n  '--native-policy',\n  '--agent-skill',\n  '--verbose',\n  '--yes',\n]);`,
);
replaceOnce(
  'apps/cli/src/argv.ts',
  `    nativePolicy: false,\n    verbose: false,`,
  `    nativePolicy: false,\n    agentSkill: false,\n    verbose: false,`,
);
replaceOnce(
  'apps/cli/src/argv.ts',
  `      if (name === '--native-policy') options.nativePolicy = true;\n      if (name === '--verbose') options.verbose = true;`,
  `      if (name === '--native-policy') options.nativePolicy = true;\n      if (name === '--agent-skill') options.agentSkill = true;\n      if (name === '--verbose') options.verbose = true;`,
);

replaceOnce(
  'apps/cli/src/commands/context.ts',
  `  /** Phase 18.4: plan reversible native harness policy changes from optimizer advice. */\n  nativePolicy?: boolean;\n`,
  `  /** Phase 18.4: plan reversible native harness policy changes from optimizer advice. */\n  nativePolicy?: boolean;\n  /** Guided/internal Agent Skill installation, still executed through plan/apply. */\n  agentSkill?: boolean;\n`,
);
replaceOnce(
  'apps/cli/src/run.ts',
  `    nativePolicy: invocation.options.nativePolicy,\n    since: invocation.options.since,`,
  `    nativePolicy: invocation.options.nativePolicy,\n    agentSkill: invocation.options.agentSkill,\n    since: invocation.options.since,`,
);

const skill = fs.readFileSync('skills/token-harness/SKILL.md', 'utf8');
fs.writeFileSync(
  'apps/cli/src/agent-skill.ts',
  `import {\n  diagnostic,\n  digestBytes,\n  type Diagnostic,\n  type FileStat,\n  type FileSystemPort,\n  type HarnessId,\n  type PlannedAction,\n} from '@token-harness/core';\n\n/** Generated from skills/token-harness/SKILL.md; integration tests keep it byte-identical. */\nexport const TOKEN_HARNESS_AGENT_SKILL = ${JSON.stringify(skill)};\n\nconst ENCODER = new TextEncoder();\nconst SKILL_DIGEST = digestBytes(ENCODER.encode(TOKEN_HARNESS_AGENT_SKILL));\nconst TARGETS: Readonly<Record<string, readonly string[]>> = {\n  claude: ['.claude', 'skills', 'token-harness'],\n  codex: ['.agents', 'skills', 'token-harness'],\n};\n\nexport interface AgentSkillInstallPlan {\n  target: string | null;\n  actions: PlannedAction[];\n  diagnostics: Diagnostic[];\n}\n\nfunction createDirectoryAction(harness: HarnessId, path: string, index: number): PlannedAction {\n  return {\n    kind: 'create-directory',\n    id: \`agent-skill:\${harness}:directory:\${String(index)}\`,\n    riskClass: 'reversible',\n    requiresNetwork: false,\n    requiresElevation: false,\n    affectedPaths: [path],\n    affectedProcesses: [],\n    preconditions: ['The directory is still absent'],\n    postconditions: ['The Agent Skills directory exists'],\n    rollbackData: 'file-snapshot',\n    explanation: 'Create the Token Harness-owned Agent Skill directory',\n    path,\n  };\n}\n\nexport async function planAgentSkillInstall(input: {\n  fs: FileSystemPort;\n  home: string | null;\n  harness: HarnessId;\n  version: string | null;\n}): Promise<AgentSkillInstallPlan> {\n  const diagnostics: Diagnostic[] = [];\n  const segments = TARGETS[input.harness];\n  if (segments === undefined) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'warning',\n        code: 'agent-skill-harness-unsupported',\n        subject: input.harness,\n        message: 'In-session Token Harness guidance is currently packaged only for Claude Code and Codex',\n        remediation: null,\n      }),\n    );\n    return { target: null, actions: [], diagnostics };\n  }\n  if (input.home === null) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'warning',\n        code: 'agent-skill-home-unavailable',\n        subject: input.harness,\n        message: 'The user home directory is unavailable, so the Agent Skill target cannot be resolved safely',\n        remediation: 'Start Token Harness from a normal signed-in user environment',\n      }),\n    );\n    return { target: null, actions: [], diagnostics };\n  }\n  if (input.version === null) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'warning',\n        code: 'agent-skill-version-unavailable',\n        subject: input.harness,\n        message: 'The installed agent version could not be recorded, so a persistent skill change is not proposed',\n        remediation: 'Fix the agent installation or PATH, then refresh Token Harness',\n      }),\n    );\n    return { target: null, actions: [], diagnostics };\n  }\n\n  const directories: string[] = [];\n  let cursor = input.home;\n  for (const segment of segments) {\n    cursor = input.fs.join(cursor, segment);\n    directories.push(cursor);\n  }\n  const skillDirectory = directories.at(-1)!;\n  const target = input.fs.join(skillDirectory, 'SKILL.md');\n  if (!input.fs.isInside(target, input.home)) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'error',\n        code: 'agent-skill-target-outside-home',\n        subject: input.harness,\n        message: 'The resolved Agent Skill target is outside the user home directory',\n        path: target,\n        remediation: 'Do not apply this plan; inspect the resolved home directory',\n      }),\n    );\n    return { target, actions: [], diagnostics };\n  }\n\n  const stats = new Map<string, FileStat | null>();\n  for (const directory of directories) {\n    const stat = await input.fs.stat(directory);\n    stats.set(directory, stat);\n    if (stat !== null && stat.kind !== 'directory') {\n      diagnostics.push(\n        diagnostic({\n          severity: 'warning',\n          code: 'agent-skill-path-conflict',\n          subject: input.harness,\n          message: 'A non-directory path already occupies part of the Agent Skills location',\n          path: directory,\n          remediation: 'Keep the existing path user-owned and resolve it manually before enabling guidance',\n        }),\n      );\n      return { target, actions: [], diagnostics };\n    }\n  }\n\n  if (stats.get(skillDirectory) !== null) {\n    const targetStat = await input.fs.stat(target);\n    if (targetStat?.kind === 'file') {\n      const liveDigest = digestBytes(await input.fs.readFile(target));\n      if (liveDigest === SKILL_DIGEST) {\n        diagnostics.push(\n          diagnostic({\n            severity: 'info',\n            code: 'agent-skill-already-present',\n            subject: input.harness,\n            message: 'The Token Harness Agent Skill is already present with the expected content',\n            path: target,\n            remediation: null,\n          }),\n        );\n        return { target, actions: [], diagnostics };\n      }\n    }\n    diagnostics.push(\n      diagnostic({\n        severity: 'warning',\n        code: 'agent-skill-target-owned-by-user',\n        subject: input.harness,\n        message: 'A token-harness skill directory already exists and is not adopted or overwritten',\n        path: skillDirectory,\n        remediation: 'Review that existing skill manually; Token Harness will not claim ownership of it',\n      }),\n    );\n    return { target, actions: [], diagnostics };\n  }\n\n  const actions: PlannedAction[] = [];\n  directories.forEach((directory, index) => {\n    if (stats.get(directory) === null) actions.push(createDirectoryAction(input.harness, directory, index));\n  });\n  actions.push({\n    kind: 'write-owned-file',\n    id: \`agent-skill:\${input.harness}:write\`,\n    riskClass: 'reversible',\n    requiresNetwork: false,\n    requiresElevation: false,\n    affectedPaths: [target],\n    affectedProcesses: [],\n    preconditions: ['The Token Harness Agent Skill file is still absent'],\n    postconditions: ['SKILL.md matches the reviewed Token Harness Agent Skill'],\n    rollbackData: 'file-snapshot',\n    explanation: 'Install the reviewed Token Harness Agent Skill for in-session guidance',\n    path: target,\n    content: TOKEN_HARNESS_AGENT_SKILL,\n    mode: '0644',\n    expectedDigest: null,\n  });\n  return { target, actions, diagnostics };\n}\n`,
  'utf8',
);

replaceOnce(
  'apps/cli/src/commands/plan.ts',
  `import { PLANS_DIRECTORY } from './apply.js';`,
  `import { planAgentSkillInstall } from '../agent-skill.js';\nimport { PLANS_DIRECTORY } from './apply.js';`,
);
replaceOnce(
  'apps/cli/src/commands/plan.ts',
  `  if (context.nativePolicy === true && context.harness === harnessId('claude')) {`,
  `  if (context.agentSkill === true) {\n    if (\n      context.harness === null ||\n      (context.harness !== harnessId('claude') && context.harness !== harnessId('codex'))\n    ) {\n      diagnostics.push(\n        diagnostic({\n          severity: 'warning',\n          code: 'agent-skill-harness-required',\n          subject: context.harness,\n          message: 'In-session guidance requires an explicit Claude Code or Codex harness',\n          remediation: 'Use the guided app to choose the installed agent',\n        }),\n      );\n    } else {\n      const detected = present.find((item) => item.id === context.harness);\n      if (detected === undefined || context.adapters === null) {\n        diagnostics.push(\n          diagnostic({\n            severity: 'warning',\n            code: 'agent-skill-harness-unavailable',\n            subject: context.harness,\n            message: 'The selected coding agent is not currently observable on this machine',\n            remediation: 'Install or fix the agent, then refresh the guided app',\n          }),\n        );\n      } else {\n        const skillPlan = await planAgentSkillInstall({\n          fs: context.adapters.fs,\n          home: context.home,\n          harness: context.harness,\n          version: versions.harnesses[context.harness] ?? null,\n        });\n        actions.push(...skillPlan.actions);\n        diagnostics.push(...skillPlan.diagnostics);\n      }\n    }\n  }\n\n  if (context.nativePolicy === true && context.harness === harnessId('claude')) {`,
);

replaceOnce(
  'apps/cli/src/commands/apply.ts',
  `  let stored: StoredPlan | null = null;\n  let planningContext = context;`,
  `  let stored: StoredPlan | null = null;\n  let storedAgentSkill = false;\n  let planningContext = context;`,
);
replaceOnce(
  'apps/cli/src/commands/apply.ts',
  `      planningContext = { ...context, harness: stored.harness, provider };`,
  `      storedAgentSkill = stored.actions.some((action) => action.id.startsWith('agent-skill:'));\n      planningContext = {\n        ...context,\n        harness: stored.harness,\n        provider,\n        agentSkill: storedAgentSkill,\n      };`,
);
replaceOnce(
  'apps/cli/src/commands/apply.ts',
  `  const computed = await computePlan(planningContext);\n  diagnostics.push(...computed.diagnostics);\n\n  if (computed.blocked.length > 0 && computed.report.actions.length === 0) {`,
  `  const computed = await computePlan(planningContext);\n  diagnostics.push(...computed.diagnostics);\n\n  if (stored !== null && storedAgentSkill && computed.report.planId !== stored.planId) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'error',\n        code: 'agent-skill-plan-drift',\n        subject: stored.harness,\n        message: 'The Agent Skill target changed after the reviewed preview',\n        remediation: 'Review a fresh Enable in-session guidance preview; nothing was written',\n      }),\n    );\n    return finish('rejected', EXIT_CODES['precondition-drift'], rejectedReport(), diagnostics);\n  }\n\n  if (computed.blocked.length > 0 && computed.report.actions.length === 0) {`,
);

replaceOnce(
  'apps/cli/src/guided.ts',
  `  kind: 'setup' | 'effort' | 'verify' | 'help' | 'refresh';`,
  `  kind: 'setup' | 'effort' | 'skill' | 'verify' | 'help' | 'refresh';`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `    {\n      id: \`${'${id}'}-mcp\`,`,
  `    {\n      id: \`${'${id}'}-guidance\`,\n      title: 'In-session Token Harness guidance',\n      state: 'Optional',\n      mode: 'integration',\n      what:\n        id === 'claude'\n          ? 'Installs the portable Token Harness Agent Skill in ~/.claude/skills/token-harness so Claude can consult the local controller when a task needs it.'\n          : 'Installs the portable Token Harness Agent Skill in ~/.agents/skills/token-harness so Codex can consult the local controller when a task needs it.',\n      why: 'The harness can ask Token Harness for quota-aware, quality-gated advice without making advanced CLI flags the human workflow.',\n      evidence:\n        'Installation is local, previewed and transactional. An existing token-harness skill directory is never overwritten or silently adopted.',\n      next: 'Enable this once, then keep coding normally. Ask the agent to use Token Harness for a task when you want an explicit check; the skill also activates on relevant allowance decisions.',\n      action: { kind: 'skill', label: 'Enable in-session guidance', harness: id },\n    },\n    {\n      id: \`${'${id}'}-mcp\`,`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `      !['setup', 'effort', 'undo'].includes(String(data['action'])) ||\n      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||\n      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||\n      (data['action'] === 'effort' && (data['harness'] === undefined || data['task'] === undefined))`,
  `      !['setup', 'effort', 'skill', 'undo'].includes(String(data['action'])) ||\n      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||\n      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||\n      (data['action'] === 'effort' && (data['harness'] === undefined || data['task'] === undefined)) ||\n      (data['action'] === 'skill' && data['harness'] === undefined)`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `        const args = ['plan', '--harness', agent.harnessId];\n        if (data['action'] === 'effort')\n          args.push(`,
  `        const args = ['plan', '--harness', agent.harnessId];\n        if (data['action'] === 'skill') {\n          args.push('--provider', 'none', '--agent-skill');\n        } else if (data['action'] === 'effort')\n          args.push(`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `              data['action'] === 'effort'\n                ? 'No supported preference change is needed or available. Your current preference is kept.'\n                : 'No safe setup change is available. The integration may already be configured, or a required provider is not installed.',`,
  `              data['action'] === 'effort'\n                ? 'No supported preference change is needed or available. Your current preference is kept.'\n                : data['action'] === 'skill'\n                  ? 'In-session guidance is already present, or an existing user-owned skill location was left untouched.'\n                  : 'No safe setup change is available. The integration may already be configured, or a required provider is not installed.',`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `        plans.push(report.planId);\n        changes.push(...report.actions.map((action) => describeChange(action, agent.harnessId)));\n        network ||= report.network.length > 0;`,
  `        plans.push(report.planId);\n        if (data['action'] === 'skill') {\n          changes.push({\n            title: \`${'${name(agent.harnessId)}'}: enable in-session guidance\`,\n            description:\n              'Installs one reviewed Token Harness Agent Skill in the standard user skill directory. It does not change model, login, billing, hooks, trust, or the current conversation.',\n            files: 1,\n          });\n        } else {\n          changes.push(...report.actions.map((action) => describeChange(action, agent.harnessId)));\n        }\n        network ||= report.network.length > 0;`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `          description: data['action'] === 'effort' ? 'Task preference' : 'Integration setup',`,
  `          description:\n            data['action'] === 'effort'\n              ? 'Task preference'\n              : data['action'] === 'skill'\n                ? 'In-session guidance'\n                : 'Integration setup',`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `        restart: data['action'] === 'effort',`,
  `        restart: data['action'] === 'effort' || data['action'] === 'skill',`,
);

replaceAllExact(
  'apps/cli/src/guided-client.ts',
  `['setup','effort','verify']`,
  `['setup','effort','skill','verify']`,
  2,
);
replaceOnce(
  'apps/cli/src/guided-client.ts',
  `  if (action.kind === 'effort') return showTask(action.harness);\n  if (action.kind === 'verify') return verify();`,
  `  if (action.kind === 'effort') return showTask(action.harness);\n  if (action.kind === 'skill') return preview({ action: 'skill', harness: action.harness });\n  if (action.kind === 'verify') return verify();`,
);
replaceOnce(
  'apps/cli/src/guided-client.ts',
  `  rulesButton.addEventListener('click',()=>{selectedRules=agent.id;renderRules({agents:currentAgents,rules:current?.rules || []});selectView('rules',true);}); integration.append(rulesButton); card.append(integration);\n  const reasoning = agent.reasoning;`,
  `  rulesButton.addEventListener('click',()=>{selectedRules=agent.id;renderRules({agents:currentAgents,rules:current?.rules || []});selectView('rules',true);}); integration.append(rulesButton); card.append(integration);\n  const guidanceRule=agent.rules.find(rule=>rule.id===agent.id+'-guidance');\n  if(guidanceRule?.action) {\n    const guidance=node('div',undefined,'agent-line'), guidanceText=node('div');\n    guidanceText.append(node('span','Guidance','key'),node('span','Available on demand'));\n    guidance.append(guidanceText,actionButton(guidanceRule.action,agent.id+'-guidance','text-button'));card.append(guidance);\n  }\n  const reasoning = agent.reasoning;`,
);
replaceOnce(
  'apps/cli/src/guided-client.ts',
  `  document.querySelectorAll('[data-operation="setup"],[data-operation="effort"],[data-operation="verify"]').forEach(button=>{button.disabled=value || working;});`,
  `  document.querySelectorAll('[data-operation="setup"],[data-operation="effort"],[data-operation="skill"],[data-operation="verify"]').forEach(button=>{button.disabled=value || working;});`,
);
replaceOnce(
  'apps/cli/src/guided-client.ts',
  `  showDialog(body.action==='effort' ? 'Preparing a reasoning preview' : body.action==='undo' ? 'Preparing a restore preview' : 'Checking your setup'); lock(true, 'Reading current settings. Nothing is being changed.');`,
  `  showDialog(body.action==='effort' ? 'Preparing a reasoning preview' : body.action==='skill' ? 'Preparing in-session guidance' : body.action==='undo' ? 'Preparing a restore preview' : 'Checking your setup'); lock(true, 'Reading current settings. Nothing is being changed.');`,
);

// Keep the installable bundle payload in lock-step with the portable skill source.
replaceOnce(
  'tests/integration/agent-skill.test.ts',
  `const SKILL_PATH = join(REPO_ROOT, 'skills', 'token-harness', 'SKILL.md');\nconst SKILL = readFileSync(SKILL_PATH, 'utf8');`,
  `const SKILL_PATH = join(REPO_ROOT, 'skills', 'token-harness', 'SKILL.md');\nconst SKILL = readFileSync(SKILL_PATH, 'utf8');\nconst INSTALLABLE_SOURCE = readFileSync(join(REPO_ROOT, 'apps', 'cli', 'src', 'agent-skill.ts'), 'utf8');`,
);
replaceOnce(
  'tests/integration/agent-skill.test.ts',
  `describe('agent-native Token Harness skill', () => {\n`,
  `describe('agent-native Token Harness skill', () => {\n  it('keeps the bundled install payload byte-identical to SKILL.md', () => {\n    const match = /TOKEN_HARNESS_AGENT_SKILL\\s*=\\s*(\"(?:\\\\.|[^\"\\\\])*\")\\s*;/s.exec(\n      INSTALLABLE_SOURCE,\n    );\n    assert.ok(match?.[1], 'installable skill source must expose one JSON string literal');\n    assert.equal(JSON.parse(match[1]), SKILL);\n  });\n\n`,
);

fs.writeFileSync(
  'apps/cli/test/agent-skill-install.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\nimport type { FileStat, FileSystemPort } from '@token-harness/core';\nimport { harnessId } from '@token-harness/core';\n\nimport { planAgentSkillInstall, TOKEN_HARNESS_AGENT_SKILL } from '../src/agent-skill.js';\n\nfunction memoryFs(entries: Record<string, { kind: 'file' | 'directory'; content?: string }>): FileSystemPort {\n  const normalize = (parts: string[]): string => ('/' + parts.join('/')).replace(/\\/{2,}/g, '/');\n  return {\n    join: (...parts) => normalize(parts),\n    dirname: (path) => path.slice(0, Math.max(1, path.lastIndexOf('/'))) || '/',\n    basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,\n    isInside: (candidate, parent) => candidate === parent || candidate.startsWith(parent.replace(/\\/$/, '') + '/'),\n    stat: async (path): Promise<FileStat | null> => {\n      const entry = entries[path];\n      return entry === undefined\n        ? null\n        : { kind: entry.kind, byteLength: entry.content?.length ?? 0, mode: null };\n    },\n    readFile: async (path) => new TextEncoder().encode(entries[path]?.content ?? ''),\n    writeFile: async () => undefined,\n    appendFile: async () => undefined,\n    createDirectory: async () => undefined,\n    remove: async () => undefined,\n    readDirectory: async () => [],\n  };\n}\n\ndescribe('guided Agent Skill installation planning', () => {\n  it('plans a reversible Claude user skill without network or model changes', async () => {\n    const plan = await planAgentSkillInstall({\n      fs: memoryFs({ '/home/dev/.claude': { kind: 'directory' } }),\n      home: '/home/dev',\n      harness: harnessId('claude'),\n      version: '2.1.261',\n    });\n    assert.equal(plan.target, '/home/dev/.claude/skills/token-harness/SKILL.md');\n    assert.equal(plan.actions.at(-1)?.kind, 'write-owned-file');\n    const write = plan.actions.at(-1);\n    assert.ok(write?.kind === 'write-owned-file');\n    assert.equal(write.content, TOKEN_HARNESS_AGENT_SKILL);\n    assert.equal(write.expectedDigest, null);\n    assert.equal(write.requiresNetwork, false);\n    assert.equal(plan.actions.some((action) => action.kind === 'codex-config-batch-write'), false);\n  });\n\n  it('uses the documented Codex user Agent Skills directory', async () => {\n    const plan = await planAgentSkillInstall({\n      fs: memoryFs({ '/home/dev/.agents': { kind: 'directory' }, '/home/dev/.agents/skills': { kind: 'directory' } }),\n      home: '/home/dev',\n      harness: harnessId('codex'),\n      version: '0.146.0',\n    });\n    assert.equal(plan.target, '/home/dev/.agents/skills/token-harness/SKILL.md');\n    assert.equal(plan.actions.at(-1)?.kind, 'write-owned-file');\n  });\n\n  it('does not adopt a byte-identical skill that already exists', async () => {\n    const plan = await planAgentSkillInstall({\n      fs: memoryFs({\n        '/home/dev/.claude': { kind: 'directory' },\n        '/home/dev/.claude/skills': { kind: 'directory' },\n        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },\n        '/home/dev/.claude/skills/token-harness/SKILL.md': { kind: 'file', content: TOKEN_HARNESS_AGENT_SKILL },\n      }),\n      home: '/home/dev',\n      harness: harnessId('claude'),\n      version: '2.1.261',\n    });\n    assert.equal(plan.actions.length, 0);\n    assert.equal(plan.diagnostics.some((item) => item.code === 'agent-skill-already-present'), true);\n  });\n\n  it('refuses to overwrite an existing user-owned token-harness skill directory', async () => {\n    const plan = await planAgentSkillInstall({\n      fs: memoryFs({\n        '/home/dev/.agents': { kind: 'directory' },\n        '/home/dev/.agents/skills': { kind: 'directory' },\n        '/home/dev/.agents/skills/token-harness': { kind: 'directory' },\n        '/home/dev/.agents/skills/token-harness/SKILL.md': { kind: 'file', content: '# custom skill\\n' },\n      }),\n      home: '/home/dev',\n      harness: harnessId('codex'),\n      version: '0.146.0',\n    });\n    assert.equal(plan.actions.length, 0);\n    assert.equal(plan.diagnostics.some((item) => item.code === 'agent-skill-target-owned-by-user'), true);\n  });\n});\n`,
  'utf8',
);

fs.writeFileSync(
  'apps/cli/test/guided-loading-layout.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\nimport { GUIDE_HTML } from '../src/guided-assets.js';\n\ndescribe('guided loading layout', () => {\n  it('uses the loaded agent-card padding while Claude and Codex are still skeletons', () => {\n    assert.equal(GUIDE_HTML.match(/class=\"panel agent loading-card\"/g)?.length, 2);\n    assert.equal(GUIDE_HTML.includes('class=\"panel loading-card\"'), false);\n  });\n});\n`,
  'utf8',
);

fs.writeFileSync(
  'apps/cli/test/agent-skill-argv.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\nimport { parseArgv } from '../src/argv.js';\n\ndescribe('internal Agent Skill plan selector', () => {\n  it('preserves the guided --agent-skill selector in the shared command context', () => {\n    const parsed = parseArgv(['plan', '--harness', 'claude', '--provider', 'none', '--agent-skill']);\n    assert.equal(parsed.kind, 'command');\n    if (parsed.kind !== 'command') return;\n    assert.equal(parsed.options.agentSkill, true);\n    assert.equal(parsed.options.nativePolicy, false);\n  });\n});\n`,
  'utf8',
);

fs.writeFileSync(
  'apps/cli/test/guided-agent-skill.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\nimport { GuideService, type GuideCall } from '../src/guided.js';\n\nfunction envelope(command: string, data: unknown, exitCode = 0) {\n  return { schemaVersion: 1, toolVersion: '0.0.0-test', command, status: exitCode === 0 ? 'ok' : 'error', exitCode, data, diagnostics: [] };\n}\n\ndescribe('guided in-session guidance flow', () => {\n  it('turns one UI action into a reviewed plan and stored-plan apply', async () => {\n    const calls: string[][] = [];\n    const call: GuideCall = async <T>(args: readonly string[]) => {\n      calls.push([...args]);\n      if (args[0] === 'doctor') {\n        return envelope('doctor', { harnesses: [{ harnessId: 'claude', state: 'present', version: '2.1.261' }], providers: [] }) as never;\n      }\n      if (args[0] === 'plan') {\n        return envelope('plan', {\n          planId: '1234abcd', persisted: true, conflicts: [], network: [], actions: [{\n            kind: 'write-owned-file', id: 'agent-skill:claude:write', riskClass: 'reversible', requiresNetwork: false, requiresElevation: false,\n            affectedPaths: ['/home/dev/.claude/skills/token-harness/SKILL.md'], affectedProcesses: [], preconditions: [], postconditions: [],\n            rollbackData: 'file-snapshot', explanation: 'Install skill', path: '/home/dev/.claude/skills/token-harness/SKILL.md', content: 'skill', mode: '0644', expectedDigest: null,\n          }],\n        }) as never;\n      }\n      if (args[0] === 'apply') return envelope('apply', { outcome: 'committed' }) as never;\n      throw new Error('unexpected call: ' + args.join(' '));\n    };\n    const service = new GuideService(call, () => 1_000, () => 'ticket');\n    const preview = await service.preview({ action: 'skill', harness: 'claude' });\n    assert.equal(preview.ticket, 'ticket');\n    assert.equal(preview.changes[0]?.title, 'Claude Code: enable in-session guidance');\n    assert.deepEqual(calls[1], ['plan', '--harness', 'claude', '--provider', 'none', '--agent-skill']);\n    const applied = await service.apply({ ticket: 'ticket' });\n    assert.equal(applied.ok, true);\n    assert.deepEqual(calls.at(-1), ['apply', '--plan', '1234abcd', '--yes']);\n  });\n});\n`,
  'utf8',
);

fs.writeFileSync(
  'docs/rfcs/0023-guided-agent-skill-install.md',
  `# RFC 0023 — Guided Agent Skill installation\n\n- Status: Proposed\n- Date: 2026-09-08\n- Owners: Token Harness\n\n## Summary\n\nThe browser becomes the human entry point for enabling the Agent Skill introduced by RFC 0022.\nClaude Code and Codex still consume the same portable skill and the existing JSON CLI remains the\ndeterministic controller. The browser adds one reviewed action: **Enable in-session guidance**.\n\n## Targets\n\nFor a detected user installation Token Harness resolves only the documented user-level locations:\n\n- Claude Code: \`~/.claude/skills/token-harness/SKILL.md\`;\n- Codex: \`$HOME/.agents/skills/token-harness/SKILL.md\`.\n\nThe installed harness version is recorded in the stored plan. If it changes between preview and\napply, the existing stored-plan version check refuses the mutation. An unobservable harness version\ntherefore produces no persistent skill plan.\n\n## Ownership and conflicts\n\nThe skill is a \`write-owned-file\` action preceded by reversible directory creation where needed.\nThe transaction engine snapshots absence and content before writing. The exact portable SKILL.md\npayload is compiled into the local bundle and an integration gate keeps it byte-identical to the\nrepository source.\n\nIf a \`token-harness\` skill directory already exists, Token Harness never overwrites or silently\nadopts it. Byte-identical existing content is reported as already present but remains user-owned\nunless a prior Token Harness transaction already owns it. Different content is a visible conflict.\nA target change after preview changes the recomputed skill plan and apply fails closed before the\nreviewed stored actions can run.\n\n## UI contract\n\nEach detected Claude/Codex card and its Rules & settings view can expose **Enable in-session\nguidance**. The preview describes one Agent Skill installation rather than surfacing implementation\ndirectories as separate user decisions. Approval remains single-use and time-bounded. Apply uses the\nexisting plan/apply transaction, backup and drift machinery.\n\nThe loading skeleton uses the same \`agent\` card padding as the loaded card. This prevents text from\njumping horizontally when partial observations replace the initial Claude/Codex placeholders.\n\n## Non-goals\n\nThis phase does not add an MCP server, daemon, background model, automatic model switch, credential\naccess, billing change, hook trust change, or a second quota formula. It also does not run Token\nHarness before every tool call. The skill remains progressively disclosed and advisory by default.\n`,
  'utf8',
);

replaceOnce(
  'README.md',
  `Phase 18.13 ships the portable skill source rather than hard-coding harness-specific skill folders.\nInstall or import the \`skills/token-harness\` directory with a supported Agent Skills mechanism.\nA later reviewed phase can bundle and install it from the guided app once current Claude/Codex\nskill-discovery locations and ownership semantics are fixture-tested. The browser remains fully\nusable without any skill or second AI subscription.`,
  `The guided app can now preview **Enable in-session guidance** for each detected Claude Code or\nCodex installation. It installs the same portable skill into the agent's documented user-level\nAgent Skills directory through the normal transactional plan/apply path. Existing \`token-harness\nskill directories are left user-owned and are never overwritten or silently adopted. The browser\nremains fully usable without any skill or second AI subscription. See\n[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md) for the install and ownership boundary.`,
);

fs.appendFileSync(
  'PLAN.md',
  `\n\n## Guided Agent Skill installation milestone (2026-09-08, RFC 0023)\n\n**Phase 18.14 complete.** The guided app now exposes **Enable in-session guidance** for detected\nClaude Code and Codex agents. The browser remains the human interface; the installed portable skill\nuses the existing JSON controller at meaningful task boundaries.\n\nThe installation is a normal reversible plan/apply transaction. Claude targets\n\`~/.claude/skills/token-harness/SKILL.md\`; Codex targets\n\`$HOME/.agents/skills/token-harness/SKILL.md\`. The exact harness version is captured by the stored\nplan, the skill payload is byte-identical to the repository SKILL.md, and a changed target or agent\nversion fails closed before apply. Existing same-name skill directories are never overwritten or\nsilently adopted.\n\nThe initial Claude/Codex skeleton cards also share the final \`agent\` padding, eliminating the\nleft-edge text jump while asynchronous observations are loading.\n\nNext UX work should observe managed-skill ownership/status explicitly in Overview so an already\nToken-Harness-owned skill can display **Enabled** without requiring the user to open a preview.\n`,
  'utf8',
);
