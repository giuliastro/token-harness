/** Guided product workflow. Only fixed commands reach the existing transaction engine. */
import {
  buildOptimizationStack,
  providerId,
  selectStackCombinationReview,
  type ApplyReport,
  type BudgetReport,
  type CliEnvelope,
  type ContextReport,
  type HarnessContextObservation,
  type Diagnostic,
  type DoctorReport,
  type MetricsReport,
  type OptimizationComponentDescriptor,
  type OptimizationStackSnapshot,
  type PlanReport,
  type PlannedAction,
  type StatusReport,
  type TaskBenchmarkContextMatrixReport,
  type UpdateReport,
  type VerifyReport,
} from '@token-harness/core';
import { run, DEFAULT_COMMANDS, type RunOptions } from './run.js';
import type { AgentSkillObservation } from './agent-skill.js';
import { runMetrics } from './commands/metrics.js';
import { runUpdateCheck } from './commands/update.js';
import { savingsImpact, type GuideImpact } from './guided-impact.js';
import { guidedValueEvidence, type GuideValueEvidence } from './guided-value.js';
import { SHIPPED_STACK_COMBINATION_REVIEWS } from './stack-combination-reviews.js';

export type GuidePeriod = 'all' | '7d' | '30d';
export type GuideHarness = 'claude' | 'codex';
export type GuideTask = 'mechanical' | 'standard' | 'hard' | 'critical';
export type GuideCall = <T>(args: readonly string[]) => Promise<CliEnvelope<T>>;
export interface GuideAction {
  kind: 'setup' | 'effort' | 'skill' | 'verify' | 'help' | 'refresh';
  label: string;
  harness?: GuideHarness;
  topic?:
    | 'claude-effort'
    | 'codex-effort'
    | 'claude-tools'
    | 'codex-tools'
    | 'measurements'
    | 'cclimits'
    | 'python'
    | 'claude-login'
    | 'compatibility';
}
export interface GuideReasoning {
  label: string;
  value: string | null;
  state: 'saved' | 'default' | 'unavailable';
  description: string;
  observed: string;
  changeNote: string;
  action: GuideAction;
}
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
  next?: string;
  action?: GuideAction;
}
export interface GuideGuidance {
  state: 'managed' | 'external' | 'absent' | 'conflict' | 'unavailable';
  label: string;
  description: string;
  action?: GuideAction;
}
export interface GuideAgent {
  id: GuideHarness;
  name: string;
  version: string | null;
  configured: boolean;
  state: string;
  providers: string[];
  effort: string | null;
  reasoning: GuideReasoning;
  guidance?: GuideGuidance;
  allowanceAction: GuideAction;
  rules: GuideRule[];
  allowance: Array<{
    label: string;
    remaining: number | null;
    resetsAt: string | null;
    source: string;
  }>;
  allowanceNote: string;
  pending?: Array<'reasoning' | 'allowance'>;
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
    impact: GuideImpact;
  }>;
  errors: number;
  inflated: number;
  note: string;
}
export interface GuideOverview {
  generatedAt: string;
  agents: GuideAgent[];
  stack: OptimizationStackSnapshot;
  savings: GuideSavings;
  value: GuideValueEvidence;
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
  stack?: OptimizationStackSnapshot;
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
  transactionId: string | null;
  provider: ReturnType<typeof providerId> | null;
  description: string;
  operation: 'apply' | 'rollback' | 'uninstall';
  network: boolean;
}
type GuideUndoTarget =
  | { kind: 'plan'; plan: string; network: boolean }
  | {
      kind: 'transaction';
      transactionId: string;
      provider: ReturnType<typeof providerId>;
      network: false;
    };
interface GuideStackBase {
  detections: DoctorReport['providers'];
  metrics: MetricsReport | null;
  drift: StatusReport['drift'];
  fingerprint: string;
}
interface GuideVerificationEvidence {
  fingerprint: string;
  report: VerifyReport;
}
interface GuideUpdateEvidence {
  fingerprint: string;
  report: UpdateReport;
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
const STACK_COMPONENTS: readonly OptimizationComponentDescriptor[] = [
  {
    providerId: providerId('rtk'),
    displayName: 'RTK',
    category: 'command-output-reduction',
  },
  {
    providerId: providerId('harnesstrim'),
    displayName: 'HarnessTrim',
    category: 'command-output-reduction',
  },
];
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

function stackFingerprint(report: DoctorReport): string {
  const harnesses = report.harnesses
    .filter((item) => item.harnessId === 'claude' || item.harnessId === 'codex')
    .map((item) => ({
      id: item.harnessId,
      state: item.state,
      version: item.version,
      versionVerdict: item.versionVerdict,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const providers = report.providers
    .map((item) => ({
      id: item.providerId,
      state: item.state,
      version: item.version,
      versionVerdict: item.versionVerdict,
      managedByTokenHarness: item.managedByTokenHarness,
      configuredHarnesses: [...item.configuredHarnesses].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({ harnesses, providers });
}

/** JSON is parsed before exit codes; a refused change is still a meaningful report. */
export function createGuideCall(base: Omit<RunOptions, 'argv' | 'streams'>): GuideCall {
  return async <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
    const savings = args[0] === 'savings';
    const updateCheck = args[0] === 'update';
    const translated = savings ? ['metrics', ...args.slice(1)] : [...args];
    let stdout = '';
    await run({
      ...base,
      argv: [...translated, '--json'],
      ...(savings || updateCheck
        ? {
            commands: {
              ...DEFAULT_COMMANDS,
              ...(savings
                ? {
                    metrics: (context) =>
                      runMetrics({
                        ...context,
                        metricsAllProjects: true,
                        since: context.since ?? '1970-01-01',
                      }),
                  }
                : {}),
              ...(updateCheck ? { update: runUpdateCheck } : {}),
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
        impact: savingsImpact(row, {
          start: report?.windowStart ?? '',
          end: report?.windowEnd ?? '',
          all: period === 'all',
        }),
      })),
    errors: report?.errors ?? 0,
    inflated: report?.inflatedOperations ?? 0,
    note: 'These are recorded output reductions, not money saved or extra subscription allowance. Provider results are kept separate. Simulations are excluded. Available history may predate Token Harness.',
  };
}

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

/** Show a saved value even when writes are unreviewed. Never infer the active session. */
export function reasoningView(
  id: GuideHarness,
  observation: HarnessContextObservation | undefined,
): GuideReasoning {
  const native = observation?.nativeEffort;
  const raw = id === 'claude' ? native?.current : observation?.reasoningEffort;
  const value = raw && Object.hasOwn(EFFORT_LABELS, raw) ? raw : null;
  const unset =
    id === 'claude' &&
    (native?.preferenceState === 'unset' ||
      (native?.preferenceState === undefined && native?.writable && native.current === null));
  const origin = observation?.managedConfigFieldOrigins?.find(
    (item) => item.keyPath === 'model_reasoning_effort',
  );
  const canEdit =
    id === 'claude'
      ? native?.writable === true
      : observation?.managedConfigTarget != null &&
        observation.managedConfigOriginsObserved &&
        (origin === undefined || origin.matchesManagedTarget);
  const action: GuideAction = canEdit
    ? { kind: 'effort', label: 'Adjust reasoning', harness: id }
    : {
        kind: 'help',
        label: id === 'claude' ? 'Change in Claude' : 'Change in Codex',
        harness: id,
        topic: id === 'claude' ? 'claude-effort' : 'codex-effort',
      };
  const description =
    value !== null
      ? id === 'claude'
        ? 'Saved user preference. A running session or another settings layer can use a different level.'
        : 'Read from effective Codex configuration. This is not a live session reading.'
      : unset
        ? 'No reasoning preference is saved in Claude user settings. The model default or another settings layer may apply.'
        : id === 'claude'
          ? (native?.preferenceReason ??
            'The Claude preference reader is unavailable. This does not mean reasoning is disabled.')
          : 'Codex did not expose a recognized reasoning preference. Check its model controls to see the current session level.';
  return {
    label:
      value !== null
        ? EFFORT_LABELS[value]!
        : unset
          ? 'No saved preference'
          : 'Could not read preference',
    value,
    state: value !== null ? 'saved' : unset ? 'default' : 'unavailable',
    description,
    observed:
      id === 'claude'
        ? native == null
          ? 'No user preference observation is available. No active session was inspected.'
          : (value !== null || unset
              ? 'Claude user settings inspected'
              : 'Claude user settings not readable') +
            ' (CLI ' +
            native.harnessVersion +
            '). The active session was not inspected.'
        : 'Source: Codex configuration reader. Running-session overrides are not observed here.',
    changeNote: canEdit
      ? 'Choose Adjust reasoning, select your work, then review and approve the change. It stays saved for future sessions until changed again.'
      : id === 'claude'
        ? (native?.reason || 'No reviewed preference change is available from this app.') +
          ' Open Claude and use /effort to inspect or change the level there; then refresh this page.'
        : 'This app cannot safely change the effective setting. Open Codex and use /model to review the reasoning controls; then refresh this page.',
    action,
  };
}
function allowanceAction(diagnostics: readonly Diagnostic[]): GuideAction {
  const codes = new Set(diagnostics.map((entry) => entry.code));
  if (
    codes.has('cclimits-not-installed') ||
    codes.has('cclimits-readonly-flags-unsupported') ||
    codes.has('cclimits-claude-source-unsupported')
  )
    return { kind: 'help', label: 'Set up allowance reader', topic: 'cclimits' };
  if (codes.has('cclimits-python-unavailable'))
    return { kind: 'help', label: 'Fix Python setup', topic: 'python' };
  if (
    codes.has('cclimits-claude-credentials-unavailable') ||
    codes.has('cclimits-claude-token-expired')
  )
    return { kind: 'help', label: 'Sign-in instructions', topic: 'claude-login' };
  return { kind: 'help', label: 'Resolve missing data', topic: 'compatibility' };
}
function guidanceView(id: GuideHarness, observation: AgentSkillObservation): GuideGuidance {
  const labels: Record<AgentSkillObservation['state'], string> = {
    managed: 'Enabled',
    external: 'Enabled externally',
    absent: 'Not enabled',
    conflict: 'Custom skill found',
    unavailable: 'Not verified',
  };
  return {
    state: observation.state,
    label: labels[observation.state],
    description: observation.detail,
    ...(observation.state === 'absent'
      ? { action: { kind: 'skill' as const, label: 'Enable in-session guidance', harness: id } }
      : {}),
  };
}

function agentRules(
  id: GuideHarness,
  providers: string[],
  context: ContextReport | null,
  guidance?: GuideGuidance,
): GuideRule[] {
  const observation = context?.harnesses.find((item) => item.harnessId === id);
  const reasoning = reasoningView(id, observation);
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
              ? 'Filters output from supported shell commands before the agent reads it. It removes routine noise, not the command itself.'
              : 'Shortens supported output through the installed adapter or agent instructions. A skills-only installation needs the agent to invoke the reducer.',
          why: 'Less routine output occupies less context. Coverage and retained diagnostics depend on the provider and command.',
          evidence:
            'Integration configuration was found. This is not proof that every command was intercepted. Recorded savings are separate measurements.',
          next:
            provider === 'rtk'
              ? 'Keep using your agent normally. Check integrations here, then look at Recorded savings after running commands.'
              : 'Check the integration first. Open Measurement help for how to enable local records or use a skills-only installation.',
          action:
            provider === 'rtk'
              ? { kind: 'verify', label: 'Check integrations', harness: id }
              : { kind: 'help', label: 'Measurement help', harness: id, topic: 'measurements' },
        }),
      ),
    ...(!providers.length
      ? [
          {
            id: `${id}-setup`,
            title: 'Output reduction',
            state: 'Not configured',
            mode: 'not-enabled' as const,
            what: 'No configured output optimizer was detected for this agent.',
            why: 'A supported integration is needed before automatic output reduction can run.',
            evidence: 'No configured provider reported this agent.',
            next: 'Check setup to preview supported integration changes. Nothing is installed or changed without your approval.',
            action: { kind: 'setup' as const, label: 'Check setup', harness: id },
          },
        ]
      : []),
    {
      id: `${id}-effort`,
      title: 'Reasoning effort',
      state: reasoning.label,
      mode: 'preference',
      what: reasoning.description,
      why: 'Simple tasks may need less reasoning. Difficult work needs enough reasoning to avoid repeated failed attempts.',
      evidence: reasoning.observed,
      next: reasoning.changeNote,
      action: reasoning.action,
    },
    {
      id: `${id}-guidance`,
      title: 'In-session Token Harness guidance',
      state: guidance?.label ?? 'Optional',
      mode: guidance?.state === 'absent' ? 'not-enabled' : 'integration',
      what:
        guidance?.description ??
        (id === 'claude'
          ? 'Installs the portable Token Harness Agent Skill in ~/.claude/skills/token-harness so Claude can consult the local controller when a task needs it.'
          : 'Installs the portable Token Harness Agent Skill in ~/.agents/skills/token-harness so Codex can consult the local controller when a task needs it.'),
      why: 'The harness can ask Token Harness for quota-aware, quality-gated advice without making advanced CLI flags the human workflow.',
      evidence:
        guidance?.state === 'managed'
          ? 'Live bytes match the bundled skill and the latest relevant committed transaction still owns that file.'
          : guidance?.state === 'external'
            ? 'The live file matches the bundled skill, but Token Harness has no current ownership claim and will not remove or replace it automatically.'
            : 'Installation is local, previewed and transactional. An existing token-harness skill directory is never overwritten or silently adopted.',
      next:
        guidance?.state === 'managed'
          ? 'Keep coding normally. Ask the agent to use Token Harness when you want an explicit quota-aware check.'
          : guidance?.state === 'external'
            ? 'The matching skill can be used as-is. Token Harness keeps it user-owned.'
            : guidance?.state === 'conflict'
              ? 'Review the existing skill manually. Token Harness will not overwrite it.'
              : 'Enable this once, then keep coding normally. Ask the agent to use Token Harness for a task when you want an explicit check.',
      ...(guidance?.action ? { action: guidance.action } : {}),
    },
    {
      id: `${id}-mcp`,
      title: 'Connected tools',
      state:
        observation === undefined || !['observed', 'partial'].includes(observation.state)
          ? 'Inventory unavailable'
          : `${observation.mcpServers.length}${observation.mcpInventoryTruncated ? '+' : ''} connections`,
      mode: 'observation',
      what: 'Lists connected tool servers. It does not remove tools or decide which ones your task needs.',
      why: 'Large tool inventories can occupy context, but a count alone does not justify disabling a tool.',
      evidence:
        observation === undefined
          ? 'No tool inventory returned.'
          : 'Source: installed agent tool inventory. Per-task usage is not measured.',
      next: 'Open the agent tool settings to inspect connections or fix authentication. Disable a tool only when you know the task does not need it.',
      action: {
        kind: 'help',
        label: 'Manage connected tools',
        harness: id,
        topic: id === 'claude' ? 'claude-tools' : 'codex-tools',
      },
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
    next: 'Use Adjust reasoning on an agent card, choose the type of work and approve the preview. Reopen that agent to load the saved preference.',
    action: { kind: 'effort', label: 'Choose task settings' },
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
    next: 'Review the task settings for a supported agent. When session context is too large, compact it inside that agent; nothing is cleared from this dashboard.',
    action: { kind: 'help', label: 'Session and tool guidance', topic: 'compatibility' },
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

type GuideRead<T> = Pick<CliEnvelope<T>, 'data' | 'diagnostics' | 'exitCode'>;
type GuideStageId = 'agents' | 'allowance' | 'rules' | 'savings' | 'checks' | 'value';
export interface GuideLoading {
  run: number;
  period: GuidePeriod;
  startedAt: string;
  running: boolean;
  stages: Array<{ id: GuideStageId; label: string; state: 'working' | 'ready' | 'attention' }>;
  agents: GuideAgent[] | null;
  savings: GuideSavings | null;
}
const READ_STAGES: Array<{ id: GuideStageId; label: string }> = [
  { id: 'agents', label: 'Finding agents and output integrations' },
  { id: 'allowance', label: 'Checking allowance with agents and companions' },
  { id: 'rules', label: 'Reading saved preferences and connected tools' },
  { id: 'savings', label: 'Importing recorded reductions' },
  { id: 'checks', label: 'Checking integration configuration' },
  { id: 'value', label: 'Reading paired allowance and quality evidence' },
];

export class GuideService {
  private approval: Approval | null = null;
  private loading: GuideLoading | null = null;
  private readSequence = 0;
  private busy = false;
  private lastApplied: GuideUndoTarget | null = null;
  private reading: Promise<GuideOverview> | null = null;
  private cached: { at: number; period: GuidePeriod; value: GuideOverview } | null = null;
  private stackBase: GuideStackBase | null = null;
  private verification: GuideVerificationEvidence | null = null;
  private updates: GuideUpdateEvidence | null = null;
  private readonly activity: GuideActivity[] = [];
  private readonly call: GuideCall;
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly observeGuidance:
    | ((harness: GuideHarness) => Promise<AgentSkillObservation>)
    | null;
  constructor(
    call: GuideCall,
    now: () => number,
    random: () => string,
    observeGuidance: ((harness: GuideHarness) => Promise<AgentSkillObservation>) | null = null,
  ) {
    this.call = call;
    this.now = now;
    this.random = random;
    this.observeGuidance = observeGuidance;
  }
  status(): {
    busy: boolean;
    activity: GuideActivity[];
    canUndo: boolean;
    loading: GuideLoading | null;
  } {
    return {
      busy: this.busy,
      activity: [...this.activity],
      canUndo: this.lastApplied !== null,
      loading: this.loading === null ? null : structuredClone(this.loading),
    };
  }
  private record(message: string, state: GuideActivity['state']): void {
    this.activity.unshift({ at: new Date(this.now()).toISOString(), message, state });
    this.activity.splice(30);
  }
  private stackSnapshot(): OptimizationStackSnapshot {
    const base = this.stackBase;
    return buildOptimizationStack({
      components: STACK_COMPONENTS,
      detections: base?.detections ?? [],
      verification:
        base !== null && this.verification?.fingerprint === base.fingerprint
          ? this.verification.report
          : null,
      metrics: base?.metrics ?? null,
      updates:
        base !== null && this.updates?.fingerprint === base.fingerprint
          ? this.updates.report.providers
          : null,
      unattributedDrift: base?.drift ?? [],
      combinationReview: selectStackCombinationReview(
        SHIPPED_STACK_COMBINATION_REVIEWS,
        base?.detections ?? [],
      ),
    });
  }
  private invalidateObservedState(): void {
    this.cached = null;
    this.stackBase = null;
    this.verification = null;
    this.updates = null;
  }
  async overview(period: GuidePeriod = 'all', force = false): Promise<GuideOverview> {
    if (!PERIODS.has(period)) throw new GuideError(400, 'Choose all history, 7 days or 30 days.');
    if (force) this.cached = null;
    if (this.busy && this.cached !== null) return this.cached.value;
    if (this.busy) throw new GuideError(409, 'A reviewed change is in progress.');
    if (this.cached?.period === period && this.now() - this.cached.at < 15_000)
      return this.cached.value;
    if (this.reading !== null) {
      await this.reading;
      return this.overview(period, force);
    }
    this.reading = this.collect(period);
    try {
      const value = await this.reading;
      this.cached = { value, at: this.now(), period };
      return value;
    } finally {
      this.reading = null;
      if (this.loading !== null) this.loading.running = false;
    }
  }
  private async collect(period: GuidePeriod): Promise<GuideOverview> {
    const loading: GuideLoading = {
      run: ++this.readSequence,
      period,
      startedAt: new Date(this.now()).toISOString(),
      running: true,
      stages: READ_STAGES.map((stage) => ({ ...stage, state: 'working' })),
      agents: null,
      savings: null,
    };
    this.loading = loading;
    const empty = <T>(): GuideRead<T> => ({ data: null, diagnostics: [], exitCode: 9 });
    let doctor = empty<DoctorReport>(),
      budget = empty<BudgetReport>(),
      context = empty<ContextReport>();
    let guidance: Partial<Record<GuideHarness, GuideGuidance>> | undefined;
    const observe = async <T>(id: GuideStageId, args: string[]): Promise<GuideRead<T>> => {
      let result: GuideRead<T>;
      try {
        result = await this.call<T>(args);
      } catch {
        result = empty<T>();
      } // Only bounded UI copy; never leak a subprocess error or private path.
      const stage = loading.stages.find((item) => item.id === id)!;
      stage.state =
        result.data === null ||
        result.exitCode !== 0 ||
        result.diagnostics.some((item) => item.severity === 'warning' || item.severity === 'error')
          ? 'attention'
          : 'ready';
      return result;
    };
    const updateAgents = (): void => {
      if (doctor.data === null) return;
      loading.agents = this.agentView(
        doctor,
        budget,
        context,
        {
          rules: loading.stages.find((item) => item.id === 'rules')?.state !== 'working',
          allowance: loading.stages.find((item) => item.id === 'allowance')?.state !== 'working',
        },
        guidance,
      );
    };
    const [, , , metrics, status, benchmark] = await Promise.all([
      observe<DoctorReport>('agents', ['doctor']).then((result) => {
        doctor = result;
        updateAgents();
      }),
      observe<BudgetReport>('allowance', ['budget']).then((result) => {
        budget = result;
        updateAgents();
      }),
      observe<ContextReport>('rules', ['context']).then(async (result) => {
        context = result;
        if (this.observeGuidance !== null) {
          guidance = {};
          await Promise.all(
            (['claude', 'codex'] as const).map(async (harness) => {
              try {
                guidance![harness] = guidanceView(harness, await this.observeGuidance!(harness));
              } catch {
                guidance![harness] = {
                  state: 'unavailable',
                  label: 'Not verified',
                  description:
                    'The Agent Skill state could not be checked. No ownership is assumed.',
                };
              }
            }),
          );
        }
        updateAgents();
      }),
      observe<MetricsReport>('savings', [
        'savings',
        '--since',
        period === 'all' ? '1970-01-01' : period,
      ]).then((result) => {
        loading.savings = savingsView(result.data, period);
        return result;
      }),
      observe<StatusReport>('checks', ['status']),
      observe<TaskBenchmarkContextMatrixReport>('value', ['benchmark-matrix']),
    ]);
    const agents = this.agentView(
      doctor,
      budget,
      context,
      { rules: true, allowance: true },
      guidance,
    );
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
    if (status.data === null)
      notices.push(
        'The integration configuration check could not finish. Use Check integrations in Activity to try again. No agent settings changed.',
      );
    if ((status.data?.problemCount ?? 0) > 0)
      notices.push(
        'An integration has changed or needs verification. Use Check integrations in Activity; existing settings are not repaired silently.',
      );
    this.stackBase =
      doctor.data === null
        ? null
        : {
            detections: [...doctor.data.providers],
            metrics: metrics.data,
            drift: [...(status.data?.drift ?? [])],
            fingerprint: stackFingerprint(doctor.data),
          };
    return {
      generatedAt: new Date(this.now()).toISOString(),
      agents,
      stack: this.stackSnapshot(),
      savings: savingsView(metrics.data, period),
      value: guidedValueEvidence(benchmark.data),
      rules: [...SAFETY_RULES, ...TASK_RULES],
      notices,
    };
  }
  private agentView(
    doctor: GuideRead<DoctorReport>,
    budget: GuideRead<BudgetReport>,
    context: GuideRead<ContextReport>,
    complete: { rules: boolean; allowance: boolean },
    guidance?: Partial<Record<GuideHarness, GuideGuidance>>,
  ): GuideAgent[] {
    const present = (doctor.data?.harnesses ?? []).filter(
      (item) =>
        item.state !== 'absent' && (item.harnessId === 'claude' || item.harnessId === 'codex'),
    );
    return present.map((agent): GuideAgent => {
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
        pending: [
          ...(!complete.rules ? ['reasoning' as const] : []),
          ...(!complete.allowance ? ['allowance' as const] : []),
        ],
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
        reasoning: reasoningView(agent.harnessId as GuideHarness, observed),
        ...(guidance?.[agent.harnessId as GuideHarness]
          ? { guidance: guidance[agent.harnessId as GuideHarness] }
          : {}),
        allowanceAction: allowanceAction(usage?.diagnostics ?? []),
        rules: agentRules(
          agent.harnessId as GuideHarness,
          providers,
          context.data,
          guidance?.[agent.harnessId as GuideHarness],
        ),
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
      Object.keys(data).some((key) => !['action', 'harness', 'task', 'provider'].includes(key)) ||
      !['setup', 'effort', 'skill', 'undo', 'remove'].includes(String(data['action'])) ||
      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||
      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||
      (data['provider'] !== undefined &&
        !['rtk', 'harnesstrim'].includes(String(data['provider']))) ||
      (data['action'] === 'effort' &&
        (data['harness'] === undefined || data['task'] === undefined)) ||
      (data['action'] === 'skill' && data['harness'] === undefined) ||
      (data['action'] === 'remove' &&
        (data['provider'] === undefined ||
          data['harness'] !== undefined ||
          data['task'] !== undefined)) ||
      (data['action'] !== 'remove' && data['provider'] !== undefined)
    )
      throw new GuideError(400, 'Choose a supported agent and task.');
    return this.exclusive(async () => {
      this.approval = null;
      if (data['action'] === 'undo') {
        if (data['harness'] !== undefined || data['task'] !== undefined)
          throw new GuideError(400, 'Undo accepts no agent or task selection.');
        if (this.lastApplied === null)
          throw new GuideError(409, 'There is no change from this dashboard session to undo.');
        const target = this.lastApplied;
        const transactionUndo = target.kind === 'transaction';
        const ticket = this.random(),
          expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: target.kind === 'plan' ? [target.plan] : [],
          transactionId: target.kind === 'transaction' ? target.transactionId : null,
          provider: null,
          description:
            target.kind === 'transaction' ? `${name(target.provider)} removal undo` : 'Undo',
          operation: 'rollback',
          network: target.network,
        };
        return {
          ticket,
          title: transactionUndo
            ? `Restore the removed ${name(target.provider)} integration?`
            : 'Restore the last change?',
          changes: [
            {
              title: transactionUndo
                ? `Restore the ${name(target.provider)} removal transaction`
                : 'Restore the last successful transaction from this dashboard',
              files: 0,
              description: transactionUndo
                ? 'Restores the complete configuration-file snapshots recorded by that uninstall transaction. Drift checks still apply; if another transaction committed afterward, this Undo is refused rather than rolling back history out of order.'
                : 'Restores complete configuration files from their backups. Any manual edits made to those files after applying will also be undone. If another transaction occurred, this undo is refused.',
            },
          ],
          notices: transactionUndo
            ? [
                `This Undo is bound to the exact ${name(target.provider)} removal transaction created by this dashboard session. The browser cannot choose another transaction id.`,
              ]
            : [
                'For a multi-agent setup, this restores only the last successful agent transaction, not the whole group. Earlier transactions remain in place.',
              ],
          expiresAt: new Date(expires).toISOString(),
          network: target.network,
          restart: true,
        };
      }
      if (data['action'] === 'remove') {
        const provider = providerId(String(data['provider']));
        this.record(
          `Reviewing Token Harness-owned ${name(provider)} changes. Nothing is being removed yet.`,
          'working',
        );
        const result = await this.call<ApplyReport>(['uninstall', '--provider', provider]);
        const removable = result.diagnostics.some(
          (entry) => entry.code === 'confirmation-required',
        );
        if (!removable) {
          const message = explainGuideIssue(
            result.diagnostics,
            result.data?.outcome === 'nothing-to-do'
              ? `${name(provider)} has no Token Harness-owned change to remove. User-owned configuration is left alone.`
              : `No safe ${name(provider)} removal is available. Nothing was changed.`,
          );
          this.record(message, result.exitCode === 0 ? 'success' : 'attention');
          return {
            ticket: null,
            title: 'No managed change to remove',
            changes: [],
            notices: [message],
            expiresAt: null,
            network: false,
            restart: false,
          };
        }
        const ticket = this.random();
        const expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: [],
          transactionId: null,
          provider,
          description: `${name(provider)} removal`,
          operation: 'uninstall',
          network: false,
        };
        this.record('Removal preview ready. Waiting for your approval.', 'success');
        return {
          ticket,
          title: `Remove the managed ${name(provider)} integration?`,
          changes: [
            {
              title: `${name(provider)}: remove Token Harness-owned integration`,
              files: 0,
              description:
                'Runs the existing ownership-aware uninstall transaction. Only entries recorded as owned by Token Harness are eligible; user-owned matching configuration is not removed, and edits that invalidate ownership preconditions block the removal.',
            },
          ],
          notices: [
            'The approval will re-run ownership and drift checks before removing anything. No provider update, install, model, login or billing setting is changed.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network: false,
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
        this.record(
          `Preparing supported changes for ${name(agent.harnessId)}. No settings changed.`,
          'working',
        );
        const args = ['plan', '--harness', agent.harnessId];
        if (data['action'] === 'skill') {
          args.push('--provider', 'none', '--agent-skill');
        } else if (data['action'] === 'effort')
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
                : data['action'] === 'skill'
                  ? 'In-session guidance is already present, or an existing user-owned skill location was left untouched.'
                  : 'No safe setup change is available. The integration may already be configured, or a required provider is not installed.',
            )}`,
          );
          continue;
        }
        plans.push(report.planId);
        if (data['action'] === 'skill') {
          changes.push({
            title: `${name(agent.harnessId)}: enable in-session guidance`,
            description:
              'Installs one reviewed Token Harness Agent Skill in the standard user skill directory. It does not change model, login, billing, hooks, trust, or the current conversation.',
            files: 1,
          });
        } else {
          changes.push(...report.actions.map((action) => describeChange(action, agent.harnessId)));
        }
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
          transactionId: null,
          provider: null,
          description:
            data['action'] === 'effort'
              ? 'Task preference'
              : data['action'] === 'skill'
                ? 'In-session guidance'
                : 'Integration setup',
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
        restart: data['action'] === 'effort' || data['action'] === 'skill',
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
      if (approval.operation === 'uninstall') {
        if (approval.provider === null)
          throw new GuideError(409, 'This removal preview is incomplete. Review it again.');
        const provider = approval.provider;
        this.record(
          `Removing only Token Harness-owned ${name(provider)} integration changes.`,
          'working',
        );
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>(['uninstall', '--provider', provider, '--yes']);
        } catch {
          this.invalidateObservedState();
          const message =
            'The removal stopped before its final result could be read. No automatic retry was made. Refresh and inspect the current integration state.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Removal result needs checking',
            messages: [message],
            appliedPlans: 0,
          };
        }
        if (result.exitCode !== 0 || result.data?.outcome !== 'committed') {
          const message = explainGuideIssue(
            result.diagnostics,
            'The managed integration was not removed. Ownership or configuration changed after the preview, so nothing was forced.',
          );
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Integration was not removed',
            messages: [message],
            appliedPlans: 0,
          };
        }
        const transactionId = result.data.transactionId;
        this.lastApplied =
          transactionId === null
            ? null
            : { kind: 'transaction', transactionId, provider, network: false };
        this.invalidateObservedState();
        const messages = [
          `${name(provider)} Token Harness-owned integration changes were removed transactionally. User-owned matching configuration was not targeted.`,
          transactionId === null
            ? 'The removal completed, but no transaction identifier was returned, so this dashboard will not offer an unsafe Undo. Inspect transaction history before restoring anything.'
            : 'Undo is available for this exact removal transaction. If another transaction commits first, the restore will be refused.',
          'Reopen affected coding agents, then Refresh to confirm the current optimization stack.',
        ];
        this.record(`${name(provider)} managed integration removed.`, 'success');
        return { ok: true, title: 'Integration removed', messages, appliedPlans: 1 };
      }
      this.record(
        approval.operation === 'rollback'
          ? 'Restoring the reviewed configuration backup.'
          : 'Backing up and applying exactly the changes you approved.',
        'working',
      );
      const messages: string[] = [];
      let appliedPlans = 0;
      const steps =
        approval.operation === 'rollback' && approval.transactionId !== null
          ? [
              {
                plan: null,
                args: ['rollback', '--transaction', approval.transactionId, '--yes'],
              },
            ]
          : approval.plans.map((plan) => ({
              plan,
              args: [approval.operation, '--plan', plan, '--yes'],
            }));
      for (const step of steps) {
        this.record(
          `${approval.operation === 'rollback' ? 'Restoring' : 'Applying'} reviewed change ${appliedPlans + 1} of ${steps.length}. The transaction runs its backup and safety checks.`,
          'working',
        );
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>(step.args);
        } catch {
          this.invalidateObservedState();
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
          this.invalidateObservedState();
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
          approval.operation === 'rollback'
            ? null
            : step.plan === null
              ? null
              : { kind: 'plan', plan: step.plan, network: approval.network };
      }
      this.invalidateObservedState();
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
  async checkUpdates(): Promise<GuideResult> {
    return this.exclusive(async () => {
      this.record('Checking provider update channels without changing software.', 'working');
      const updateResult = await this.call<UpdateReport>(['update']);
      const inventory = await this.call<DoctorReport>(['doctor']);

      if (inventory.data === null) {
        this.updates = null;
        const message =
          'The current optimizer versions could not be re-read, so update evidence was not attached to the stack. No software changed.';
        this.record(message, 'attention');
        return {
          ok: false,
          title: 'Update check needs attention',
          messages: [message],
          appliedPlans: 0,
        };
      }

      const fingerprint = stackFingerprint(inventory.data);
      this.stackBase = {
        detections: [...inventory.data.providers],
        metrics: this.stackBase?.metrics ?? null,
        drift: this.stackBase?.drift ?? [],
        fingerprint,
      };

      if (updateResult.exitCode !== 0 || updateResult.data === null) {
        this.updates = null;
        const message = explainGuideIssue(
          updateResult.diagnostics,
          'The update channels could not be checked safely. No software changed and no automatic retry was made.',
        );
        const stack = this.stackSnapshot();
        if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
        this.record(message, 'attention');
        return {
          ok: false,
          title: 'Update check needs attention',
          messages: [message],
          appliedPlans: 0,
          stack,
        };
      }

      this.updates = { fingerprint, report: updateResult.data };
      const available = updateResult.data.providers.filter((row) => row.verdict === 'upgradable');
      const blocked = updateResult.data.providers.filter(
        (row) => row.verdict === 'blocked-unreviewed',
      );
      const messages: string[] = [];
      if (available.length > 0) {
        messages.push(
          ...available.map(
            (row) =>
              `${name(row.providerId)}: ${row.installed ?? 'installed version'} → ${row.available ?? 'new version'} is available. Run token-harness update to review the dry-run; applying still requires explicit approval.`,
          ),
        );
      }
      if (blocked.length > 0) {
        messages.push(
          ...blocked.map(
            (row) =>
              `${name(row.providerId)}: ${row.available ?? 'a newer version'} exists, but Token Harness is keeping ${row.installed ?? 'the installed version'} until that combination has reviewed compatibility evidence.`,
          ),
        );
      }
      if (available.length === 0 && blocked.length === 0)
        messages.push(
          'No reviewed provider update is currently available. Pins and unavailable channels remain visible in the stack.',
        );
      messages.push(
        'This was a read-only channel check. No provider was installed, updated, downgraded or enabled.',
      );

      const stack = this.stackSnapshot();
      if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
      this.record('Provider update check completed. No software changed.', 'success');
      return { ok: true, title: 'Optimizer update check', messages, appliedPlans: 0, stack };
    });
  }

  async verify(): Promise<GuideResult> {
    return this.exclusive(async () => {
      this.record('Checking the configured integrations without changing them.', 'working');
      const messages: string[] = [];
      const results: VerifyReport['results'] = [];
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
        this.record(
          `Checking ${name(harness)} configuration and available execution evidence. No settings changed.`,
          'working',
        );
        const result = await this.call<VerifyReport>(['verify', '--harness', harness]);
        const healthy = result.data?.healthyAtDeclaredTier === true;
        if (!healthy) ok = false;
        if (result.data !== null) results.push(...result.data.results);
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
      if (inventory.data !== null) {
        const fingerprint = stackFingerprint(inventory.data);
        this.verification = {
          fingerprint,
          report: {
            receiptId: null,
            appliedAt: null,
            results,
            healthyAtDeclaredTier: ok,
          },
        };
        this.stackBase = {
          detections: [...inventory.data.providers],
          metrics: this.stackBase?.metrics ?? null,
          drift: this.stackBase?.drift ?? [],
          fingerprint,
        };
      } else {
        this.verification = null;
      }
      const stack = this.stackSnapshot();
      if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
      this.record(
        'Integration checks completed. No settings changed.',
        ok ? 'success' : 'attention',
      );
      return { ok, title: 'Integration checks', messages, appliedPlans: 0, stack };
    });
  }
}
