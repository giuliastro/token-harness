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
import type { SmartRoutingCommandReport } from './commands/smart-routing.js';
import { savingsImpact, type GuideImpact } from './guided-impact.js';
import { guidedValueEvidence, type GuideValueEvidence } from './guided-value.js';
import { SHIPPED_STACK_COMBINATION_REVIEWS } from './stack-combination-reviews.js';

export type GuidePeriod = 'all' | '7d' | '30d';
export type GuideHarness = 'claude' | 'codex';
export type GuideTask = 'mechanical' | 'standard' | 'hard' | 'critical';
export type GuideManagedProvider = 'rtk' | 'harnesstrim' | 'mcptoon' | 'gitnexus' | 'headroom';
export type GuideSetupTargetState = 'connected' | 'actionable' | 'unavailable' | 'not-applicable';
export interface GuideSetupTarget {
  providerId: GuideManagedProvider;
  provider: string;
  state: GuideSetupTargetState;
  reason: string;
}
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
export interface GuideRouting {
  state: 'off' | 'shadow' | 'conservative' | 'attention';
  mode: 'shadow' | 'conservative' | null;
  gatewayState: string;
  profileId: string | null;
  launchCommand: string | null;
  simpleModel: string | null;
  availableModels: string[];
  detail: string;
}
export interface GuideAgent {
  id: GuideHarness;
  name: string;
  version: string | null;
  configured: boolean;
  state: string;
  providers: string[];
  setup: GuideSetupTarget[];
  effort: string | null;
  reasoning: GuideReasoning;
  routing: GuideRouting;
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
    providerId: string;
    provider: string;
    measurement: string;
    unit: string;
    saved: number;
    before: number | null;
    after: number | null;
    operations: number;
    harnesses: string[];
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
  /** Present only after a read-only preview found a concrete change the user may approve. */
  ticket?: string | null;
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
  operation:
    | 'apply'
    | 'rollback'
    | 'uninstall'
    | 'update'
    | 'candidate-apply'
    | 'candidate-uninstall'
    | 'routing-configure'
    | 'routing-rollback';
  network: boolean;
  candidate?: 'mcptoon' | 'gitnexus';
  candidateHarness?: GuideHarness;
  routingHarness?: GuideHarness;
  routingMode?: 'shadow' | 'conservative';
  routingSimpleModel?: string;
  routingReplace?: boolean;
  updateTargets?: GuideUpdateTarget[];
}
type GuideUpdateTarget =
  | { kind: 'provider'; provider: ReturnType<typeof providerId>; version: string }
  | { kind: 'application'; version: string };
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
  mcptoon: 'mcptoon',
  gitnexus: 'GitNexus',
  headroom: 'Headroom',
  'token-harness': 'Token Harness',
};
const name = (id: string): string => NAMES[id] ?? id;
const guideUpdateTargetId = (target: GuideUpdateTarget): string =>
  target.kind === 'application' ? 'token-harness' : String(target.provider);
const guideUpdateTargetName = (target: GuideUpdateTarget): string =>
  target.kind === 'application' ? 'Token Harness' : name(String(target.provider));
function guideUpdateTargetRow(report: UpdateReport, target: GuideUpdateTarget) {
  return target.kind === 'application'
    ? report.application
    : report.providers.find((candidate) => candidate.providerId === target.provider);
}
const sameGuideVersion = (left: string | null, right: string | null): boolean =>
  left !== null &&
  right !== null &&
  left.replace(/^v/i, '').trim() === right.replace(/^v/i, '').trim();
const GUIDE_MANAGED_PROVIDERS: readonly GuideManagedProvider[] = [
  'rtk',
  'harnesstrim',
  'mcptoon',
  'gitnexus',
  'headroom',
];
const RECOMMENDED_SETUP_PROVIDERS: readonly GuideManagedProvider[] = ['rtk', 'harnesstrim'];

export function guideSetupTarget(
  report: DoctorReport,
  harness: GuideHarness,
  provider: GuideManagedProvider,
): GuideSetupTarget {
  const harnessDetection = report.harnesses.find((item) => item.harnessId === harness);
  const detection = report.providers.find((item) => item.providerId === provider);
  const label = name(provider);
  if (harnessDetection === undefined || harnessDetection.state === 'absent') {
    return {
      providerId: provider,
      provider: label,
      state: 'not-applicable',
      reason: `${name(harness)} is not currently detected.`,
    };
  }
  if (detection === undefined) {
    return {
      providerId: provider,
      provider: label,
      state: 'not-applicable',
      reason: `${label} is not a managed provider in this build.`,
    };
  }
  if (detection.configuredHarnesses.includes(harnessDetection.harnessId)) {
    return {
      providerId: provider,
      provider: label,
      state: 'connected',
      reason: `${label} is configured for ${name(harness)}.`,
    };
  }

  if (detection.state === 'absent' || detection.state === 'available') {
    if (detection.assignableHarnesses.includes(harnessDetection.harnessId)) {
      return {
        providerId: provider,
        provider: label,
        state: 'actionable',
        reason: `${label} is not installed yet, but Token Harness has a reviewed automatic install + ${name(harness)} setup path. The exact package and configuration changes are shown before approval.`,
      };
    }
    const prerequisite = detection.warnings.find(
      (entry) => entry.severity === 'warning' || entry.severity === 'error',
    );
    return {
      providerId: provider,
      provider: label,
      state: 'unavailable',
      reason:
        prerequisite === undefined
          ? `${label} is not installed and no automatic installer prerequisite is available in this terminal.`
          : `${prerequisite.message}${prerequisite.remediation === null ? '' : ` ${prerequisite.remediation}`}`,
    };
  }
  if (detection.state === 'broken') {
    return {
      providerId: provider,
      provider: label,
      state: 'unavailable',
      reason: `${label} is detected but its current integration needs attention before setup can continue.`,
    };
  }
  if (!detection.assignableHarnesses.includes(harnessDetection.harnessId)) {
    const capability = detection.warnings.find(
      (entry) => entry.severity === 'warning' || entry.severity === 'error',
    );
    return {
      providerId: provider,
      provider: label,
      state: 'not-applicable',
      reason:
        capability === undefined
          ? `The installed ${label} build does not expose an automatic ${name(harness)} setup surface.`
          : `${capability.message}${capability.remediation === null ? '' : ` ${capability.remediation}`}`,
    };
  }

  return {
    providerId: provider,
    provider: label,
    state: 'actionable',
    reason: `${label} can be configured automatically for ${name(
      harness,
    )}. Token Harness will apply it transactionally and re-check the resulting state.`,
  };
}

function guideSetupTargets(report: DoctorReport, harness: GuideHarness): GuideSetupTarget[] {
  return GUIDE_MANAGED_PROVIDERS.map((provider) => guideSetupTarget(report, harness, provider));
}

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
  {
    providerId: providerId('mcptoon'),
    displayName: 'mcptoon',
    category: 'mcp-discovery',
  },
  {
    providerId: providerId('gitnexus'),
    displayName: 'GitNexus',
    category: 'repository-retrieval',
  },
  {
    providerId: providerId('headroom'),
    displayName: 'Headroom',
    category: 'context-minimization',
  },
];
const ISSUE_COPY: Readonly<Record<string, string>> = {
  'ccr-simple-model-required':
    'Conservative routing needs a simple model selected from the models already configured in CCR.',
  'ccr-config-changed-during-operation':
    'CCR changed configuration while routing was being prepared. Token Harness preserved the latest CCR state instead of overwriting it; refresh and retry.',
  'ccr-profile-id-conflict':
    'A Token Harness routing profile already exists but its ownership cannot be verified. Disable or repair that routing state before enabling it again.',
  'ccr-management-operation-failed':
    'CCR rejected the routing configuration change. The existing routing state was left unchanged.',
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
    'Claude settings could not be changed safely. A project override, environment setting or changed writable surface may be in effect. Your settings were kept.',
  'native-policy-harness-unsupported':
    'This agent does not expose a writable setting surface for this action.',
  'codex-native-policy-unavailable':
    'Codex did not expose a writable, versioned user setting. No change is proposed.',
  'codex-native-policy-shadowed':
    'A project or profile overrides this Codex setting. That setting belongs to you and will not be replaced.',
  'no-providers-registered': 'No optimization provider was selected for this operation.',
  'already-in-desired-state':
    'The supported integration is already configured. Nothing needs to be changed.',
  'delegated-install-snapshot-too-large':
    'The optimizer setup found too much unrelated data inside its rollback boundary. Nothing was changed. Update Token Harness or use a narrower project directory before retrying.',
  'delegated-install-failed':
    'The optimizer installer itself did not complete successfully. Nothing was kept from the failed transaction.',
  'delegated-install-artifact-mismatch':
    'The optimizer installer completed but did not produce the artifact contract it advertised. The transaction was rolled back.',
  'delegated-install-protected-path-changed':
    'The optimizer installer touched a file this setup promised to leave alone. The transaction was rolled back.',
  'delegated-install-undeclared-write':
    'The optimizer installer changed a path outside the approved write set. The transaction was rolled back.',
  'action-precondition-drift':
    'A file changed after the preview was created. Review a fresh preview before applying anything.',
  'managed-mutation-unsupported':
    'Automatic setup is unavailable because the installed provider does not expose the required managed surface. Existing integrations are left untouched.',
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
    return 'The required automatic capability or safety precondition is not available in the current runtime. Your current settings are preserved.';
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
      assignableHarnesses: [...item.assignableHarnesses].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({ harnesses, providers });
}

/** JSON is parsed before exit codes; a refused change is still a meaningful report. */
export function createGuideCall(base: Omit<RunOptions, 'argv' | 'streams'>): GuideCall {
  return async <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
    const savings = args[0] === 'savings';
    // The browser's read-only update check must use runUpdateCheck, but an approved
    // "update --yes" is the mutation itself and must reach the real update command.
    const updateCheck = args[0] === 'update' && !args.includes('--yes');
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
        providerId: row.providerId,
        provider: name(row.providerId),
        measurement: labels[row.class] ?? row.class,
        unit: row.unit === 'tokens' ? 'tokens' : 'characters',
        saved: row.saved,
        before: row.before ?? null,
        after: row.after ?? null,
        operations: row.operations,
        harnesses: [...row.harnesses],
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
    if (this.busy) throw new GuideError(409, 'Another managed change is in progress.');
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
    const routing: Partial<Record<GuideHarness, GuideRouting>> = {};
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
        routing,
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
    await Promise.all(
      (['claude', 'codex'] as const).map(async (harness) => {
        try {
          const result = await this.call<SmartRoutingCommandReport>([
            'routing',
            '--route-status',
            '--harness',
            harness,
          ]);
          if (result.exitCode === 0 && result.data?.kind === 'status') {
            routing[harness] = {
              state: result.data.state,
              mode: result.data.mode,
              gatewayState: result.data.gatewayState,
              profileId: result.data.profileId,
              launchCommand: result.data.launchCommand,
              simpleModel: result.data.simpleModel,
              availableModels: result.data.availableModels,
              detail: result.data.detail,
            };
          }
        } catch {
          // Routing status is optional UI state; a failed observation never blocks the overview.
        }
      }),
    );
    const agents = this.agentView(
      doctor,
      budget,
      context,
      { rules: true, allowance: true },
      guidance,
      routing,
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
    routing?: Partial<Record<GuideHarness, GuideRouting>>,
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
      const setup =
        doctor.data === null ? [] : guideSetupTargets(doctor.data, agent.harnessId as GuideHarness);
      const hasActionableSetup = setup.some((target) => target.state === 'actionable');
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
              : hasActionableSetup
                ? 'Ready to set up'
                : 'No automatic setup surface available',
        providers: providers.map(name),
        setup,
        effort: observed?.nativeEffort?.current ?? observed?.reasoningEffort ?? null,
        reasoning: reasoningView(agent.harnessId as GuideHarness, observed),
        routing:
          routing?.[agent.harnessId as GuideHarness] ?? {
            state: 'off',
            mode: null,
            gatewayState: 'unknown',
            profileId: null,
            launchCommand: null,
            simpleModel: null,
            availableModels: [],
            detail: 'Smart Model Routing is not configured.',
          },
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
    const action = String(data['action']);
    const candidateAction = action === 'candidate-setup' || action === 'candidate-remove';
    const routingAction =
      action === 'routing-setup' || action === 'routing-remove' || action === 'routing-metrics';
    const requestedHarnesses = data['harnesses'];
    const validHarnesses =
      Array.isArray(requestedHarnesses) &&
      requestedHarnesses.length > 0 &&
      requestedHarnesses.length <= 20 &&
      requestedHarnesses.every(
        (value) => typeof value === 'string' && ['claude', 'codex'].includes(value),
      ) &&
      new Set(requestedHarnesses).size === requestedHarnesses.length;
    if (
      Object.keys(data).some(
        (key) =>
          ![
            'action',
            'harness',
            'harnesses',
            'task',
            'provider',
            'candidate',
            'routeMode',
            'simpleModel',
          ].includes(key),
      ) ||
      ![
        'setup',
        'effort',
        'skill',
        'undo',
        'remove',
        'candidate-setup',
        'candidate-remove',
        'routing-setup',
        'routing-remove',
        'routing-metrics',
      ].includes(action) ||
      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||
      (data['harnesses'] !== undefined && !validHarnesses) ||
      (data['harnesses'] !== undefined && action !== 'setup') ||
      (data['routeMode'] !== undefined &&
        !['shadow', 'conservative'].includes(String(data['routeMode']))) ||
      (data['simpleModel'] !== undefined &&
        (typeof data['simpleModel'] !== 'string' ||
          !/^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(data['simpleModel']) ||
          !String(data['simpleModel']).includes('/'))) ||
      (data['harnesses'] !== undefined && data['harness'] !== undefined) ||
      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||
      (data['provider'] !== undefined &&
        !['rtk', 'harnesstrim', 'mcptoon', 'gitnexus', 'headroom'].includes(
          String(data['provider']),
        )) ||
      (data['candidate'] !== undefined &&
        !['mcptoon', 'gitnexus'].includes(String(data['candidate']))) ||
      (action === 'effort' && (data['harness'] === undefined || data['task'] === undefined)) ||
      (action === 'skill' && data['harness'] === undefined) ||
      (routingAction && data['harness'] === undefined) ||
      (action !== 'routing-setup' &&
        (data['routeMode'] !== undefined || data['simpleModel'] !== undefined)) ||
      (action === 'remove' &&
        (data['provider'] === undefined ||
          data['harness'] !== undefined ||
          data['harnesses'] !== undefined ||
          data['task'] !== undefined ||
          data['candidate'] !== undefined)) ||
      (data['provider'] !== undefined && action !== 'remove' && action !== 'setup') ||
      (candidateAction &&
        (data['candidate'] === undefined ||
          data['harness'] === undefined ||
          data['provider'] !== undefined ||
          data['task'] !== undefined)) ||
      (!candidateAction && data['candidate'] !== undefined) ||
      (routingAction &&
        (data['provider'] !== undefined ||
          data['candidate'] !== undefined ||
          data['task'] !== undefined ||
          data['harnesses'] !== undefined))
    )
      throw new GuideError(400, 'Choose a supported agent and action.');
    return this.exclusive(async () => {
      this.approval = null;
      if (routingAction) {
        const harness = String(data['harness']) as GuideHarness;
        const mode: 'shadow' | 'conservative' =
          data['routeMode'] === 'conservative' ? 'conservative' : 'shadow';

        if (action === 'routing-metrics') {
          this.record(
            `Reading local Smart Model Routing decisions for ${name(harness)}. No configuration is changed.`,
            'working',
          );
          const result = await this.call<SmartRoutingCommandReport>([
            'routing',
            '--route-metrics',
            '--ccr-usage',
            '--harness',
            harness,
            '--since',
            '30d',
          ]);
          if (result.exitCode !== 0 || result.data?.kind !== 'metrics') {
            const message = explainGuideIssue(
              result.diagnostics,
              `Routing activity for ${name(harness)} could not be read. No configuration changed.`,
            );
            this.record(message, 'attention');
            return {
              ticket: null,
              title: 'Routing activity needs attention',
              changes: [],
              notices: [message],
              expiresAt: null,
              network: false,
              restart: false,
            };
          }
          const metrics = result.data.metrics;
          const notices = [
            `${String(metrics.retainedDecisionCount)} local routing decision${metrics.retainedDecisionCount === 1 ? '' : 's'} recorded in the last 30 days for ${name(harness)}.`,
            `Shadow decisions: ${String(metrics.byMode.shadow)}. Conservative route requests: ${String(metrics.routeMutationRequestCount)}.`,
            `Tiers: simple ${String(metrics.byTier.simple)}, standard ${String(metrics.byTier.standard)}, complex ${String(metrics.byTier.complex)}, critical ${String(metrics.byTier.critical)}.`,
            'Routing telemetry stores classifier features and model identifiers, not prompt text. Subscription savings remain not measured until paired quality and allowance evidence exists.',
          ];
          this.record('Routing activity read successfully.', 'success');
          return {
            ticket: null,
            title: `Smart Model Routing · ${name(harness)}`,
            changes: [],
            notices,
            expiresAt: null,
            network: false,
            restart: false,
          };
        }

        const removing = action === 'routing-remove';
        this.record(
          `${removing ? 'Reviewing removal of' : 'Reviewing'} Smart Model Routing for ${name(harness)}. Nothing has changed yet.`,
          'working',
        );
        const simpleModel =
          mode === 'conservative' && typeof data['simpleModel'] === 'string'
            ? data['simpleModel']
            : undefined;
        const args = removing
          ? ['routing', '--rollback-ccr', '--harness', harness]
          : [
              'routing',
              '--configure-ccr',
              '--harness',
              harness,
              '--route-mode',
              mode,
              ...(simpleModel ? ['--route-simple-model', simpleModel] : []),
            ];
        const result = await this.call<SmartRoutingCommandReport>(args);
        const replacing =
          !removing &&
          result.diagnostics.some((entry) => entry.code === 'ccr-route-mode-requires-rollback');
        if ((result.exitCode !== 0 || result.data === null) && !replacing) {
          const message = explainGuideIssue(
            result.diagnostics,
            `No safe Smart Model Routing ${removing ? 'removal' : 'setup'} is available for ${name(harness)}. Nothing was changed.`,
          );
          this.record(message, 'attention');
          return {
            ticket: null,
            title: 'No routing change to apply',
            changes: [],
            notices: [message],
            expiresAt: null,
            network: false,
            restart: false,
          };
        }

        const report = result.data;
        const alreadyConfigured =
          !removing &&
          report?.kind === 'ccr-configuration' &&
          report.state === 'already-configured';
        const alreadyAbsent =
          removing &&
          report?.kind === 'ccr-configuration' &&
          report.state === 'already-absent';
        if (alreadyConfigured || alreadyAbsent) {
          const message = alreadyConfigured
            ? `${name(harness)} already has the Token Harness-owned ${mode} routing rule.`
            : `${name(harness)} has no Token Harness-owned routing rule to remove.`;
          this.record(message, 'success');
          return {
            ticket: null,
            title: alreadyConfigured ? 'Routing already configured' : 'Routing already absent',
            changes: [],
            notices: [message],
            expiresAt: null,
            network: false,
            restart: false,
          };
        }

        const ticket = this.random();
        const expires = this.now() + 10 * 60_000;
        const lifecycle = report?.kind === 'ccr-lifecycle';
        const network = Boolean(
          lifecycle && report?.kind === 'ccr-lifecycle' && report.action !== 'start',
        );
        this.approval = {
          id: ticket,
          expires,
          plans: [],
          transactionId: null,
          provider: null,
          description: `Smart Model Routing ${removing ? 'removal' : mode}`,
          operation: removing ? 'routing-rollback' : 'routing-configure',
          network,
          routingHarness: harness,
          routingMode: mode,
          ...(simpleModel ? { routingSimpleModel: simpleModel } : {}),
          ...(replacing ? { routingReplace: true } : {}),
        };
        const change =
          replacing
            ? {
                title: `${name(harness)}: change Smart Model Routing to ${mode}`,
                files: 0,
                description:
                  'Replace only the Token Harness-owned routing rule/profile for this coding agent, preserving unrelated CCR settings and provider credentials.',
              }
            : report?.kind === 'ccr-lifecycle'
            ? {
                title: `${name(harness)}: prepare local CCR routing runtime`,
                files: 0,
                description:
                  report.action === 'install'
                    ? `Install the reviewed CCR ${report.version} CLI inside Token Harness protected local state, start its loopback gateway and verify it. No global CCR package, provider login or native harness endpoint is replaced.`
                    : `Start or update the Token Harness-owned CCR ${report.version} runtime and verify its loopback gateway before any routing rule is configured.`,
              }
            : {
                title: `${name(harness)}: ${removing ? 'remove' : 'configure'} Smart Model Routing`,
                files: 0,
                description: removing
                  ? 'Remove only the Token Harness-owned CCR rule/profile for this coding agent. Provider credentials and unrelated CCR configuration are left untouched.'
                  : mode === 'shadow'
                    ? 'Install the Token Harness-owned CCR rule in shadow mode. Requests keep their current model; only local routing decisions are recorded.'
                    : 'Install the conservative opt-in rule. Only high-confidence simple requests may request the already-configured simple model; complex, ambiguous, image and unsafe tool requests pass through unchanged.',
              };
        this.record('Smart Model Routing preview ready. Waiting for your approval.', 'success');
        return {
          ticket,
          title: removing
            ? `Remove Smart Model Routing for ${name(harness)}?`
            : `Set up ${mode} Smart Model Routing for ${name(harness)}?`,
          changes: [change],
          notices: [
            lifecycle && !removing
              ? 'This approval prepares the Token Harness-owned CCR runtime and then completes the selected routing mode in the same flow.'
              : replacing
                ? 'This approval removes only the existing Token Harness-owned routing rule/profile and replaces it with the selected mode.'
                : 'Token Harness owns only its exact CCR rule/profile and local managed runtime. Provider credentials remain in CCR and are never imported silently.',
            mode === 'shadow' && !removing
              ? 'Shadow mode is the default: it never changes the model selected for a request.'
              : mode === 'conservative' && !removing
                ? `Conservative routing will use ${simpleModel ?? 'no selected model'} for high-confidence simple requests.`
                : 'Removing routing does not uninstall CCR or delete provider credentials.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network,
          restart: false,
        };
      }
      if (candidateAction) {
        const candidate = String(data['candidate']) as 'mcptoon' | 'gitnexus';
        const harness = String(data['harness']) as GuideHarness;
        const command = action === 'candidate-remove' ? 'uninstall' : 'apply';
        const removing = command === 'uninstall';
        this.record(
          `${removing ? 'Reviewing removal of' : 'Reviewing'} experimental ${name(candidate)} setup for ${name(harness)}. Nothing has changed yet.`,
          'working',
        );
        const result = await this.call<ApplyReport>([
          command,
          '--candidate',
          candidate,
          '--harness',
          harness,
        ]);
        const actionable = result.diagnostics.some(
          (entry) => entry.code === 'confirmation-required',
        );
        if (!actionable) {
          const message = explainGuideIssue(
            result.diagnostics,
            result.data?.outcome === 'nothing-to-do'
              ? `${name(candidate)} is already in the requested experimental state for ${name(harness)}.`
              : `No safe experimental ${name(candidate)} ${removing ? 'removal' : 'setup'} is available for ${name(harness)}. Nothing was changed.`,
          );
          this.record(message, result.exitCode === 0 ? 'success' : 'attention');
          return {
            ticket: null,
            title: 'No experimental change to apply',
            changes: [],
            notices: [message],
            expiresAt: null,
            network: false,
            restart: false,
          };
        }
        const ticket = this.random();
        const expires = this.now() + 10 * 60_000;
        const network = candidate === 'mcptoon' && !removing;
        this.approval = {
          id: ticket,
          expires,
          plans: [],
          transactionId: null,
          provider: null,
          candidate,
          candidateHarness: harness,
          description: `${name(candidate)} experimental ${removing ? 'removal' : 'setup'}`,
          operation: removing ? 'candidate-uninstall' : 'candidate-apply',
          network,
        };
        this.record('Experimental setup preview ready. Waiting for your approval.', 'success');
        return {
          ticket,
          title: `${removing ? 'Remove' : 'Apply'} experimental ${name(candidate)} setup for ${name(harness)}?`,
          changes: [
            {
              title: `${name(candidate)}: ${removing ? 'remove Token Harness-owned experimental integration' : 'apply the reviewed experimental integration'}`,
              files: 0,
              description: removing
                ? 'Uses the existing candidate ownership receipts and removes only Token Harness-owned candidate configuration. The candidate package and repository data remain user-owned.'
                : 'Uses the existing candidate-only lifecycle and exact compatibility gates. This does not promote the candidate into the RTK + HarnessTrim production stack.',
            },
          ],
          notices: [
            candidate === 'mcptoon' && !removing
              ? 'If the reviewed mcptoon build is absent, this approved candidate lifecycle may use an already-installed pipx to install that exact build. Token Harness never installs Python, pipx or administrator prerequisites.'
              : candidate === 'gitnexus' && !removing
                ? 'GitNexus must already be installed on the exact reviewed row. Token Harness does not create or refresh its repository index and does not run gitnexus analyze/setup.'
                : 'Removal keeps the candidate package and any repository index/data. Only Token Harness-owned experimental integration state is eligible.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network,
          restart: true,
        };
      }
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
      const selectedHarnesses =
        data['harnesses'] !== undefined
          ? (data['harnesses'] as string[])
          : data['harness'] !== undefined
            ? [String(data['harness'])]
            : null;
      const selected = (inventory.data?.harnesses ?? []).filter(
        (item) =>
          item.state !== 'absent' &&
          (item.harnessId === 'claude' || item.harnessId === 'codex') &&
          (selectedHarnesses === null || selectedHarnesses.includes(item.harnessId)),
      );
      const changes: GuidePreview['changes'] = [],
        notices: string[] = [],
        plans: string[] = [];
      let network = false;
      if (selectedHarnesses !== null) {
        for (const harness of selectedHarnesses) {
          if (!selected.some((item) => item.harnessId === harness))
            notices.push(
              `${name(harness)} is not currently detected. No setup change was prepared for it.`,
            );
        }
      }
      for (const agent of selected) {
        this.record(
          `Preparing supported changes for ${name(agent.harnessId)}. No settings changed.`,
          'working',
        );
        const setupProviders: Array<string | null> = [];
        if (data['action'] === 'setup') {
          const requested =
            data['provider'] === undefined
              ? RECOMMENDED_SETUP_PROVIDERS
              : [String(data['provider']) as GuideManagedProvider];
          for (const setupProvider of requested) {
            const target =
              inventory.data === null
                ? null
                : guideSetupTarget(inventory.data, agent.harnessId as GuideHarness, setupProvider);
            if (target?.state === 'actionable') {
              setupProviders.push(setupProvider);
            } else if (target?.state === 'connected') {
              notices.push(
                `${name(agent.harnessId)} · ${name(setupProvider)}: already connected. No setup change is needed.`,
              );
            } else if (target !== null) {
              notices.push(`${name(agent.harnessId)} · ${name(setupProvider)}: ${target.reason}`);
            }
          }
        } else {
          setupProviders.push(null);
        }
        for (const setupProvider of setupProviders) {
          const args = ['plan', '--harness', agent.harnessId];
          if (setupProvider !== null) args.push('--provider', setupProvider);
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
            const subject =
              setupProvider !== null
                ? `${name(agent.harnessId)} · ${name(setupProvider)}`
                : name(agent.harnessId);
            notices.push(
              `${subject}: ${explainGuideIssue(
                result.diagnostics,
                data['action'] === 'effort'
                  ? 'No supported preference change is needed or available. Your current preference is kept.'
                  : data['action'] === 'skill'
                    ? 'In-session guidance is already present, or an existing user-owned skill location was left untouched.'
                    : 'No safe setup change is available for the current provider, agent version and platform.',
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
            changes.push(
              ...report.actions.map((action) => describeChange(action, agent.harnessId)),
            );
          }
          network ||= report.network.length > 0;
        }
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
      throw new GuideError(400, 'A current preview is required.');
    const data = input as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || typeof data['ticket'] !== 'string')
      throw new GuideError(400, 'A current preview is required.');
    return this.exclusive(async () => {
      const approval = this.approval;
      if (approval === null || approval.id !== data['ticket'] || this.now() >= approval.expires)
        throw new GuideError(
          409,
          'This preview expired or was already used. Review a fresh preview.',
        );
      this.approval = null;
      if (approval.operation === 'update') {
        const approvedUpdates = approval.updateTargets ?? [];
        if (approvedUpdates.length === 0)
          throw new GuideError(
            409,
            'This update preview contains no concrete application or provider version. Review it again.',
          );

        this.record(
          'Re-checking the exact Token Harness and optimizer versions you approved.',
          'working',
        );

        let fresh: CliEnvelope<UpdateReport>;
        try {
          fresh = await this.call<UpdateReport>(['update']);
        } catch {
          this.invalidateObservedState();
          const message =
            'The update channels could not be re-checked immediately before installation. Nothing was changed. Review a fresh update preview.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Update preview changed',
            messages: [message],
            appliedPlans: 0,
          };
        }
        if (fresh.exitCode !== 0 || fresh.data === null) {
          const message = explainGuideIssue(
            fresh.diagnostics,
            'The update channels changed or could not be re-checked after approval. Nothing was changed; review a fresh update preview.',
          );
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Update preview changed',
            messages: [message],
            appliedPlans: 0,
          };
        }

        const approvedById = new Map(
          approvedUpdates.map((target) => [guideUpdateTargetId(target), target.version] as const),
        );
        const freshUpgradable = [
          ...fresh.data.providers
            .filter((row) => row.verdict === 'upgradable')
            .map((row) => ({ id: String(row.providerId), available: row.available })),
          ...(fresh.data.application?.verdict === 'upgradable'
            ? [
                {
                  id: 'token-harness',
                  available: fresh.data.application.available,
                },
              ]
            : []),
        ];
        const unexpected = freshUpgradable.find((row) => {
          const approved = approvedById.get(row.id) ?? null;
          return approved === null || !sameGuideVersion(row.available, approved);
        });
        const unresolved = approvedUpdates.find((target) => {
          const row = guideUpdateTargetRow(fresh.data!, target);
          return !(
            row !== undefined &&
            ((row.verdict === 'upgradable' && sameGuideVersion(row.available, target.version)) ||
              (row.verdict === 'current' && sameGuideVersion(row.installed, target.version)))
          );
        });

        if (unexpected !== undefined || unresolved !== undefined) {
          const changed =
            unexpected !== undefined
              ? `${name(unexpected.id)} now offers ${unexpected.available ?? 'a different version'}.`
              : `${guideUpdateTargetName(unresolved!)} no longer reports the approved target ${unresolved!.version}.`;
          const message =
            changed +
            ' Nothing was installed because the live update state no longer matches the preview. Review a fresh update preview.';
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Update preview changed',
            messages: [message],
            appliedPlans: 0,
          };
        }

        const pending = approvedUpdates.filter((target) => {
          const row = guideUpdateTargetRow(fresh.data!, target);
          return row?.verdict === 'upgradable';
        });

        let appliedCount = 0;
        let updateEvidence = fresh.data;
        if (pending.length > 0) {
          this.record('Installing the approved Token Harness and optimizer updates.', 'working');
          let result: CliEnvelope<UpdateReport>;
          try {
            result = await this.call<UpdateReport>(['update', '--yes']);
          } catch {
            this.invalidateObservedState();
            const message =
              'The update stopped before its final result could be read. No automatic retry was made. Refresh and inspect Token Harness and optimizer versions before retrying.';
            this.record(message, 'attention');
            return {
              ok: false,
              title: 'Update result needs checking',
              messages: [message],
              appliedPlans: 0,
            };
          }
          if (result.exitCode !== 0 || result.data === null) {
            const message = explainGuideIssue(
              result.diagnostics,
              'The approved update was not applied. The installed version, update channel or runtime capability state changed after the preview, so nothing was forced.',
            );
            this.invalidateObservedState();
            this.record(message, 'attention');
            return {
              ok: false,
              title: 'Update was not applied',
              messages: [message],
              appliedPlans: 0,
            };
          }
          updateEvidence = result.data;
          appliedCount =
            result.data.execution?.results.filter((row) => row.status === 'applied').length ?? 0;
        }

        const providerTargets = approvedUpdates.filter(
          (target): target is Extract<GuideUpdateTarget, { kind: 'provider' }> =>
            target.kind === 'provider',
        );
        let inventory: CliEnvelope<DoctorReport> | null = null;
        if (providerTargets.length > 0) {
          try {
            inventory = await this.call<DoctorReport>(['doctor']);
          } catch {
            this.invalidateObservedState();
            const message =
              'The installer returned, but Token Harness could not re-read the active optimizer runtimes. The update is not being reported as successful. Refresh and inspect the installed versions.';
            this.record(message, 'attention');
            return {
              ok: false,
              title: 'Update result needs checking',
              messages: [message],
              appliedPlans: appliedCount,
            };
          }
        }

        const missingProviders = providerTargets.filter((target) => {
          const detection = inventory?.data?.providers.find(
            (candidate) => candidate.providerId === target.provider,
          );
          return !sameGuideVersion(detection?.version ?? null, target.version);
        });
        const applicationTarget = approvedUpdates.find(
          (target): target is Extract<GuideUpdateTarget, { kind: 'application' }> =>
            target.kind === 'application',
        );
        const applicationRow = updateEvidence.application;
        const applicationMissing =
          applicationTarget !== undefined &&
          !(
            applicationRow?.verdict === 'current' &&
            sameGuideVersion(applicationRow.installed, applicationTarget.version)
          );
        if (
          (providerTargets.length > 0 && inventory?.data === null) ||
          missingProviders.length > 0 ||
          applicationMissing
        ) {
          const message =
            missingProviders.length > 0 || applicationMissing
              ? 'These approved update targets were not verified after installation: ' +
                [
                  ...missingProviders.map(
                    (target) => `${name(String(target.provider))} ${target.version}`,
                  ),
                  ...(applicationMissing && applicationTarget !== undefined
                    ? [`Token Harness ${applicationTarget.version}`]
                    : []),
                ].join(', ') +
                '. This is not being reported as a successful update.'
              : 'The active optimizer versions could not be verified after installation. This is not being reported as a successful update.';
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Update was not verified',
            messages: [
              message,
              'Refresh after correcting PATH or the package installation; no automatic retry was made.',
            ],
            appliedPlans: appliedCount,
          };
        }

        this.lastApplied = null;
        this.invalidateObservedState();
        const versions = approvedUpdates
          .map((target) => `${guideUpdateTargetName(target)} ${target.version}`)
          .join(', ');
        const messages = [
          appliedCount > 0
            ? `Installed and verified the approved update${approvedUpdates.length === 1 ? '' : 's'}: ${versions}.`
            : `The approved update${approvedUpdates.length === 1 ? ' was' : 's were'} already at the target version: ${versions}.`,
          ...(applicationTarget === undefined
            ? []
            : ['Token Harness is updated on disk. Restart this app to load the new version.']),
          ...(providerTargets.length === 0
            ? []
            : [
                'The active optimizer runtimes were re-read after the operation and match the approved targets.',
                'Reopen a coding agent if an updated optimizer requires it.',
              ]),
        ];
        this.record(
          appliedCount > 0
            ? 'Approved updates installed and verified.'
            : 'Approved updates are already at their target versions.',
          'success',
        );
        return {
          ok: true,
          title:
            applicationTarget !== undefined
              ? 'Token Harness updated'
              : appliedCount > 0
                ? 'Optimizers updated'
                : 'Approved versions already active',
          messages,
          appliedPlans: appliedCount,
        };
      }

      if (approval.operation === 'routing-configure' || approval.operation === 'routing-rollback') {
        if (approval.routingHarness === undefined || approval.routingMode === undefined)
          throw new GuideError(
            409,
            'This Smart Model Routing preview is incomplete. Review it again.',
          );
        const harness = approval.routingHarness;
        const mode = approval.routingMode;
        const removing = approval.operation === 'routing-rollback';
        this.record(
          (removing ? 'Removing' : 'Applying') + ' Smart Model Routing for ' + name(harness) + '.',
          'working',
        );
        let result: CliEnvelope<SmartRoutingCommandReport>;
        const configureArgs = [
          'routing',
          '--configure-ccr',
          '--harness',
          harness,
          '--route-mode',
          mode,
          ...(approval.routingSimpleModel
            ? ['--route-simple-model', approval.routingSimpleModel]
            : []),
          '--yes',
        ];
        try {
          if (!removing && approval.routingReplace) {
            const removed = await this.call<SmartRoutingCommandReport>([
              'routing',
              '--rollback-ccr',
              '--harness',
              harness,
              '--yes',
            ]);
            if (
              removed.exitCode !== 0 ||
              removed.data?.kind !== 'ccr-configuration' ||
              !['rolled-back', 'already-absent'].includes(removed.data.state)
            ) {
              result = removed;
            } else {
              result = await this.call<SmartRoutingCommandReport>(configureArgs);
            }
          } else {
            result = await this.call<SmartRoutingCommandReport>(
              removing
                ? ['routing', '--rollback-ccr', '--harness', harness, '--yes']
                : configureArgs,
            );
          }
          if (!removing && result.exitCode === 0 && result.data?.kind === 'ccr-lifecycle') {
            result = await this.call<SmartRoutingCommandReport>(configureArgs);
          }
        } catch {
          this.invalidateObservedState();
          const message =
            'The Smart Model Routing operation stopped before its final result could be read. No automatic retry was made. Review the local routing state before retrying.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Routing result needs checking',
            messages: [message],
            appliedPlans: 0,
          };
        }
        if (result.exitCode !== 0 || result.data === null) {
          const message = explainGuideIssue(
            result.diagnostics,
            'Smart Model Routing for ' +
              name(harness) +
              ' was not changed. The local CCR runtime, provider model selection or owned rule state no longer matches the preview.',
          );
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Routing change was not applied',
            messages: [message],
            appliedPlans: 0,
          };
        }

        const report = result.data;
        this.lastApplied = null;
        this.invalidateObservedState();
        if (report.kind === 'ccr-lifecycle') {
          const message =
            'The Token Harness-owned CCR ' +
            report.version +
            ' runtime is ready and verified on loopback. No routing rule has been assumed from this runtime step. Open Manage routing again to review the exact shadow or conservative rule/profile.';
          this.record('CCR routing runtime prepared and verified.', 'success');
          return {
            ok: true,
            title: 'Routing runtime ready',
            messages: [
              message,
              'Provider login/import remains an explicit CCR choice; Token Harness did not change Claude Code or Codex native endpoints.',
            ],
            appliedPlans: report.state === 'already-current' ? 0 : 1,
          };
        }
        if (report.kind !== 'ccr-configuration') {
          const message =
            'The routing command returned an unexpected result shape after approval. No success is being reported; review the local CCR routing state before retrying.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Routing result needs checking',
            messages: [message],
            appliedPlans: 0,
          };
        }

        const changed = report.state === 'configured' || report.state === 'rolled-back';
        const messages = removing
          ? [
              report.state === 'already-absent'
                ? name(harness) + ' already had no Token Harness-owned routing rule.'
                : 'The Token Harness-owned Smart Model Routing rule/profile for ' +
                  name(harness) +
                  ' was removed. CCR and provider credentials were left in place.',
            ]
          : [
              report.state === 'already-configured'
                ? name(harness) + ' already has the Token Harness-owned ' + mode + ' routing rule.'
                : name(harness) + ' Smart Model Routing is configured in ' + mode + ' mode.',
              ...(mode === 'shadow'
                ? [
                    'Shadow mode records local routing decisions but does not change the request model.',
                  ]
                : [
                    'Conservative mode may request the configured simple model only for high-confidence simple prompts; safety-gated requests pass through unchanged.',
                  ]),
              ...(report.launchCommand
                ? ['Launch through the CCR profile to use the rule: ' + report.launchCommand]
                : [
                    'CCR still needs an unambiguous provider/model profile before a routed launch can be verified.',
                  ]),
            ];
        this.record(
          removing ? 'Smart Model Routing rule removed.' : 'Smart Model Routing configured.',
          'success',
        );
        return {
          ok: true,
          title: removing ? 'Routing removed' : 'Smart Model Routing configured',
          messages,
          appliedPlans: changed ? 1 : 0,
        };
      }

      if (
        approval.operation === 'candidate-apply' ||
        approval.operation === 'candidate-uninstall'
      ) {
        if (approval.candidate === undefined || approval.candidateHarness === undefined)
          throw new GuideError(409, 'This experimental preview is incomplete. Review it again.');
        const candidate = approval.candidate;
        const harness = approval.candidateHarness;
        const removing = approval.operation === 'candidate-uninstall';
        const command = removing ? 'uninstall' : 'apply';
        this.record(
          `${removing ? 'Removing' : 'Applying'} reviewed experimental ${name(candidate)} setup for ${name(harness)}.`,
          'working',
        );
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>([
            command,
            '--candidate',
            candidate,
            '--harness',
            harness,
            '--yes',
          ]);
        } catch {
          this.invalidateObservedState();
          const message =
            'The experimental operation stopped before its final result could be read. No automatic retry was made. Refresh and inspect the current candidate state.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Experimental result needs checking',
            messages: [message],
            appliedPlans: 0,
          };
        }
        const committed = result.data?.outcome === 'committed';
        const alreadyVerified =
          result.data?.outcome === 'nothing-to-do' && result.data.requestedStateVerified === true;
        if (result.exitCode !== 0 || (!committed && !alreadyVerified)) {
          const message = explainGuideIssue(
            result.diagnostics,
            `The experimental ${name(candidate)} ${removing ? 'removal' : 'setup'} was not applied. Compatibility, ownership or configuration changed after the preview, so nothing was forced.`,
          );
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Experimental change was not applied',
            messages: [message],
            appliedPlans: 0,
          };
        }
        // Any later transaction makes an older one-click undo target stale. Candidate lifecycle
        // remains reversible through its normal ownership/transaction commands, but the novice UI
        // must never guess a historical transaction to restore.
        this.lastApplied = null;
        this.invalidateObservedState();
        const messages = [
          removing
            ? `${name(candidate)} Token Harness-owned experimental integration was removed. The candidate package and repository data were left alone.`
            : `${name(candidate)} experimental integration was applied for ${name(harness)} using the reviewed candidate-only lifecycle.`,
          `${name(candidate)} remains experimental and outside the RTK + HarnessTrim production stack.`,
          'Reopen the affected coding agent when applicable, then choose Refresh to read the current state.',
        ];
        this.record(
          `${name(candidate)} experimental ${removing ? 'integration removed' : 'setup applied'}.`,
          'success',
        );
        return {
          ok: true,
          title: removing ? 'Experimental integration removed' : 'Experimental setup applied',
          messages,
          appliedPlans: committed ? 1 : 0,
        };
      }
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
          ? 'Restoring the approved configuration backup.'
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
          ? 'The approved backup was restored. Reopen the affected coding agent.'
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
      this.approval = null;
      this.record(
        'Checking Token Harness and optimizer update channels without changing software.',
        'working',
      );
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
          ticket: null,
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
          ticket: null,
        };
      }

      this.updates = { fingerprint, report: updateResult.data };
      const available = updateResult.data.providers.filter((row) => row.verdict === 'upgradable');
      const updateTargets: GuideUpdateTarget[] = [
        ...available.flatMap((row) =>
          row.available === null
            ? []
            : [{ kind: 'provider' as const, provider: row.providerId, version: row.available }],
        ),
        ...(updateResult.data.application?.verdict === 'upgradable' &&
        updateResult.data.application.available !== null
          ? [
              {
                kind: 'application' as const,
                version: updateResult.data.application.available,
              },
            ]
          : []),
      ];
      const applicationUpgradable = updateResult.data.application?.verdict === 'upgradable';
      const blocked = updateResult.data.providers.filter(
        (row) => row.verdict === 'blocked-unreviewed',
      );
      const updateWarnings = updateResult.diagnostics.filter(
        (entry) => entry.severity === 'warning',
      );
      const messages: string[] = [];
      const application = updateResult.data.application;
      if (application?.verdict === 'upgradable') {
        messages.push(
          `Token Harness: ${application.installed ?? 'installed version'} → ${application.available ?? 'new version'} is available through npm. After installation, restart this app to load the updated version.`,
        );
      } else if (application?.verdict === 'unsupported-installation') {
        messages.push(
          'This Token Harness copy is not installed globally through npm, so it cannot update itself here. Update it with its original install method; the global npm command is `npm install --global token-harness@latest`.',
        );
      } else if (application?.verdict === 'unavailable' || application?.verdict === 'unknown') {
        messages.push(
          'Token Harness itself could not be checked through npm. No application update was installed.',
        );
      }
      if (available.length > 0) {
        messages.push(
          ...available.map(
            (row) =>
              `${name(row.providerId)}: ${row.installed ?? 'installed version'} → ${row.available ?? 'new version'} is available and ready to install; Token Harness will verify the active runtime after installation.`,
          ),
        );
      }
      if (blocked.length > 0) {
        messages.push(
          ...blocked.map(
            (row) =>
              `${name(row.providerId)}: ${row.available ?? 'a newer version'} exists, but Token Harness is keeping ${row.installed ?? 'the installed version'} because the target does not meet the provider update prerequisites.`,
          ),
        );
      }
      if (updateWarnings.length > 0) {
        messages.push(
          ...updateWarnings.map((entry) => {
            const label =
              entry.subject === null || entry.subject === undefined
                ? 'Update check'
                : name(entry.subject);
            return (
              label +
              ': ' +
              entry.message +
              (entry.remediation === null || entry.remediation === undefined
                ? ''
                : ' ' + entry.remediation)
            );
          }),
        );
      }
      if (
        available.length === 0 &&
        blocked.length === 0 &&
        updateWarnings.length === 0 &&
        application?.verdict === 'current'
      ) {
        messages.push('Token Harness and your managed optimizers are up to date.');
      } else if (
        available.length === 0 &&
        blocked.length === 0 &&
        updateWarnings.length === 0 &&
        application === undefined
      ) {
        messages.push('Your managed optimizers are up to date on their configured channels.');
      }

      let ticket: string | null = null;
      const upgradableCount = available.length + (applicationUpgradable ? 1 : 0);
      if (upgradableCount > updateTargets.length) {
        messages.push(
          'An update channel reported an update without a concrete target version. No install approval was created.',
        );
      } else if (updateTargets.length > 0) {
        ticket = this.random();
        const expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: [],
          transactionId: null,
          provider: null,
          description:
            applicationUpgradable && available.length > 0
              ? 'Token Harness and optimizer updates'
              : applicationUpgradable
                ? 'Token Harness update'
                : 'Optimizer updates',
          operation: 'update',
          network: updateResult.data.network.length > 0,
          updateTargets,
        };
        messages.push(
          'Review the versions above, then choose Install updates. Token Harness will re-check every update channel and safety rule before changing software.',
        );
      } else {
        messages.push('No software was changed.');
      }

      const stack = this.stackSnapshot();
      if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
      this.record(
        ticket !== null
          ? 'Token Harness or optimizer update available. Waiting for your approval.'
          : upgradableCount > 0 || updateWarnings.length > 0
            ? 'Update check needs attention.'
            : 'Token Harness and optimizer update check completed.',
        upgradableCount > 0 || updateWarnings.length > 0 ? 'attention' : 'success',
      );
      return {
        ok: true,
        title:
          ticket !== null
            ? 'Updates available'
            : upgradableCount > 0 || updateWarnings.length > 0
              ? 'Update check needs attention'
              : application?.verdict === 'current'
                ? 'Token Harness and optimizers up to date'
                : 'Update check completed',
        messages,
        appliedPlans: 0,
        stack,
        ticket,
      };
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
