/** Progressive human output: answer state, change, and one next step first. */

import {
  actionLabel,
  primaryActionPath,
  type ApplyReport,
  type BudgetReport,
  type ContextReport,
  type DoctorReport,
  type HistoryReport,
  type McpReport,
  type MetricsReport,
  type OptimizeReport,
  type PlanReport,
  type SetupReport,
  type StatusReport,
  type UpdateReport,
  type VerifyReport,
} from '@token-harness/core';

import {
  MAX_WIDTH,
  displayPath,
  document,
  formatCount,
  truncate,
  truncatePath,
  type RenderContext,
} from './layout.js';

function title(state: string): string[] {
  return [`TOKEN HARNESS - ${state.toUpperCase()}`, ''];
}

function next(command: string | null, description: string): string[] {
  return [
    '',
    'NEXT STEP',
    command === null ? `  ${truncate(description, MAX_WIDTH - 2)}` : `  ${command}`,
    ...(command === null ? [] : [`  ${truncate(description, MAX_WIDTH - 2)}`]),
  ];
}

function changeLine(changed: boolean, detail?: string): string[] {
  return [
    '',
    'CHANGES',
    `  ${changed ? (detail ?? 'Configuration changed.') : 'Nothing changed.'}`,
  ];
}

function harnessName(id: string): string {
  if (id === 'claude') return 'Claude Code';
  if (id === 'codex') return 'Codex';
  if (id === 'opencode') return 'OpenCode';
  return id;
}

export function renderSimpleDoctor(report: DoctorReport): string {
  const present = report.harnesses.filter((item) => item.state !== 'absent');
  const active = report.providers.filter(
    (item) => item.state === 'configured' && item.configuredHarnesses.length > 0,
  );
  const state =
    report.problemCount > 0 ? 'attention needed' : present.length > 0 ? 'ready' : 'setup needed';
  const lines = [...title(state), 'WHAT WORKS'];

  if (present.length === 0) lines.push('  No supported coding harness was found.');
  for (const item of report.harnesses) {
    const stateText = item.state === 'absent' ? 'not found' : item.state;
    lines.push(
      `  ${harnessName(item.harnessId)}: ${stateText}${item.version ? ` (${item.version})` : ''}`,
    );
  }
  if (report.providers.length === 0) lines.push('  Providers: none detected');
  for (const item of report.providers) {
    const connected = item.configuredHarnesses.map(harnessName).join(', ');
    lines.push(
      truncate(
        `  ${item.providerId}: ${connected === '' ? item.state : `active on ${connected}`}`,
        MAX_WIDTH,
      ),
    );
  }
  lines.push(...changeLine(false));

  if (report.problemCount > 0) {
    lines.push(...next('token-harness doctor --verbose', 'Review the technical findings.'));
  } else if (present.length === 0 || active.length === 0) {
    lines.push(...next('token-harness setup', 'Finish the guided setup.'));
  } else {
    lines.push(...next('token-harness ui', 'Open the dashboard.'));
  }
  return document(lines);
}

export function renderSimpleSetup(report: SetupReport, context: RenderContext): string {
  const state =
    report.stage === 'ready'
      ? 'ready'
      : report.stage === 'attention'
        ? 'attention needed'
        : 'setup needed';
  const lines = [...title(state), 'DETECTED'];
  const harnesses = report.doctor.harnesses.filter((item) => item.state !== 'absent');
  if (harnesses.length === 0) lines.push('  Claude Code/Codex: not found');
  for (const item of harnesses) {
    lines.push(
      `  ${harnessName(item.harnessId)}: ${item.state}${item.version ? ` (${item.version})` : ''}`,
    );
  }

  const active = report.doctor.providers.filter((item) => item.configuredHarnesses.length > 0);
  if (active.length === 0) lines.push('  Optimization provider: not active');
  for (const provider of active) {
    lines.push(
      truncate(
        `  ${provider.providerId}: active on ${provider.configuredHarnesses.map(harnessName).join(', ')}`,
        MAX_WIDTH,
      ),
    );
  }

  if (report.plan !== null && report.apply === null && report.plan.actions.length > 0) {
    lines.push('', 'SAFE PLAN');
    for (const action of report.plan.actions) {
      const path = primaryActionPath(action);
      lines.push(
        truncate(
          `  ${actionLabel(action.kind)}${path === null ? '' : ` - ${displayPath(path, context.home)}`}`,
          MAX_WIDTH,
        ),
      );
    }
  }

  lines.push(
    ...changeLine(
      report.changed,
      report.apply?.results.some((item) => item.status === 'applied')
        ? 'Safe configuration applied and checked.'
        : undefined,
    ),
  );
  lines.push(...next(report.nextStep.command, report.nextStep.description));
  return document(lines);
}

export function renderVerboseSetup(report: SetupReport, context: RenderContext): string {
  const lines = ['SETUP TECHNICAL DETAILS', '', 'DETECTION'];
  for (const harness of report.doctor.harnesses) {
    lines.push(
      truncate(
        `  ${harness.harnessId}: state ${harness.state}, version ${harness.version ?? 'unknown'}, verdict ${harness.versionVerdict ?? 'unknown'}`,
        MAX_WIDTH,
      ),
    );
    if (harness.configPath !== null)
      lines.push(
        truncate(`    config ${displayPath(harness.configPath, context.home)}`, MAX_WIDTH),
      );
  }
  for (const provider of report.doctor.providers) {
    lines.push(
      truncate(
        `  ${provider.providerId}: state ${provider.state}, version ${provider.version ?? 'unknown'}, wired ${provider.configuredHarnesses.join(', ') || 'none'}`,
        MAX_WIDTH,
      ),
    );
  }

  if (report.plan !== null) {
    lines.push('', `PLAN ${report.plan.planId ?? 'not produced'}`);
    lines.push(`  persisted: ${String(report.plan.persisted)}`);
    lines.push(`  actions: ${report.plan.actions.length}`);
    lines.push(`  conflicts: ${report.plan.conflicts.length}`);
    for (const action of report.plan.actions) {
      lines.push(truncate(`  ${action.id}: ${action.kind} - ${action.explanation}`, MAX_WIDTH));
    }
  }

  if (report.apply !== null) {
    lines.push('', `TRANSACTION ${report.apply.transactionId ?? 'none'}`);
    lines.push(`  outcome: ${report.apply.outcome}`);
    for (const result of report.apply.results) {
      lines.push(truncate(`  ${result.actionId}: ${result.status}`, MAX_WIDTH));
    }
  }

  if (report.verify !== null) {
    lines.push('', 'VERIFICATION');
    lines.push(`  healthy at declared tier: ${String(report.verify.healthyAtDeclaredTier)}`);
    for (const result of report.verify.results) {
      lines.push(`  ${result.providerId} on ${result.harnessId}: ${result.status}`);
      for (const check of result.checks) {
        lines.push(truncate(`    ${check.id}: ${check.status} - ${check.summary}`, MAX_WIDTH));
      }
    }
  }

  if (report.budget !== null) {
    lines.push('', 'ALLOWANCE SOURCES');
    for (const harness of report.budget.harnesses) {
      if (harness.windows.length === 0) lines.push(`  ${harness.harnessId}: ${harness.state}`);
      for (const window of harness.windows) {
        lines.push(
          truncate(
            `  ${harness.harnessId}/${window.scope}: ${window.source}, ${window.confidence}`,
            MAX_WIDTH,
          ),
        );
      }
    }
  }

  lines.push('', ...renderSimpleSetup(report, context).trimEnd().split('\n'));
  return document(lines);
}

function formatReset(resetsAt: string | null): string {
  return resetsAt === null ? 'reset unknown' : `resets ${resetsAt}`;
}

export function renderSimpleBudget(report: BudgetReport): string {
  const observed = report.harnesses.filter((item) => item.state === 'observed');
  const lines = [
    ...title(observed.length > 0 ? 'allowance available' : 'allowance unavailable'),
    'ALLOWANCE',
  ];
  for (const harness of report.harnesses) {
    if (harness.windows.length === 0) {
      lines.push(`  ${harnessName(harness.harnessId)}: ${harness.state}`);
      continue;
    }
    for (const window of harness.windows) {
      const label = window.bucketName ?? window.scope;
      const remaining =
        window.remainingPercent === null ? 'unknown' : `${window.remainingPercent}% left`;
      lines.push(
        truncate(
          `  ${harnessName(harness.harnessId)} ${label}: ${remaining}, ${formatReset(window.resetsAt)}`,
          MAX_WIDTH,
        ),
      );
    }
  }
  lines.push(...changeLine(false));
  lines.push(
    ...next(
      observed.length > 0 ? 'token-harness optimize' : 'token-harness setup',
      observed.length > 0
        ? 'See the best action for the current allowance.'
        : 'Check the local installation and connections.',
    ),
  );
  return document(lines);
}

export function renderSimpleContext(report: ContextReport): string {
  const lines = [...title('context checked'), 'CONTEXT'];
  lines.push(`  Instruction files: ${report.instructions.length}`);
  lines.push(
    `  Known loaded instructions: ${formatCount(report.knownLoadedInstructionBytes)} bytes`,
  );
  for (const harness of report.harnesses) {
    lines.push(
      truncate(
        `  ${harnessName(harness.harnessId)}: ${harness.state}, model ${harness.model ?? 'unknown'}, ${harness.mcpServers.length} MCP servers`,
        MAX_WIDTH,
      ),
    );
  }
  lines.push(...changeLine(false));
  lines.push(...next('token-harness optimize', 'Turn these observations into one recommendation.'));
  return document(lines);
}

export function renderSimpleMcp(report: McpReport): string {
  const attention = report.harnesses.some((harness) =>
    harness.assessments.some((item) => item.usability === 'attention'),
  );
  const lines = [...title(attention ? 'attention needed' : 'mcp checked'), 'MCP'];
  for (const harness of report.harnesses) {
    lines.push(
      `  ${harnessName(harness.harnessId)}: ${harness.servers.length} servers, ${harness.knownToolCount} known tools`,
    );
  }
  lines.push(...changeLine(false));
  lines.push(
    ...next(
      attention ? 'token-harness mcp --verbose' : 'token-harness optimize',
      attention
        ? 'Review the server that needs attention.'
        : 'See whether context can be simplified.',
    ),
  );
  return document(lines);
}

export function renderSimpleOptimize(report: OptimizeReport): string {
  const advice = report.harnesses.filter((item) => item.state !== 'absent');
  const lines = [
    ...title(advice.length > 0 ? 'recommendation ready' : 'setup needed'),
    'RECOMMENDATION',
  ];
  if (advice.length === 0) lines.push('  No supported harness could be assessed.');
  for (const harness of advice) {
    const recommendation =
      harness.recommendations.find((item) => item.priority === 'first') ??
      harness.recommendations[0];
    lines.push(
      truncate(
        `  ${harnessName(harness.harnessId)}: ${recommendation?.action ?? 'No change recommended.'}`,
        MAX_WIDTH,
      ),
    );
    const evidence = recommendation?.evidence[0]?.summary;
    if (evidence) lines.push(truncate(`    Why: ${evidence}`, MAX_WIDTH));
  }
  lines.push(...changeLine(false));
  const canPlan = advice.some(
    (item) =>
      item.recommendedEffort !== item.currentEffort ||
      item.recommendedVerbosity !== item.currentVerbosity,
  );
  lines.push(
    ...next(
      canPlan ? 'token-harness plan --native-policy' : 'token-harness ui',
      canPlan
        ? 'Review the reversible recommended policy change.'
        : 'Keep the dashboard open for the next decision.',
    ),
  );
  return document(lines);
}

export function renderSimplePlan(report: PlanReport, context: RenderContext): string {
  const lines = [
    ...title(
      report.conflicts.length > 0
        ? 'blocked'
        : report.actions.length > 0
          ? 'plan ready'
          : 'already configured',
    ),
  ];
  if (report.conflicts.length > 0) {
    lines.push('BLOCKED BY');
    for (const conflict of report.conflicts)
      lines.push(
        truncate(`  ${conflict.code}: ${conflict.detail[0] ?? conflict.scope}`, MAX_WIDTH),
      );
  } else {
    lines.push('WOULD CHANGE');
    if (report.actions.length === 0) lines.push('  Nothing.');
    for (const action of report.actions) {
      const path = primaryActionPath(action);
      const shownPath =
        path === null ? '' : ` - ${truncatePath(displayPath(path, context.home), 34)}`;
      lines.push(truncate(`  ${actionLabel(action.kind)}${shownPath}`, MAX_WIDTH));
    }
    lines.push(`  Network: ${report.network.length === 0 ? 'none' : report.network.join(', ')}`);
    lines.push(`  Backups: ${report.backups.files}`);
  }
  lines.push(...changeLine(false));
  if (report.conflicts.length > 0)
    lines.push(
      ...next('token-harness plan --verbose', 'Review the conflict and its safe resolution.'),
    );
  else if (report.actions.length > 0 && report.persisted && report.planId !== null)
    lines.push(
      ...next(
        `token-harness apply --plan ${report.planId} --yes`,
        'Apply exactly this stored plan.',
      ),
    );
  else if (report.actions.length === 0)
    lines.push(...next('token-harness setup', 'Check detection and finish guided setup.'));
  else lines.push(...next('token-harness ui', 'Open the dashboard.'));
  return document(lines);
}

export function renderSimpleApply(report: ApplyReport, command: string): string {
  const changed =
    report.outcome === 'committed' && report.results.some((item) => item.status === 'applied');
  const okay = report.outcome === 'committed' || report.outcome === 'nothing-to-do';
  const lines = [...title(okay ? 'complete' : report.outcome), 'RESULT'];
  const appliedCount = report.results.filter((item) => item.status === 'applied').length;
  lines.push(`  ${appliedCount} actions applied`);
  if (command === 'uninstall' && report.outcome === 'committed' && appliedCount === 0) {
    lines.push('  Removed nothing: no owned entry was recognised.');
  }
  lines.push(`  Transaction: ${report.transactionId ?? 'none'}`);
  lines.push(
    ...changeLine(
      changed,
      command === 'uninstall'
        ? 'Owned configuration removed.'
        : command === 'rollback'
          ? 'Previous configuration restored.'
          : 'Configuration applied and committed.',
    ),
  );
  const confirmationCommand =
    command === 'apply' && report.planId !== null
      ? `token-harness apply --plan ${report.planId} --yes`
      : `token-harness ${command} --yes`;
  lines.push(
    ...next(
      okay
        ? 'token-harness verify'
        : report.outcome === 'confirmation-required'
          ? confirmationCommand
          : `token-harness ${command} --verbose`,
      okay
        ? 'Check that the integration works.'
        : report.outcome === 'confirmation-required'
          ? 'Apply the reviewed change.'
          : 'Review the technical result.',
    ),
  );
  return document(lines);
}

export function renderSimpleVerify(report: VerifyReport): string {
  const lines = [
    ...title(report.healthyAtDeclaredTier ? 'working' : 'attention needed'),
    'INTEGRATIONS',
  ];
  if (report.results.length === 0) lines.push('  Nothing is configured to verify yet.');
  for (const item of report.results)
    lines.push(
      truncate(`  ${item.providerId} on ${harnessName(item.harnessId)}: ${item.status}`, MAX_WIDTH),
    );
  lines.push(...changeLine(false));
  lines.push(
    ...next(
      report.healthyAtDeclaredTier ? 'token-harness ui' : 'token-harness verify --verbose',
      report.healthyAtDeclaredTier
        ? 'Open the dashboard.'
        : 'Review the failed check and suggested fix.',
    ),
  );
  return document(lines);
}

export function renderSimpleStatus(report: StatusReport): string {
  const lines = [...title(report.problemCount === 0 ? 'healthy' : 'attention needed'), 'ACTIVE'];
  if (report.pipelines.length === 0) lines.push('  No Token Harness pipeline is active.');
  for (const pipeline of report.pipelines) {
    const providers = [...new Set(pipeline.owners.map((owner) => owner.owner))];
    lines.push(
      truncate(
        `  ${harnessName(pipeline.harness)}: ${providers.join(' -> ') || 'no provider'}`,
        MAX_WIDTH,
      ),
    );
  }
  lines.push(`  Drift: ${report.drift.length === 0 ? 'none' : report.drift.length}`);
  lines.push(...changeLine(false));
  lines.push(
    ...next(
      report.problemCount === 0
        ? report.pipelines.length === 0
          ? 'token-harness setup'
          : 'token-harness ui'
        : 'token-harness status --verbose',
      report.problemCount === 0
        ? report.pipelines.length === 0
          ? 'Finish the guided setup.'
          : 'Open the dashboard.'
        : 'Review the drift before making changes.',
    ),
  );
  return document(lines);
}

export function renderSimpleMetrics(report: MetricsReport): string {
  const lines = [...title('savings checked'), 'SAVINGS'];
  const measured = report.classes.filter((item) => item.saved !== null);
  if (measured.length === 0) lines.push('  No comparable savings recorded yet.');
  for (const item of measured)
    lines.push(`  ${item.class}: ${formatCount(item.saved ?? 0)} ${item.unit ?? ''} saved`);
  lines.push(`  Errors: ${report.errors}`);
  lines.push(...changeLine(false));
  lines.push(...next('token-harness optimize', 'Get the next evidence-based recommendation.'));
  return document(lines);
}

export function renderSimpleHistory(report: HistoryReport): string {
  const lines = [...title('history checked'), 'LOCAL USAGE'];
  if (report.harnesses.length === 0) lines.push(`  ${report.source.name}: ${report.source.state}`);
  for (const item of report.harnesses)
    lines.push(
      `  ${harnessName(item.harnessId)}: ${formatCount(item.totalTokens)} tokens, trend ${item.burnTrend.state}`,
    );
  lines.push(...changeLine(false));
  lines.push(...next('token-harness optimize', 'Use the history in the next recommendation.'));
  return document(lines);
}

export function renderSimpleUpdate(report: UpdateReport): string {
  const execution = report.execution;
  const changed =
    execution?.outcome === 'committed' &&
    execution.results.some((item) => item.status === 'applied');
  const lines = [...title(changed ? 'updated' : 'update checked'), 'PROVIDERS'];
  if (report.providers.length === 0) lines.push('  No provider was detected.');
  for (const item of report.providers)
    lines.push(truncate(`  ${item.providerId}: ${item.verdict}`, MAX_WIDTH));
  lines.push(...changeLine(changed, 'Provider update applied.'));
  const pending = report.providers.some((item) => item.verdict === 'upgradable');
  lines.push(
    ...next(
      pending && execution?.outcome === 'confirmation-required'
        ? 'token-harness update --yes'
        : 'token-harness verify',
      pending && execution?.outcome === 'confirmation-required'
        ? 'Apply the reviewed provider update.'
        : 'Check that integrations still work.',
    ),
  );
  return document(lines);
}
