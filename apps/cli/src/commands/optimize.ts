/**
 * `token-harness optimize` — RFC 0011 Phase 18.3.
 *
 * Advice only. Combines live quota and context observations, never mutates a harness.
 */

import {
  EXIT_CODES,
  assessMcpServer,
  assessWindowPace,
  chooseSupportedEffort,
  commandResult,
  diagnostic,
  type BudgetProfile,
  type CommandResult,
  type ContextPressure,
  type ContextReport,
  type HarnessContextObservation,
  type HarnessOptimizationAdvice,
  type LocalBurnTrend,
  type OptimizeReport,
  type OptimizationRecommendation,
  type RecommendationEvidence,
  type SessionBoundarySignal,
  type TaskClass,
  type WindowPaceAssessment,
} from '@token-harness/core';

import { runBudget } from './budget.js';
import type { CommandContext } from './context.js';
import { runContext } from './context-cost.js';
import { runHistory } from './history.js';

const DEFAULT_RESERVE = 20;

function contextEvidence(
  context: ContextReport,
  harness: HarnessContextObservation,
): {
  pressure: ContextPressure;
  evidence: RecommendationEvidence[];
} {
  const instructionBytes = context.instructions
    .filter((item) => item.harnessId === harness.harnessId)
    .reduce((total, item) => total + (item.loadedBytes ?? 0), 0);
  const discoveredBytes = context.instructions
    .filter((item) => item.harnessId === harness.harnessId)
    .reduce((total, item) => total + item.byteLength, 0);
  const knownTools = harness.mcpServers
    .filter((server) => server.toolCount !== null)
    .reduce((total, server) => total + (server.toolCount ?? 0), 0);
  const hasUnknownTools = harness.mcpServers.some((server) => server.toolCount === null);

  const evidence: RecommendationEvidence[] = [];
  let score = 0;

  if (harness.projectDocMaxBytes !== null && harness.projectDocMaxBytes > 0) {
    const ratio = instructionBytes / harness.projectDocMaxBytes;
    if (ratio >= 0.75) score = Math.max(score, 2);
    else if (ratio >= 0.5) score = Math.max(score, 1);
    evidence.push({
      code: 'instruction-budget',
      summary:
        String(instructionBytes) +
        'B known loaded of ' +
        String(harness.projectDocMaxBytes) +
        'B project-doc budget',
    });
  } else if (discoveredBytes > 0) {
    if (discoveredBytes >= 32 * 1024) score = Math.max(score, 1);
    evidence.push({
      code: 'instruction-candidates',
      summary:
        String(discoveredBytes) +
        'B of instruction candidates; admitted bytes are not fully proven',
    });
  }

  if (harness.configInstructionBytes !== null && harness.configInstructionBytes > 0) {
    if (harness.configInstructionBytes >= 16 * 1024) score = Math.max(score, 2);
    else if (harness.configInstructionBytes >= 8 * 1024) score = Math.max(score, 1);
    evidence.push({
      code: 'config-instructions',
      summary: String(harness.configInstructionBytes) + 'B of effective config instructions',
    });
  }

  if (knownTools >= 50 || harness.mcpServers.length >= 12) score = Math.max(score, 2);
  else if (knownTools >= 20 || harness.mcpServers.length >= 6) score = Math.max(score, 1);
  if (harness.mcpServers.length > 0) {
    evidence.push({
      code: 'mcp-exposure',
      summary:
        String(harness.mcpServers.length) +
        ' MCP servers, ' +
        String(knownTools) +
        (hasUnknownTools ? '+?' : '') +
        ' tools visible in inventory',
    });
  }

  return {
    pressure:
      score >= 2 ? 'high' : score === 1 ? 'moderate' : evidence.length > 0 ? 'low' : 'unknown',
    evidence,
  };
}

function resetSoon(pace: WindowPaceAssessment): boolean {
  if (pace.minutesToReset === null) return false;
  if (pace.scope === 'five-hour') return pace.minutesToReset <= 60;
  if (pace.scope === 'weekly') return pace.minutesToReset <= 12 * 60;
  return false;
}

function quotaEvidence(pace: readonly WindowPaceAssessment[]): RecommendationEvidence[] {
  return pace
    .filter((item) => item.state !== 'unknown')
    .map((item) => ({
      code: 'quota-' + item.scope,
      summary:
        item.scope +
        ': used ' +
        String(item.usedPercent) +
        '%, pacing target ' +
        String(item.targetUsedPercent) +
        '%, ' +
        item.state,
    }));
}

function verbosityTarget(input: {
  current: string | null;
  taskClass: TaskClass;
  profile: BudgetProfile;
  pace: readonly WindowPaceAssessment[];
  contextPressure: ContextPressure;
}): string | null {
  if (input.current === null || !['low', 'medium', 'high'].includes(input.current)) return null;
  const pressured =
    input.profile === 'economy' ||
    input.contextPressure === 'high' ||
    input.pace.some((item) => item.state === 'over-pace');
  if (pressured && (input.taskClass === 'mechanical' || input.taskClass === 'standard')) {
    return 'low';
  }
  return input.current;
}

function adviceForHarness(input: {
  contextReport: ContextReport;
  context: HarnessContextObservation;
  budgetWindows: ReturnType<typeof assessWindowPace>[];
  localBurnTrend: LocalBurnTrend | null;
  recentSession: SessionBoundarySignal | null;
  taskClass: TaskClass;
  profile: BudgetProfile;
}): HarnessOptimizationAdvice {
  const {
    context,
    contextReport,
    budgetWindows,
    localBurnTrend,
    recentSession,
    taskClass,
    profile,
  } = input;
  const diagnostics = [...context.diagnostics];
  const pressure = contextEvidence(contextReport, context);
  const recommendations: OptimizationRecommendation[] = [];
  const paceEvidence = quotaEvidence(budgetWindows);
  const historyEvidence: RecommendationEvidence[] =
    localBurnTrend === null || localBurnTrend.state === 'unknown'
      ? []
      : [
          {
            code: 'local-token-burn',
            summary:
              'local token volume is ' +
              localBurnTrend.state +
              (localBurnTrend.changePercent === null
                ? ''
                : ' (' + String(localBurnTrend.changePercent) + '%)') +
              '; this is workload history, not subscription quota',
          },
        ];
  const overPace = budgetWindows.some((item) => item.state === 'over-pace');
  const underPaceSoon =
    (taskClass === 'hard' || taskClass === 'critical') &&
    budgetWindows.some((item) => item.state === 'under-pace' && resetSoon(item));

  const mcpAssessments = context.mcpServers.map((server) => assessMcpServer(server));

  if (pressure.pressure === 'high') {
    recommendations.push({
      area: 'context',
      priority: 'first',
      action: 'Reduce avoidable static context before spending more model effort',
      target: null,
      evidence: pressure.evidence,
    });
  } else if (pressure.pressure === 'moderate') {
    recommendations.push({
      area: 'context',
      priority: 'next',
      action: 'Review instruction and MCP exposure before a long task',
      target: null,
      evidence: pressure.evidence,
    });
  }

  for (const assessment of mcpAssessments.filter((item) => item.usability === 'attention')) {
    recommendations.push({
      area: 'mcp',
      priority: pressure.pressure === 'high' ? 'next' : 'first',
      action:
        'Fix this MCP server status/auth, or disable it manually only if you know the task does not need it',
      target: assessment.name,
      evidence: [
        {
          code: 'mcp-unusable',
          summary:
            assessment.name +
            ' is not currently usable; task relevance and actual usage are not observed',
        },
      ],
    });
  }

  for (const assessment of mcpAssessments.filter(
    (item) => item.exposure === 'high' && item.usability !== 'attention',
  )) {
    recommendations.push({
      area: 'mcp',
      priority: 'optional',
      action:
        'Review this high-exposure MCP server before a long task; do not remove it without usage or task-relevance evidence',
      target: assessment.name,
      evidence: [
        {
          code: 'mcp-high-exposure',
          summary:
            assessment.name +
            ' exposes ' +
            String(assessment.toolCount) +
            ' known tools; no per-server usage evidence is available',
        },
      ],
    });
  }

  if (overPace) {
    recommendations.push({
      area: 'quota',
      priority: pressure.pressure === 'high' ? 'next' : 'first',
      action: 'Protect the configured reserve; avoid unnecessary escalation',
      target: null,
      evidence: [...paceEvidence, ...historyEvidence],
    });
  } else if (underPaceSoon) {
    recommendations.push({
      area: 'quota',
      priority: 'next',
      action: 'Use available headroom on this hard task before the window resets',
      target: null,
      evidence: [...paceEvidence, ...historyEvidence],
    });
  } else if (
    budgetWindows.length === 0 ||
    budgetWindows.every((item) => item.state === 'unknown')
  ) {
    recommendations.push({
      area: 'quota',
      priority: 'optional',
      action: 'Keep pacing unknown; do not infer subscription headroom from local token counts',
      target: null,
      evidence: [{ code: 'quota-unknown', summary: 'no paceable live usage window was observed' }],
    });
  }

  if (localBurnTrend?.state === 'rising') {
    recommendations.push({
      area: 'history',
      priority: overPace ? 'next' : 'optional',
      action: 'Review growing local usage before escalating model effort or extending the session',
      target: null,
      evidence: historyEvidence,
    });
  }

  if (recentSession !== null && recentSession.state !== 'unknown') {
    const sessionEvidence: RecommendationEvidence[] = [
      {
        code: 'recent-session-candidate',
        summary:
          'most recently observed local session candidate is ' +
          recentSession.state +
          ', ' +
          (recentSession.totalTokens === null
            ? 'token volume unknown'
            : String(recentSession.totalTokens) + ' local tokens') +
          '; it is not assumed to be the active session',
      },
    ];
    if (recentSession.state === 'stale') {
      recommendations.push({
        area: 'session',
        priority: pressure.pressure === 'high' ? 'first' : 'next',
        action:
          'If this is a new task, start a new harness session instead of reviving stale context',
        target: 'new-session',
        evidence: sessionEvidence,
      });
    } else if (recentSession.state === 'recent-large') {
      recommendations.push({
        area: 'session',
        priority: pressure.pressure === 'high' || overPace ? 'first' : 'next',
        action:
          'If continuing the same task, compact or hand off before more turns; if the task changed, start a new session',
        target: 'compact-or-new-session',
        evidence: sessionEvidence,
      });
    }
  }

  const catalogModel =
    context.model === null
      ? null
      : (context.availableModels.find(
          (model) => model.model === context.model || model.id === context.model,
        ) ?? null);
  const currentEffort = context.reasoningEffort ?? catalogModel?.defaultReasoningEffort ?? null;
  const recommendedEffort =
    catalogModel === null
      ? null
      : chooseSupportedEffort({
          supported: catalogModel.supportedReasoningEfforts,
          current: currentEffort,
          defaultEffort: catalogModel.defaultReasoningEffort,
          taskClass,
          profile,
          pace: budgetWindows,
          contextPressure: pressure.pressure,
        });

  if (context.model !== null && catalogModel === null && context.availableModels.length > 0) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'current-model-not-in-catalog',
        subject: context.harnessId,
        message: 'The effective model is absent from the discovered model catalog',
        remediation:
          'Keep the current model and refresh the harness model catalog before switching',
      }),
    );
  }

  const recommendedModel = catalogModel === null ? null : context.model;
  if (catalogModel !== null) {
    recommendations.push({
      area: 'model',
      priority: 'optional',
      action: 'Keep the current discovered model until model-tier quota benchmarks exist',
      target: recommendedModel,
      evidence: [
        {
          code: 'model-catalog',
          summary:
            catalogModel.displayName +
            ' is present in the installed Codex catalog; no cost ranking is inferred from its name',
        },
      ],
    });
  }

  if (recommendedEffort !== null) {
    const evidence: RecommendationEvidence[] = [
      {
        code: 'task-quality-floor',
        summary: taskClass + ' task under the ' + profile + ' profile',
      },
      ...paceEvidence,
    ];
    if (pressure.pressure === 'high') evidence.push(...pressure.evidence);
    recommendations.push({
      area: 'reasoning',
      priority: pressure.pressure === 'high' ? 'next' : 'first',
      action:
        recommendedEffort === currentEffort
          ? 'Keep the current reasoning effort'
          : 'Use a supported reasoning effort matched to task quality and pacing',
      target: recommendedEffort,
      evidence,
    });
  }

  const recommendedVerbosity = verbosityTarget({
    current: context.verbosity,
    taskClass,
    profile,
    pace: budgetWindows,
    contextPressure: pressure.pressure,
  });
  if (recommendedVerbosity !== null) {
    recommendations.push({
      area: 'verbosity',
      priority: 'optional',
      action:
        recommendedVerbosity === context.verbosity
          ? 'Keep the current verbosity'
          : 'Use lower verbosity for this task while quota/context is pressured',
      target: recommendedVerbosity,
      evidence: [
        { code: 'task-class', summary: taskClass + ' task' },
        ...paceEvidence,
        ...pressure.evidence,
      ],
    });
  }

  return {
    harnessId: context.harnessId,
    state:
      context.state === 'absent'
        ? 'absent'
        : context.state === 'unavailable'
          ? 'unavailable'
          : diagnostics.length > 0
            ? 'partial'
            : 'advised',
    currentModel: context.model,
    recommendedModel,
    currentEffort,
    recommendedEffort,
    currentVerbosity: context.verbosity,
    recommendedVerbosity,
    contextPressure: pressure.pressure,
    localBurnTrend,
    recentSession,
    pace: budgetWindows,
    recommendations,
    diagnostics,
  };
}

export async function runOptimize(context: CommandContext): Promise<CommandResult<OptimizeReport>> {
  const taskClass = context.taskClass ?? 'standard';
  const profile = context.budgetProfile ?? 'balanced';
  if (profile === 'custom' && context.reservePercent === null) {
    return commandResult({
      command: 'optimize',
      exitCode: EXIT_CODES['usage-error'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'custom-profile-needs-reserve',
          message: 'The custom profile needs an explicit reserve target in this build',
          remediation: 'Pass --reserve <0-95>, or use economy, balanced, or quality',
        }),
      ],
    });
  }
  const reservePercent = context.reservePercent ?? DEFAULT_RESERVE;

  const [budgetResult, contextResult, historyResult] = await Promise.all([
    runBudget(context),
    runContext(context),
    runHistory(context),
  ]);
  const contextReport = contextResult.data;
  const budgetReport = budgetResult.data;
  const historyReport = historyResult.data;

  const report: OptimizeReport = {
    platform: context.platform,
    projectRoot: context.projectRoot,
    observedAt: context.now(),
    taskClass,
    profile,
    reservePercent,
    harnesses: [],
  };

  if (contextReport === null || budgetReport === null) {
    return commandResult({
      command: 'optimize',
      exitCode: EXIT_CODES.ok,
      data: report,
      diagnostics: [
        ...budgetResult.diagnostics,
        ...contextResult.diagnostics,
        ...historyResult.diagnostics,
      ],
    });
  }

  for (const harnessContext of contextReport.harnesses) {
    const budget = budgetReport.harnesses.find(
      (item) => item.harnessId === harnessContext.harnessId,
    );
    const pace =
      budget?.windows.map((window) =>
        assessWindowPace(window, report.observedAt, reservePercent),
      ) ?? [];
    report.harnesses.push(
      adviceForHarness({
        contextReport,
        context: harnessContext,
        budgetWindows: pace,
        localBurnTrend:
          historyReport?.harnesses.find((item) => item.harnessId === harnessContext.harnessId)
            ?.burnTrend ?? null,
        recentSession:
          historyReport?.harnesses.find((item) => item.harnessId === harnessContext.harnessId)
            ?.recentSession ?? null,
        taskClass,
        profile,
      }),
    );
  }

  return commandResult({
    command: 'optimize',
    exitCode: EXIT_CODES.ok,
    data: report,
    diagnostics: [
      ...budgetResult.diagnostics,
      ...contextResult.diagnostics,
      ...historyResult.diagnostics,
      ...report.harnesses.flatMap((item) => item.diagnostics),
    ],
  });
}
