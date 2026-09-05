/** Guided product workflow. Only fixed commands reach the existing transaction engine. */
import type {
  ApplyReport,
  BudgetReport,
  CliEnvelope,
  ContextReport,
  Diagnostic,
  DoctorReport,
  MetricsReport,
  PlanReport,
  PlannedAction,
  StatusReport,
  VerifyReport,
} from '@token-harness/core';
import { run, DEFAULT_COMMANDS, type RunOptions } from './run.js';
import { runMetrics } from './commands/metrics.js';

export type GuidePeriod = 'all' | '7d' | '30d';
export type GuideHarness = 'claude' | 'codex';
export type GuideTask = 'mechanical' | 'standard' | 'hard' | 'critical';
export type GuideCall = <T>(args: readonly string[]) => Promise<CliEnvelope<T>>;
export interface GuideRule {
  id: string;
  title: string;
  state: string;
  mode:
    | 'automatic'
    | 'integration'
    | 'preference'
    | 'observation'
    | 'advice'
    | 'not-enabled'
    | 'safety';
  what: string;
  why: string;
  evidence: string;
}
export interface GuideAgent {
  id: GuideHarness;
  name: string;
  version: string | null;
  configured: boolean;
  state: string;
  providers: string[];
  effort: string | null;
  rules: GuideRule[];
  allowance: Array<{
    label: string;
    remaining: number | null;
    resetsAt: string | null;
    source: string;
  }>;
  allowanceNote: string;
}
export interface GuideSavings {
  period: GuidePeriod;
  scope: 'All locally recorded projects';
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  rows: Array<{
    provider: string;
    measurement: string;
    unit: string;
    saved: number;
    before: number | null;
    after: number | null;
    operations: number;
    agents: string[];
  }>;
  errors: number;
  inflated: number;
  note: string;
}
export interface GuideOverview {
  generatedAt: string;
  agents: GuideAgent[];
  savings: GuideSavings;
  rules: GuideRule[];
  notices: string[];
}
export interface GuidePreview {
  ticket: string | null;
  title: string;
  changes: Array<{ title: string; description: string; files: number }>;
  notices: string[];
  expiresAt: string | null;
  network: boolean;
  restart: boolean;
}
export interface GuideResult {
  ok: boolean;
  title: string;
  messages: string[];
  appliedPlans: number;
}
export interface GuideActivity {
  at: string;
  message: string;
  state: 'working' | 'success' | 'attention';
}
interface Approval {
  id: string;
  expires: number;
  plans: string[];
  description: string;
  operation: 'apply' | 'rollback';
  network: boolean;
}
export class GuideError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const NAMES: Readonly<Record<string, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  rtk: 'RTK',
  harnesstrim: 'HarnessTrim',
};
const name = (id: string): string => NAMES[id] ?? id;
const TASKS = new Set(['mechanical', 'standard', 'hard', 'critical']);
const PERIODS = new Set(['all', '7d', '30d']);
const ISSUE_COPY: Readonly<Record<string, string>> = {
  'cclimits-not-installed':
    'Claude allowance needs the optional cclimits companion. Output optimization does not depend on the allowance meter.',
  'cclimits-readonly-flags-unsupported':
    'The installed cclimits is too old for safe allowance reading. Version 1.7.0 includes the required support.',
  'cclimits-python-unavailable':
    'cclimits is installed, but Python could not start. Check the Python installation used by this terminal.',
  'cclimits-claude-credentials-unavailable':
    'No usable Claude login was found. Sign in to Claude, then refresh this page.',
  'cclimits-claude-token-expired':
    'The Claude login has expired. Sign in again in Claude, then refresh.',
  'cclimits-claude-cache-stale':
    'Only old Claude allowance data was found. It is not presented as current allowance.',
  'cclimits-claude-source-unsupported':
    'This cclimits response lacks supported Claude discovery information. Check its installed version.',
  'claude-native-policy-blocked':
    'Claude settings could not be changed safely. A project override, environment setting or unreviewed version may be in effect. Your settings were kept.',
  'native-policy-harness-unsupported':
    'This agent does not expose a reviewed setting for this action.',
  'codex-native-policy-unavailable':
    'Codex did not expose a writable, versioned user setting. No change is proposed.',
  'codex-native-policy-shadowed':
    'A project or profile overrides this Codex setting. That setting belongs to you and will not be replaced.',
  'no-providers-registered': 'No optimization provider was selected for this operation.',
  'already-in-desired-state':
    'The supported integration is already configured. Nothing needs to be changed.',
  'managed-mutation-unsupported':
    'Automatic setup is not yet verified for this installed version combination. Existing integrations are left untouched.',
  'plan-ownership-drift':
    'The integration changed after the preview. Review a fresh plan; nothing was forced.',
  'plan-version-drift': 'An installed version changed after the preview. Review a fresh plan.',
  'plan-project-mismatch': 'This preview belongs to a different project. Open a new preview here.',
  'confirmation-required': 'This change needs your approval first.',
};
export function explainGuideIssue(diagnostics: readonly Diagnostic[], fallback: string): string {
  const known = diagnostics.find((entry) => ISSUE_COPY[entry.code] !== undefined);
  if (known !== undefined) return ISSUE_COPY[known.code] as string;
  const blocked = diagnostics.find((entry) =>
    /compatibility|unsupported|unreviewed|no-row/.test(entry.code),
  );
  if (blocked !== undefined)
    return 'Automatic changes are not verified for this version combination. Your current settings are preserved.';
  if (diagnostics.some((entry) => /drift|mismatch|precondition|conflict/.test(entry.code)))
    return 'Something changed since the preview. No unsafe change was made. Review the current setup again.';
  return fallback;
}

/** JSON is parsed before exit codes; a refused change is still a meaningful report. */
export function createGuideCall(base: Omit<RunOptions, 'argv' | 'streams'>): GuideCall {
  return async <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
    const savings = args[0] === 'savings';
    const translated = savings ? ['metrics', ...args.slice(1)] : [...args];
    let stdout = '';
    await run({
      ...base,
      argv: [...translated, '--json'],
      ...(savings
        ? {
            commands: {
              ...DEFAULT_COMMANDS,
              metrics: (context) =>
                runMetrics({
                  ...context,
                  metricsAllProjects: true,
                  since: context.since ?? '1970-01-01',
                }),
            },
          }
        : {}),
      streams: {
        out: (text) => {
          stdout += text;
        },
        err: () => undefined,
      },
    });
    const result = JSON.parse(stdout) as CliEnvelope<T>;
    return savings ? { ...result, command: 'savings' } : result;
  };
}

export function savingsView(report: MetricsReport | null, period: GuidePeriod): GuideSavings {
  const labels: Readonly<Record<string, string>> = {
    'exact-local': 'Measured local output',
    'estimated-local': 'Local estimate',
    'end-to-end-billed': 'Paired session measurement',
  };
  return {
    period,
    scope: 'All locally recorded projects',
    firstRecordedAt: report?.firstRecordedAt ?? null,
    lastRecordedAt: report?.lastRecordedAt ?? null,
    rows: (report?.providers ?? [])
      .filter((row) => row.class !== 'counterfactual')
      .map((row) => ({
        provider: name(row.providerId),
        measurement: labels[row.class] ?? row.class,
        unit: row.unit === 'tokens' ? 'tokens' : 'characters',
        saved: row.saved,
        before: row.before ?? null,
        after: row.after ?? null,
        operations: row.operations,
        agents: row.harnesses.map(name),
      })),
    errors: report?.errors ?? 0,
    inflated: report?.inflatedOperations ?? 0,
    note: 'These are recorded output reductions, not money saved or extra subscription allowance. Provider results are kept separate. Simulations are excluded. Available history may predate Token Harness.',
  };
}

function agentRules(id: string, providers: string[], context: ContextReport | null): GuideRule[] {
  const observation = context?.harnesses.find((item) => item.harnessId === id);
  const effort = observation?.nativeEffort?.current ?? observation?.reasoningEffort ?? null;
  return [
    ...['rtk', 'harnesstrim']
      .filter((provider) => providers.includes(provider))
      .map(
        (provider): GuideRule => ({
          id: `${id}-${provider}`,
          title: `${name(provider)} output reduction`,
          state: 'Configured',
          mode: provider === 'rtk' ? 'automatic' : 'integration',
          what:
            provider === 'rtk'
              ? 'Rewrites supported shell commands through RTK, which filters their output before the agent reads it. Coverage depends on the command and installed integration.'
              : 'Shortens supported output through the installed adapter or opt-in agent instructions. On skills-only installations, the agent must actually invoke the reducer; it is not a transparent hook.',
          why: "Reduces repeated output and routine success noise while retaining the provider's diagnostic signals. The exact filter depends on the command, provider and version.",
          evidence:
            'Configuration detected. This does not prove that every command is intercepted. Recorded results are shown separately.',
        }),
      ),
    {
      id: `${id}-effort`,
      title: 'Reasoning effort',
      state: effort ?? 'Not observed',
      mode: 'preference',
      what:
        effort === null
          ? 'The current persistent preference could not be read.'
          : `Current observed preference: ${effort}. Session or project overrides may still apply.`,
      why: 'Simple tasks can use less reasoning; difficult work needs enough reasoning to avoid failed attempts.',
      evidence:
        'Setup never changes this automatically. A task setting applies to future sessions until changed again, not just one task.',
    },
    {
      id: `${id}-mcp`,
      title: 'Connected tools',
      state:
        observation === undefined || !['observed', 'partial'].includes(observation.state)
          ? 'Not observed'
          : `${observation.mcpServers.length}${observation.mcpInventoryTruncated ? '+' : ''} connections`,
      mode: 'observation',
      what: 'Reads the inventory of connected tool servers without removing them.',
      why: 'Large or unused tool inventories can occupy context, but a tool count alone does not justify disabling anything.',
      evidence:
        'Observation only. Token Harness does not currently prove which tools your task needs.',
    },
  ];
}
const SAFETY_RULES: GuideRule[] = [
  {
    id: 'review',
    title: 'Your approval controls changes',
    state: 'Always enforced',
    mode: 'safety',
    what: 'Review a readable preview before any agent configuration is changed. Backups and drift checks run during apply.',
    why: 'Simpler operation must not mean surprising changes.',
    evidence: 'Existing plan/apply/verification/rollback engine. No browser shell execution.',
  },
  {
    id: 'quality',
    title: 'Keep your model and billing',
    state: 'Always enforced',
    mode: 'safety',
    what: 'Never changes model, login, billing, credits or hook trust in this workflow.',
    why: 'Efficiency should not quietly change quality expectations or introduce paid API usage.',
    evidence: 'Task settings are restricted to the reviewed effort and verbosity fields.',
  },
  {
    id: 'measurement',
    title: 'Measure, do not invent savings',
    state: 'Always enforced',
    mode: 'safety',
    what: 'Keeps tokens, characters, estimates, simulations and subscription allowance separate.',
    why: 'A smaller tool response does not prove an identical reduction in subscription usage.',
    evidence:
      'Existing measurement classes and provider event identity. Missing data remains missing.',
  },
];

const TASK_RULES: GuideRule[] = [
  {
    id: 'task-match',
    title: 'Match reasoning to task difficulty',
    state: 'On request, not automatic',
    mode: 'advice',
    what: 'Simple edits request the economy policy; everyday coding uses balanced; complex or critical work uses quality. The engine selects only an advertised, supported reasoning level.',
    why: 'Economy must not push a critical task below high reasoning or a complex task below medium. Unknown model support blocks a change.',
    evidence:
      'The optional task button uses the same deterministic optimizer as the CLI. It previews the actual value before applying. Claude max is never persisted.',
  },
  {
    id: 'quota-context',
    title: 'Protect allowance without sacrificing difficult work',
    state: 'Used by task previews',
    mode: 'advice',
    what: 'The optimizer considers observed allowance windows, reset time, a 20% reserve and context pressure. Cached or unknown allowance never becomes a guessed balance.',
    why: 'When usage runs ahead, lower effort only within the task quality floor. Fix heavy context before increasing effort; consider spare allowance near reset for difficult work.',
    evidence:
      'Advisory policy, not a provider quota formula. The UI never switches models or reasoning while you work, and never clears a session or removes tools automatically.',
  },
];

function describeChange(action: PlannedAction, harness: string): GuidePreview['changes'][number] {
  const prefix = name(harness);
  if (action.kind === 'merge-json' && action.ownedPointers?.includes('effortLevel')) {
    const operation = action.operations.find((item) => item.kind === 'set');
    const value = operation?.kind === 'set' ? String(operation.value) : 'reviewed';
    return {
      title: `${prefix}: set reasoning to ${value}`,
      files: action.affectedPaths.length,
      description:
        'Updates the user preference for future sessions. It stays in effect until changed again; it does not switch back after this task.',
    };
  }
  if (action.kind === 'codex-config-batch-write') {
    const changes = action.edits.map(
      (edit) =>
        `${edit.keyPath === 'model_verbosity' ? 'answer length' : 'reasoning'}: ${String(edit.value)}`,
    );
    return {
      title: `${prefix}: ${changes.join(', ')}`,
      files: action.affectedPaths.length,
      description:
        'Uses the native user settings interface. Model, billing and project/profile overrides are kept. This is a persistent preference, not a one-task setting.',
    };
  }
  const descriptions: Partial<Record<PlannedAction['kind'], string>> = {
    'merge-json': 'Configure the supported agent integration',
    'merge-toml': 'Configure the supported agent integration',
    'patch-marker-block': 'Add the reviewed optimization instructions',
    'delegated-provider-install': 'Connect the reviewed optimization provider',
    'write-owned-file': 'Write the reviewed integration file',
    'create-directory': 'Prepare the integration directory',
  };
  return {
    title: `${prefix}: ${descriptions[action.kind] ?? 'Apply the reviewed integration change'}`,
    description:
      'Preserves unrelated settings. Existing safety checks and backups apply; unsupported versions are not forced.',
    files: action.affectedPaths.length,
  };
}

export class GuideService {
  private approval: Approval | null = null;
  private busy = false;
  private lastApplied: { plan: string; network: boolean } | null = null;
  private reading: Promise<GuideOverview> | null = null;
  private cached: { at: number; period: GuidePeriod; value: GuideOverview } | null = null;
  private readonly activity: GuideActivity[] = [];
  private readonly call: GuideCall;
  private readonly now: () => number;
  private readonly random: () => string;
  constructor(call: GuideCall, now: () => number, random: () => string) {
    this.call = call;
    this.now = now;
    this.random = random;
  }
  status(): { busy: boolean; activity: GuideActivity[]; canUndo: boolean } {
    return { busy: this.busy, activity: [...this.activity], canUndo: this.lastApplied !== null };
  }
  private record(message: string, state: GuideActivity['state']): void {
    this.activity.unshift({ at: new Date(this.now()).toISOString(), message, state });
    this.activity.splice(30);
  }
  async overview(period: GuidePeriod = 'all'): Promise<GuideOverview> {
    if (!PERIODS.has(period)) throw new GuideError(400, 'Choose all history, 7 days or 30 days.');
    if (this.busy && this.cached !== null) return this.cached.value;
    if (this.busy) throw new GuideError(409, 'A reviewed change is in progress.');
    if (this.cached?.period === period && this.now() - this.cached.at < 15_000)
      return this.cached.value;
    if (this.reading !== null) {
      await this.reading;
      return this.overview(period);
    }
    this.reading = this.collect(period);
    try {
      const value = await this.reading;
      this.cached = { value, at: this.now(), period };
      return value;
    } finally {
      this.reading = null;
    }
  }
  private async collect(period: GuidePeriod): Promise<GuideOverview> {
    const [doctor, budget, context, metrics, status] = await Promise.all([
      this.call<DoctorReport>(['doctor']),
      this.call<BudgetReport>(['budget']),
      this.call<ContextReport>(['context']),
      this.call<MetricsReport>(['savings', '--since', period === 'all' ? '1970-01-01' : period]),
      this.call<StatusReport>(['status']),
    ]);
    const present = (doctor.data?.harnesses ?? []).filter(
      (item) =>
        item.state !== 'absent' && (item.harnessId === 'claude' || item.harnessId === 'codex'),
    );
    const agents = present.map((agent): GuideAgent => {
      const providers = (doctor.data?.providers ?? [])
        .filter(
          (provider) =>
            provider.state === 'configured' &&
            provider.configuredHarnesses.includes(agent.harnessId),
        )
        .map((p) => p.providerId);
      const usage = budget.data?.harnesses.find((item) => item.harnessId === agent.harnessId);
      const observed = context.data?.harnesses.find((item) => item.harnessId === agent.harnessId);
      return {
        id: agent.harnessId as GuideHarness,
        name: name(agent.harnessId),
        version: agent.version,
        configured: providers.length > 0,
        state:
          agent.state === 'broken'
            ? 'Needs attention'
            : providers.length > 0
              ? 'Integration configured'
              : 'Ready to set up',
        providers: providers.map(name),
        effort: observed?.nativeEffort?.current ?? observed?.reasoningEffort ?? null,
        rules: agentRules(agent.harnessId, providers, context.data),
        allowance: (usage?.windows ?? []).map((window) => ({
          label: window.scope === 'five-hour' ? '5-hour allowance' : `${window.scope} allowance`,
          remaining: window.remainingPercent,
          resetsAt: window.resetsAt,
          source:
            window.confidence === 'cached'
              ? 'Cached observation'
              : 'Reported by the agent or companion',
        })),
        allowanceNote: explainGuideIssue(
          usage?.diagnostics ?? [],
          'Allowance cannot currently be read. Optimization can still work; this is not a zero balance.',
        ),
      };
    });
    const notices: string[] = [];
    if (doctor.data === null)
      notices.push(
        'The agent inventory could not be read. Check the local installation and refresh.',
      );
    if (
      metrics.data === null ||
      metrics.diagnostics.some((entry) => entry.code === 'metrics-store-unavailable')
    )
      notices.push(
        'Measurement records could not be read. Missing measurements are not reported as zero savings.',
      );
    if (
      metrics.diagnostics.some(
        (entry) => entry.severity === 'warning' || entry.severity === 'error',
      )
    )
      notices.push(
        'Some measurement sources are unavailable or incomplete. The results below cover readable records only; they are not a complete session-wide total.',
      );
    if ((status.data?.problemCount ?? 0) > 0)
      notices.push(
        'An integration has changed or needs verification. Use Check integrations below; existing settings are not repaired silently.',
      );
    return {
      generatedAt: new Date(this.now()).toISOString(),
      agents,
      savings: savingsView(metrics.data, period),
      rules: [...SAFETY_RULES, ...TASK_RULES],
      notices,
    };
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy)
      throw new GuideError(409, 'Another operation is running. No second change was started.');
    // Reserve before awaiting reads, so simultaneous previews cannot both acquire the slot.
    this.busy = true;
    try {
      if (this.reading !== null) await this.reading;
      return await operation();
    } finally {
      this.busy = false;
    }
  }
  async preview(input: unknown): Promise<GuidePreview> {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw new GuideError(400, 'Choose an available action.');
    const data = input as Record<string, unknown>;
    if (
      Object.keys(data).some((key) => !['action', 'harness', 'task'].includes(key)) ||
      !['setup', 'effort', 'undo'].includes(String(data['action'])) ||
      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||
      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||
      (data['action'] === 'effort' && (data['harness'] === undefined || data['task'] === undefined))
    )
      throw new GuideError(400, 'Choose a supported agent and task.');
    return this.exclusive(async () => {
      this.approval = null;
      if (data['action'] === 'undo') {
        if (data['harness'] !== undefined || data['task'] !== undefined)
          throw new GuideError(400, 'Undo accepts no agent or task selection.');
        if (this.lastApplied === null)
          throw new GuideError(409, 'There is no change from this dashboard session to undo.');
        const ticket = this.random(),
          expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: [this.lastApplied.plan],
          description: 'Undo',
          operation: 'rollback',
          network: this.lastApplied.network,
        };
        return {
          ticket,
          title: 'Restore the last change?',
          changes: [
            {
              title: 'Restore the last successful transaction from this dashboard',
              files: 0,
              description:
                'Restores complete configuration files from their backups. Any manual edits made to those files after applying will also be undone. If another transaction occurred, this undo is refused.',
            },
          ],
          notices: [
            'For a multi-agent setup, this restores only the last successful agent transaction, not the whole group. Earlier transactions remain in place.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network: this.lastApplied.network,
          restart: true,
        };
      }
      this.record('Checking supported changes. Your agent settings are unchanged.', 'working');
      const inventory = await this.call<DoctorReport>(['doctor']);
      const selected = (inventory.data?.harnesses ?? []).filter(
        (item) =>
          item.state !== 'absent' &&
          (item.harnessId === 'claude' || item.harnessId === 'codex') &&
          (data['harness'] === undefined || item.harnessId === data['harness']),
      );
      const changes: GuidePreview['changes'] = [],
        notices: string[] = [],
        plans: string[] = [];
      let network = false;
      for (const agent of selected) {
        const args = ['plan', '--harness', agent.harnessId];
        if (data['action'] === 'effort')
          args.push(
            '--provider',
            'none',
            '--native-policy',
            '--task',
            String(data['task']),
            '--profile',
            data['task'] === 'mechanical'
              ? 'economy'
              : data['task'] === 'standard'
                ? 'balanced'
                : 'quality',
          );
        const result = await this.call<PlanReport>(args);
        const report = result.data;
        if (
          report === null ||
          result.exitCode !== 0 ||
          report.conflicts.length > 0 ||
          report.actions.length === 0 ||
          !report.persisted ||
          report.planId === null
        ) {
          notices.push(
            `${name(agent.harnessId)}: ${explainGuideIssue(
              result.diagnostics,
              data['action'] === 'effort'
                ? 'No supported preference change is needed or available. Your current preference is kept.'
                : 'No safe setup change is available. The integration may already be configured, or a required provider is not installed.',
            )}`,
          );
          continue;
        }
        plans.push(report.planId);
        changes.push(...report.actions.map((action) => describeChange(action, agent.harnessId)));
        network ||= report.network.length > 0;
      }
      if (selected.length === 0)
        notices.push(
          'No supported coding agent was found. Install and sign in to Claude Code or Codex, then refresh.',
        );
      const id = plans.length > 0 ? this.random() : null;
      const expires = this.now() + 10 * 60_000;
      if (id !== null)
        this.approval = {
          id,
          expires,
          plans,
          description: data['action'] === 'effort' ? 'Task preference' : 'Integration setup',
          operation: 'apply',
          network,
        };
      this.record(
        id === null
          ? 'No configuration changed. See the setup explanation.'
          : 'Preview ready. Waiting for your approval.',
        id === null ? 'attention' : 'success',
      );
      return {
        ticket: id,
        title: id === null ? 'No change to apply' : 'Review these changes',
        changes,
        notices,
        expiresAt: id === null ? null : new Date(expires).toISOString(),
        network,
        restart: data['action'] === 'effort',
      };
    });
  }
  async apply(input: unknown): Promise<GuideResult> {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw new GuideError(400, 'A reviewed preview is required.');
    const data = input as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || typeof data['ticket'] !== 'string')
      throw new GuideError(400, 'A reviewed preview is required.');
    return this.exclusive(async () => {
      const approval = this.approval;
      if (approval === null || approval.id !== data['ticket'] || this.now() >= approval.expires)
        throw new GuideError(
          409,
          'This preview expired or was already used. Review a fresh preview.',
        );
      this.approval = null;
      this.record(
        approval.operation === 'rollback'
          ? 'Restoring the reviewed configuration backup.'
          : 'Backing up and applying exactly the changes you approved.',
        'working',
      );
      const messages: string[] = [];
      let appliedPlans = 0;
      for (const plan of approval.plans) {
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>([approval.operation, '--plan', plan, '--yes']);
        } catch {
          this.cached = null;
          const message =
            'The operation stopped before its final result could be read. No automatic retry was made. Refresh and check the integration before making another change.';
          this.record(message, 'attention');
          return {
            ok: false,
            title:
              appliedPlans > 0
                ? 'Some changes applied; the last result needs checking'
                : 'The result needs checking',
            messages: [message],
            appliedPlans,
          };
        }
        if (
          result.exitCode !== 0 ||
          result.data?.outcome !== (approval.operation === 'rollback' ? 'rolled-back' : 'committed')
        ) {
          const message =
            result.exitCode === 7
              ? 'A change failed and could not be fully restored. Stop making changes and inspect the local transaction log.'
              : result.exitCode === 6
                ? 'This change failed. Its backups were restored.'
                : explainGuideIssue(
                    result.diagnostics,
                    'The change was not applied. Review a fresh preview; your safety checks were not bypassed.',
                  );
          messages.push(message);
          this.cached = null;
          this.record(message, 'attention');
          return {
            ok: false,
            title:
              appliedPlans > 0
                ? 'Some changes applied; one needs attention'
                : 'No change completed',
            messages,
            appliedPlans,
          };
        }
        appliedPlans += 1;
        this.lastApplied =
          approval.operation === 'rollback' ? null : { plan, network: approval.network };
      }
      this.cached = null;
      messages.push(
        approval.operation === 'rollback'
          ? 'The reviewed backup was restored. Reopen the affected coding agent.'
          : 'The approved configuration was saved and checked. Reopen the affected coding agent to load it.',
      );
      messages.push(
        'Keep using the agent normally. The dashboard reads available measurements automatically; it does not need to stay open for the configured integration to operate.',
      );
      this.record(
        `${approval.description} applied and verified against its configuration checks.`,
        'success',
      );
      return {
        ok: true,
        title: approval.operation === 'rollback' ? 'Backup restored' : 'Changes applied',
        messages,
        appliedPlans,
      };
    });
  }
  async verify(): Promise<GuideResult> {
    return this.exclusive(async () => {
      this.record('Checking the configured integrations without changing them.', 'working');
      const messages: string[] = [];
      let ok = true;
      const inventory = await this.call<DoctorReport>(['doctor']);
      const present = (inventory.data?.harnesses ?? []).filter(
        (item) => item.state !== 'absent' && ['claude', 'codex'].includes(item.harnessId),
      );
      if (present.length === 0) {
        ok = false;
        messages.push(
          'No supported installed agent could be checked. Refresh after installing or signing in.',
        );
      }
      for (const agent of present) {
        const harness = agent.harnessId;
        const result = await this.call<VerifyReport>(['verify', '--harness', harness]);
        const healthy = result.data?.healthyAtDeclaredTier === true;
        if (!healthy) ok = false;
        messages.push(
          `${name(harness)}: ${
            healthy
              ? 'the available integration checks passed. This is not proof that every command was reduced.'
              : explainGuideIssue(
                  result.diagnostics,
                  'execution could not be fully confirmed. The agent may be absent, an integration may not be enabled, or runtime evidence may be unavailable.',
                )
          }`,
        );
      }
      this.cached = null;
      this.record(
        'Integration checks completed. No settings changed.',
        ok ? 'success' : 'attention',
      );
      return { ok, title: 'Integration checks', messages, appliedPlans: 0 };
    });
  }
}
