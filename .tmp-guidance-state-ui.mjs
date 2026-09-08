import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected exactly one replacement anchor`);
  }
  fs.writeFileSync(path, text.slice(0, first) + after + text.slice(first + before.length));
}

// agent-skill.ts: add read-only observation with transaction-aware ownership.
replaceOnce(
  'apps/cli/src/agent-skill.ts',
  `import {\n  diagnostic,\n  digestBytes,`,
  `import {\n  FileJournalStore,\n  diagnostic,\n  digestBytes,`,
);
replaceOnce(
  'apps/cli/src/agent-skill.ts',
  `export interface AgentSkillInstallPlan {\n  target: string | null;\n  actions: PlannedAction[];\n  diagnostics: Diagnostic[];\n}\n`,
  `export interface AgentSkillInstallPlan {\n  target: string | null;\n  actions: PlannedAction[];\n  diagnostics: Diagnostic[];\n}\n\nexport type AgentSkillObservationState =\n  | 'managed'\n  | 'external'\n  | 'absent'\n  | 'conflict'\n  | 'unavailable';\n\nexport interface AgentSkillObservation {\n  state: AgentSkillObservationState;\n  target: string | null;\n  detail: string;\n}\n\nfunction targetFor(\n  fsPort: FileSystemPort,\n  home: string,\n  harness: 'claude' | 'codex',\n): { directory: string; target: string } {\n  let cursor = home;\n  for (const segment of TARGETS[harness] ?? []) cursor = fsPort.join(cursor, segment);\n  return { directory: cursor, target: fsPort.join(cursor, 'SKILL.md') };\n}\n\nexport async function observeAgentSkill(input: {\n  fs: FileSystemPort;\n  home: string | null;\n  stateRoot: string | null;\n  harness: 'claude' | 'codex';\n}): Promise<AgentSkillObservation> {\n  if (input.home === null) {\n    return {\n      state: 'unavailable',\n      target: null,\n      detail: 'The user home directory is unavailable, so the Agent Skill location cannot be checked.',\n    };\n  }\n  const resolved = targetFor(input.fs, input.home, input.harness);\n  if (!input.fs.isInside(resolved.target, input.home)) {\n    return {\n      state: 'unavailable',\n      target: resolved.target,\n      detail: 'The resolved Agent Skill location is outside the user home directory.',\n    };\n  }\n  const directoryStat = await input.fs.stat(resolved.directory);\n  if (directoryStat === null) {\n    return {\n      state: 'absent',\n      target: resolved.target,\n      detail: 'In-session guidance is not installed for this agent.',\n    };\n  }\n  if (directoryStat.kind !== 'directory') {\n    return {\n      state: 'conflict',\n      target: resolved.target,\n      detail: 'A user-owned path occupies the Token Harness Agent Skill location.',\n    };\n  }\n  const targetStat = await input.fs.stat(resolved.target);\n  if (targetStat?.kind !== 'file') {\n    return {\n      state: 'conflict',\n      target: resolved.target,\n      detail: 'A token-harness skill directory exists without the expected SKILL.md file. It is kept user-owned.',\n    };\n  }\n  const liveDigest = digestBytes(await input.fs.readFile(resolved.target));\n\n  let latestRelevant: Awaited<ReturnType<FileJournalStore['list']>>[number] | null = null;\n  if (input.stateRoot !== null) {\n    const journalRoot = input.fs.join(input.stateRoot, 'journals');\n    if ((await input.fs.stat(journalRoot))?.kind === 'directory') {\n      const journals = new FileJournalStore({\n        fs: input.fs,\n        journalRoot,\n        backupRoot: input.fs.join(input.stateRoot, 'backups'),\n      });\n      for (const journal of await journals.list()) {\n        const relevant = journal.entries.some(\n          (entry) =>\n            entry.snapshots.some((snapshot) => snapshot.path === resolved.target) ||\n            entry.ownership.some((artifact) => artifact.path === resolved.target),\n        );\n        if (!relevant) continue;\n        if (journal.outcome === 'rolled-back') continue;\n        latestRelevant = journal;\n        break;\n      }\n    }\n  }\n\n  if (latestRelevant?.outcome === 'dirty' || latestRelevant?.outcome === 'in-progress') {\n    return {\n      state: 'unavailable',\n      target: resolved.target,\n      detail: 'A relevant Token Harness transaction is incomplete, so ownership is not claimed.',\n    };\n  }\n  const owned =\n    latestRelevant?.outcome === 'committed' &&\n    latestRelevant.ownership.some(\n      (artifact) =>\n        artifact.kind === 'owned-file' &&\n        artifact.path === resolved.target &&\n        artifact.digest === SKILL_DIGEST,\n    );\n  if (liveDigest !== SKILL_DIGEST) {\n    return {\n      state: 'conflict',\n      target: resolved.target,\n      detail: owned\n        ? 'The Token Harness-managed Agent Skill was modified after installation. It will not be overwritten automatically.'\n        : 'A custom token-harness Agent Skill exists here. It remains user-owned and is not overwritten.',\n    };\n  }\n  if (owned) {\n    return {\n      state: 'managed',\n      target: resolved.target,\n      detail: 'Enabled and managed by Token Harness. The installed file matches the bundled Agent Skill.',\n    };\n  }\n  return {\n    state: 'external',\n    target: resolved.target,\n    detail: 'A matching Token Harness Agent Skill is enabled but was not installed by the current Token Harness ownership journal.',\n  };\n}\n`,
);

// guided.ts: optional production observer, UI-friendly state, and rules.
replaceOnce(
  'apps/cli/src/guided.ts',
  `import { run, DEFAULT_COMMANDS, type RunOptions } from './run.js';`,
  `import { run, DEFAULT_COMMANDS, type RunOptions } from './run.js';\nimport type { AgentSkillObservation } from './agent-skill.js';`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `export interface GuideAgent {\n  id: GuideHarness;`,
  `export interface GuideGuidance {\n  state: 'managed' | 'external' | 'absent' | 'conflict' | 'unavailable';\n  label: string;\n  description: string;\n  action?: GuideAction;\n}\nexport interface GuideAgent {\n  id: GuideHarness;`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `  reasoning: GuideReasoning;\n  allowanceAction: GuideAction;`,
  `  reasoning: GuideReasoning;\n  guidance?: GuideGuidance;\n  allowanceAction: GuideAction;`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `function agentRules(\n  id: GuideHarness,\n  providers: string[],\n  context: ContextReport | null,\n): GuideRule[] {`,
  `function guidanceView(id: GuideHarness, observation: AgentSkillObservation): GuideGuidance {\n  const labels: Record<AgentSkillObservation['state'], string> = {\n    managed: 'Enabled',\n    external: 'Enabled externally',\n    absent: 'Not enabled',\n    conflict: 'Custom skill found',\n    unavailable: 'Not verified',\n  };\n  return {\n    state: observation.state,\n    label: labels[observation.state],\n    description: observation.detail,\n    ...(observation.state === 'absent'\n      ? { action: { kind: 'skill' as const, label: 'Enable in-session guidance', harness: id } }\n      : {}),\n  };\n}\n\nfunction agentRules(\n  id: GuideHarness,\n  providers: string[],\n  context: ContextReport | null,\n  guidance?: GuideGuidance,\n): GuideRule[] {`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `    {\n      id: \`${'${id}'}-guidance\`,\n      title: 'In-session Token Harness guidance',\n      state: 'Optional',\n      mode: 'integration',\n      what:\n        id === 'claude'\n          ? 'Installs the portable Token Harness Agent Skill in ~/.claude/skills/token-harness so Claude can consult the local controller when a task needs it.'\n          : 'Installs the portable Token Harness Agent Skill in ~/.agents/skills/token-harness so Codex can consult the local controller when a task needs it.',\n      why: 'The harness can ask Token Harness for quota-aware, quality-gated advice without making advanced CLI flags the human workflow.',\n      evidence:\n        'Installation is local, previewed and transactional. An existing token-harness skill directory is never overwritten or silently adopted.',\n      next: 'Enable this once, then keep coding normally. Ask the agent to use Token Harness for a task when you want an explicit check; the skill also activates on relevant allowance decisions.',\n      action: { kind: 'skill', label: 'Enable in-session guidance', harness: id },\n    },`,
  `    {\n      id: \`${'${id}'}-guidance\`,\n      title: 'In-session Token Harness guidance',\n      state: guidance?.label ?? 'Optional',\n      mode: guidance?.state === 'absent' ? 'not-enabled' : 'integration',\n      what:\n        guidance?.description ??\n        (id === 'claude'\n          ? 'Installs the portable Token Harness Agent Skill in ~/.claude/skills/token-harness so Claude can consult the local controller when a task needs it.'\n          : 'Installs the portable Token Harness Agent Skill in ~/.agents/skills/token-harness so Codex can consult the local controller when a task needs it.'),\n      why: 'The harness can ask Token Harness for quota-aware, quality-gated advice without making advanced CLI flags the human workflow.',\n      evidence:\n        guidance?.state === 'managed'\n          ? 'Live bytes match the bundled skill and the latest relevant committed transaction still owns that file.'\n          : guidance?.state === 'external'\n            ? 'The live file matches the bundled skill, but Token Harness has no current ownership claim and will not remove or replace it automatically.'\n            : 'Installation is local, previewed and transactional. An existing token-harness skill directory is never overwritten or silently adopted.',\n      next:\n        guidance?.state === 'managed'\n          ? 'Keep coding normally. Ask the agent to use Token Harness when you want an explicit quota-aware check.'\n          : guidance?.state === 'external'\n            ? 'The matching skill can be used as-is. Token Harness keeps it user-owned.'\n            : guidance?.state === 'conflict'\n              ? 'Review the existing skill manually. Token Harness will not overwrite it.'\n              : 'Enable this once, then keep coding normally. Ask the agent to use Token Harness for a task when you want an explicit check.',\n      ...(guidance?.action ? { action: guidance.action } : {}),\n    },`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `  private readonly random: () => string;\n  constructor(call: GuideCall, now: () => number, random: () => string) {\n    this.call = call;\n    this.now = now;\n    this.random = random;\n  }`,
  `  private readonly random: () => string;\n  private readonly observeGuidance: ((harness: GuideHarness) => Promise<AgentSkillObservation>) | null;\n  constructor(\n    call: GuideCall,\n    now: () => number,\n    random: () => string,\n    observeGuidance: ((harness: GuideHarness) => Promise<AgentSkillObservation>) | null = null,\n  ) {\n    this.call = call;\n    this.now = now;\n    this.random = random;\n    this.observeGuidance = observeGuidance;\n  }`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `    let doctor = empty<DoctorReport>(),\n      budget = empty<BudgetReport>(),\n      context = empty<ContextReport>();`,
  `    let doctor = empty<DoctorReport>(),\n      budget = empty<BudgetReport>(),\n      context = empty<ContextReport>();\n    let guidance: Partial<Record<GuideHarness, GuideGuidance>> | undefined;`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `      loading.agents = this.agentView(doctor, budget, context, {\n        rules: loading.stages.find((item) => item.id === 'rules')?.state !== 'working',\n        allowance: loading.stages.find((item) => item.id === 'allowance')?.state !== 'working',\n      });`,
  `      loading.agents = this.agentView(doctor, budget, context, {\n        rules: loading.stages.find((item) => item.id === 'rules')?.state !== 'working',\n        allowance: loading.stages.find((item) => item.id === 'allowance')?.state !== 'working',\n      }, guidance);`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `      observe<ContextReport>('rules', ['context']).then((result) => {\n        context = result;\n        updateAgents();\n      }),`,
  `      observe<ContextReport>('rules', ['context']).then(async (result) => {\n        context = result;\n        if (this.observeGuidance !== null) {\n          guidance = {};\n          await Promise.all(\n            (['claude', 'codex'] as const).map(async (harness) => {\n              try {\n                guidance![harness] = guidanceView(harness, await this.observeGuidance!(harness));\n              } catch {\n                guidance![harness] = {\n                  state: 'unavailable',\n                  label: 'Not verified',\n                  description: 'The Agent Skill state could not be checked. No ownership is assumed.',\n                };\n              }\n            }),\n          );\n        }\n        updateAgents();\n      }),`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `    const agents = this.agentView(doctor, budget, context, { rules: true, allowance: true });`,
  `    const agents = this.agentView(doctor, budget, context, { rules: true, allowance: true }, guidance);`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `  private agentView(\n    doctor: GuideRead<DoctorReport>,\n    budget: GuideRead<BudgetReport>,\n    context: GuideRead<ContextReport>,\n    complete: { rules: boolean; allowance: boolean },\n  ): GuideAgent[] {`,
  `  private agentView(\n    doctor: GuideRead<DoctorReport>,\n    budget: GuideRead<BudgetReport>,\n    context: GuideRead<ContextReport>,\n    complete: { rules: boolean; allowance: boolean },\n    guidance?: Partial<Record<GuideHarness, GuideGuidance>>,\n  ): GuideAgent[] {`,
);
replaceOnce(
  'apps/cli/src/guided.ts',
  `        reasoning: reasoningView(agent.harnessId as GuideHarness, observed),\n        allowanceAction: allowanceAction(usage?.diagnostics ?? []),\n        rules: agentRules(agent.harnessId as GuideHarness, providers, context.data),`,
  `        reasoning: reasoningView(agent.harnessId as GuideHarness, observed),\n        ...(guidance?.[agent.harnessId as GuideHarness]\n          ? { guidance: guidance[agent.harnessId as GuideHarness] }\n          : {}),\n        allowanceAction: allowanceAction(usage?.diagnostics ?? []),\n        rules: agentRules(\n          agent.harnessId as GuideHarness,\n          providers,\n          context.data,\n          guidance?.[agent.harnessId as GuideHarness],\n        ),`,
);

// guided-client.ts: put the state directly on each agent card.
replaceOnce(
  'apps/cli/src/guided-client.ts',
  `  integration.append(rulesButton); card.append(integration);\n  const reasoning = agent.reasoning;`,
  `  integration.append(rulesButton); card.append(integration);\n  if (agent.guidance) {\n    const guidanceLine=node('div',undefined,'agent-line'), guidanceText=node('div');\n    guidanceText.append(node('span','Guidance','key'),node('strong',agent.guidance.label)); guidanceLine.append(guidanceText);\n    if(agent.guidance.action)guidanceLine.append(actionButton(agent.guidance.action,agent.id+'-guidance','text-button'));\n    card.append(guidanceLine);\n    if(['external','conflict','unavailable'].includes(agent.guidance.state))card.append(node('p',agent.guidance.description,'subtle-note'));\n  }\n  const reasoning = agent.reasoning;`,
);

// main.ts: production observer gets the real local filesystem and state root.
replaceOnce(
  'apps/cli/src/main.ts',
  `import { createGuideCall, GuideService, savingsView, type GuidePeriod } from './guided.js';`,
  `import {\n  createGuideCall,\n  GuideService,\n  savingsView,\n  type GuideHarness,\n  type GuidePeriod,\n} from './guided.js';\nimport { observeAgentSkill } from './agent-skill.js';`,
);
replaceOnce(
  'apps/cli/src/main.ts',
  `  const service = new GuideService(\n    createGuideCall(base),\n    () => Date.now(),\n    () => randomBytes(32).toString('hex'),\n  );`,
  `  const service = new GuideService(\n    createGuideCall(base),\n    () => Date.now(),\n    () => randomBytes(32).toString('hex'),\n    async (harness: GuideHarness) => {\n      if (base.adapters === null || base.adapters === undefined) {\n        return {\n          state: 'unavailable',\n          target: null,\n          detail: 'The local filesystem is unavailable, so the Agent Skill state cannot be checked.',\n        };\n      }\n      return observeAgentSkill({\n        fs: base.adapters.fs,\n        home: base.home,\n        stateRoot: base.stateRoot ?? null,\n        harness,\n      });\n    },\n  );`,
);

// Tests: extend memory FS and cover live + ownership distinctions.
replaceOnce(
  'apps/cli/test/agent-skill-install.test.ts',
  `import type { FileStat, FileSystemPort } from '@token-harness/core';\nimport { harnessId } from '@token-harness/core';\n\nimport { planAgentSkillInstall, TOKEN_HARNESS_AGENT_SKILL } from '../src/agent-skill.js';`,
  `import { digestBytes, harnessId, type FileStat, type FileSystemPort } from '@token-harness/core';\n\nimport {\n  observeAgentSkill,\n  planAgentSkillInstall,\n  TOKEN_HARNESS_AGENT_SKILL,\n} from '../src/agent-skill.js';`,
);
replaceOnce(
  'apps/cli/test/agent-skill-install.test.ts',
  `    readDirectory: async () => [],`,
  `    readDirectory: async (path) => {\n      const prefix=path.replace(/\\/$/,'')+'/';\n      return [...new Set(Object.keys(entries).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length).split('/')[0]).filter(Boolean))];\n    },`,
);
replaceOnce(
  'apps/cli/test/agent-skill-install.test.ts',
  `  it('refuses to overwrite an existing user-owned token-harness skill directory', async () => {`,
  `  it('reports a matching user-owned skill as enabled externally', async () => {\n    const observation = await observeAgentSkill({\n      fs: memoryFs({\n        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },\n        '/home/dev/.claude/skills/token-harness/SKILL.md': { kind: 'file', content: TOKEN_HARNESS_AGENT_SKILL },\n      }),\n      home: '/home/dev',\n      stateRoot: '/state',\n      harness: 'claude',\n    });\n    assert.equal(observation.state, 'external');\n  });\n\n  it('reports the skill as managed only when the newest relevant committed journal owns the live digest', async () => {\n    const target='/home/dev/.claude/skills/token-harness/SKILL.md';\n    const digest=digestBytes(new TextEncoder().encode(TOKEN_HARNESS_AGENT_SKILL));\n    const journal=JSON.stringify({\n      schemaVersion:1,transactionId:'tx1',planId:'abcd1234',projectId:null,projectRoot:'/project',\n      startedAt:'2026-09-08T20:00:00.000Z',finishedAt:'2026-09-08T20:00:01.000Z',outcome:'committed',\n      entries:[{actionId:'agent-skill:claude:write',kind:'write-owned-file',status:'applied',snapshots:[{path:target,kind:'absent'}],ownership:[{kind:'owned-file',path:target,digest,mode:'0644'}],diagnostics:[],packageInventory:null}],\n      ownership:[{kind:'owned-file',path:target,digest,mode:'0644'}],pinned:false,diagnostics:[]\n    });\n    const observation = await observeAgentSkill({\n      fs: memoryFs({\n        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },\n        [target]: { kind: 'file', content: TOKEN_HARNESS_AGENT_SKILL },\n        '/state/journals': { kind: 'directory' },\n        '/state/journals/tx1.json': { kind: 'file', content: journal },\n      }),\n      home:'/home/dev',stateRoot:'/state',harness:'claude'\n    });\n    assert.equal(observation.state,'managed');\n  });\n\n  it('reports a custom same-name skill as a conflict instead of overwriting it', async () => {\n    const observation = await observeAgentSkill({\n      fs: memoryFs({\n        '/home/dev/.agents/skills/token-harness': { kind: 'directory' },\n        '/home/dev/.agents/skills/token-harness/SKILL.md': { kind: 'file', content: '# custom skill\\n' },\n      }),\n      home:'/home/dev',stateRoot:'/state',harness:'codex'\n    });\n    assert.equal(observation.state,'conflict');\n\n  });\n\n  it('refuses to overwrite an existing user-owned token-harness skill directory', async () => {`,
);

// A focused UI regression test for the visible badge/button contract.
fs.writeFileSync(
  'apps/cli/test/guidance-state-ui.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\nimport { GUIDE_JS } from '../src/guided-assets.js';\n\ndescribe('guided Agent Skill state UI',()=>{\n  it('renders guidance state on the agent card and only exposes install when an action exists',()=>{\n    assert.match(GUIDE_JS,/node\\('span','Guidance','key'\\)/);\n    assert.match(GUIDE_JS,/agent\\.guidance\\.label/);\n    assert.match(GUIDE_JS,/if\\(agent\\.guidance\\.action\\)guidanceLine\\.append/);\n  });\n});\n`,
  'utf8',
);

// README + PLAN: keep the human workflow explicit and mark the release candidate UX milestone.
replaceOnce(
  'README.md',
  `After approval, Token Harness installs the same portable skill used by the repository.`,
  `After approval, Token Harness installs the same portable skill used by the repository. The agent card then shows whether guidance is **Enabled** and managed by Token Harness, enabled from an identical external/user-owned skill, unavailable, or blocked by an existing custom skill. Token Harness never claims ownership merely because the bytes happen to match.`,
);
fs.appendFileSync(
  'PLAN.md',
  `\n### Phase 18.13 - Guided Agent Skill state (completed)\n\n- Show live in-session guidance state directly on each Claude Code / Codex card.\n- Distinguish Token Harness-managed ownership from identical external/user-owned skills.\n- Treat modified/custom skill paths as conflicts and never overwrite them automatically.\n- Resolve ownership from the newest relevant effective transaction plus the live file digest, so rollback/uninstall cannot leave a ghost Enabled state.\n- Keep this state read-only; installation still requires the existing preview -> approval -> apply transaction.\n`,
);
