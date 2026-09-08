/**
 * `token-harness optimize` — RFC 0011 Phase 18.3.
 *
 * Advice only. Combines live quota and context observations, never mutates a harness.
 */

import {
  EXIT_CODES,
  assessBudgetDecision,
  assessWorkloadCoverage,
  assessMcpServer,
  assessWindowPace,
  benchmarkPolicySnapshot,
  chooseSupportedEffort,
  commandResult,
  constrainBudgetForWorkload,
  diagnostic,
  estimateAcceptedTaskCapacityForPolicy,
  refineEffortForAllowance,
  refineEffortWithOutcomes,
  refineModelForAllowance,
  refineModelWithOutcomes,
  refineVerbosityForAllowance,
  refineVerbosityWithOutcomes,
  VERBOSITY_LEVELS,
  type BudgetProfile,
  type BudgetReport,
  type CommandResult,
  type ContextPressure,
  type ContextReport,
  type Diagnostic,
  type HarnessContextObservation,
  type HarnessOptimizationAdvice,
  type LocalBurnTrend,
  type OptimizeReport,
  type OptimizationRecommendation,
  type RecommendationEvidence,
  type SessionBoundarySignal,
  type TaskBenchmarkReceipt,
  type TaskClass,
  type WindowPaceAssessment,
} from '@token-harness/core';

import { runBudget } from './budget.js';
import type { CommandContext } from './context.js';
import { runContext } from './context-cost.js';
import { runHistory } from './history.js';
import { readOptimizationHistory } from './optimization-history.js';

const DEFAULT_RESERVE = 20;

function dedupeDiagnostics(items: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of items) {
    const key = [item.severity, item.code, item.subject ?? '', item.path ?? '', item.message].join(
      '\0',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

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

  // A configured capacity is not evidence that any bytes are actually loaded. The old renderer
  // could therefore recommend reducing context while explaining it with "0B known loaded of ...",
  // which made a correct recommendation from another signal look self-contradictory. Only attach
  // budget evidence when there is a measured numerator; otherwise fall back to discovered
  // candidates and state that admission is not proven.
  if (
    context.harnesses === undefined ||
    harness.projectDocMaxBytes === null ||
    harness.projectDocMaxBytes <= 0 ||
    instructionBytes <= 0
  ) {
    if (discoveredBytes > 0) {
      if (discoveredBytes >= 32 * 1024) score = Math.max(score, 1);
      evidence.push({
        code: 'instruction-candidates',
        summary:
          String(discoveredBytes) +
          'B of instruction candidates; admitted bytes are not fully proven',
      });
    }
  } else {
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

function quotaEvidence(pace: readonly WindowPaceAssessment[]): RecommendationEvidence[] {
  return pace
    .filter((item) => item.state !== 'unknown' && item.scope !== 'credit')
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

function adviceForHarness(input: {
  contextReport: ContextReport;
  context: HarnessContextObservation;
  budgetReport: BudgetReport;
  budgetWindows: ReturnType<typeof assessWindowPace>[];
  benchmarkReceipts: readonly TaskBenchmarkReceipt[] | null;
  observedAt: string;
  reservePercent: number;
  tasksRemaining: number | null;
  localBurnTrend: LocalBurnTrend | null;
  recentSession: SessionBoundarySignal | null;
  taskClass: TaskClass;
  profile: BudgetProfile;
}): HarnessOptimizationAdvice {
  const {
    context,
    contextReport,
    budgetReport,
    budgetWindows,
    localBurnTrend,
    recentSession,
    taskClass,
    profile,
    reservePercent,
  } = input;
  const diagnostics = [...context.diagnostics];
  const pressure = contextEvidence(contextReport, context);
  const recommendations: OptimizationRecommendation[] = [];
  const capturedPolicy = benchmarkPolicySnapshot(context);
  const workloadCapacity =
    input.tasksRemaining === null || capturedPolicy === null || input.benchmarkReceipts === null
      ? null
      : estimateAcceptedTaskCapacityForPolicy({
          report: budgetReport,
          receipts: input.benchmarkReceipts,
          harnessId: context.harnessId,
          taskClass,
          reservePercent,
          policy: capturedPolicy,
        });
  const workloadCoverage = assessWorkloadCoverage({
    tasksRemaining: input.tasksRemaining,
    capacity: workloadCapacity,
  });
  const budgetDecision = constrainBudgetForWorkload(
    assessBudgetDecision(budgetWindows, taskClass),
    workloadCoverage,
  );
  const paceEvidence = [...quotaEvidence(budgetWindows), ...budgetDecision.reasons];
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
  const overPace = ['conserve', 'wait-for-reset'].includes(budgetDecision.state);
  const underPaceSoon = budgetDecision.allowEffortIncrease;

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

  if (workloadCoverage.state === 'shortfall' || workloadCoverage.state === 'exhausted') {
    recommendations.push({
      area: 'quota',
      priority: 'first',
      action:
        workloadCoverage.state === 'exhausted'
          ? 'Checkpoint or switch harness: the current exact policy has no conservative accepted-task capacity for the stated workload'
          : 'Protect capacity or switch harness: the current exact policy does not cover the stated remaining tasks',
      target:
        workloadCoverage.shortfallTasks === null ? null : String(workloadCoverage.shortfallTasks),
      evidence: [...workloadCoverage.reasons, ...quotaEvidence(budgetWindows)],
    });
  } else if (budgetDecision.state === 'wait-for-reset') {
    recommendations.push({
      area: 'quota',
      priority: 'first',
      action:
        'Save a checkpoint and recheck the exhausted allowance after its reset; do not buy or redeem credits automatically',
      target: budgetDecision.recheckAt,
      evidence: paceEvidence,
    });
  } else if (overPace) {
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
  } else if (budgetDecision.state === 'unknown') {
    recommendations.push({
      area: 'quota',
      priority: 'optional',
      action:
        'Keep the task-class policy without a quota bonus; refresh incomplete or ambiguous allowance evidence',
      target: null,
      evidence: budgetDecision.reasons,
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
  const nativeEffort = context.nativeEffort;
  const currentEffort =
    context.reasoningEffort ??
    catalogModel?.defaultReasoningEffort ??
    nativeEffort?.current ??
    null;
  const baseRecommendedEffort =
    catalogModel === null && (nativeEffort == null || !nativeEffort.writable)
      ? null
      : chooseSupportedEffort({
          supported: catalogModel?.supportedReasoningEfforts ?? nativeEffort?.supported ?? [],
          current: currentEffort,
          defaultEffort: catalogModel?.defaultReasoningEffort ?? null,
          taskClass,
          profile,
          pace: budgetWindows,
          contextPressure: pressure.pressure,
          budgetDecision,
        });
  const effortLearning = refineEffortWithOutcomes({
    harnessId: context.harnessId,
    model: capturedPolicy?.model ?? null,
    verbosity: capturedPolicy?.verbosity ?? null,
    taskClass,
    profile,
    supported: catalogModel?.supportedReasoningEfforts ?? nativeEffort?.supported ?? [],
    baseEffort: baseRecommendedEffort,
    budget: budgetDecision,
    contextPressure: pressure.pressure,
    now: input.observedAt,
    receipts: input.benchmarkReceipts,
  });

  const exactCapacity = (effort: string | null) =>
    effort === null || capturedPolicy === null || input.benchmarkReceipts === null
      ? null
      : estimateAcceptedTaskCapacityForPolicy({
          report: budgetReport,
          receipts: input.benchmarkReceipts,
          harnessId: context.harnessId,
          taskClass,
          reservePercent,
          policy: {
            model: capturedPolicy.model,
            reasoningEffort: effort,
            verbosity: capturedPolicy.verbosity,
          },
        });
  const qualityPerAllowance = refineEffortForAllowance({
    taskClass,
    learning: effortLearning,
    baseCapacity: exactCapacity(effortLearning.baseEffort),
    candidateCapacity: exactCapacity(effortLearning.candidateEffort),
  });
  const recommendedEffort =
    qualityPerAllowance.state === 'unavailable'
      ? effortLearning.recommendedEffort
      : qualityPerAllowance.recommendedEffort;

  const canLearnVerbosity =
    capturedPolicy !== null &&
    capturedPolicy.model !== null &&
    capturedPolicy.reasoningEffort !== null &&
    capturedPolicy.reasoningEffort === currentEffort &&
    capturedPolicy.verbosity !== null &&
    VERBOSITY_LEVELS.includes(capturedPolicy.verbosity as (typeof VERBOSITY_LEVELS)[number]) &&
    recommendedEffort === currentEffort &&
    effortLearning.state !== 'learned' &&
    effortLearning.state !== 'deferred' &&
    qualityPerAllowance.state !== 'deferred';
  const verbosityLearning = canLearnVerbosity
    ? refineVerbosityWithOutcomes({
        harnessId: context.harnessId,
        model: capturedPolicy.model,
        reasoningEffort: capturedPolicy.reasoningEffort,
        taskClass,
        supported: VERBOSITY_LEVELS,
        baseVerbosity: capturedPolicy.verbosity,
        budget: budgetDecision,
        contextPressure: pressure.pressure,
        now: input.observedAt,
        receipts: input.benchmarkReceipts,
      })
    : null;
  const exactVerbosityCapacity = (verbosity: string | null) =>
    verbosity === null ||
    capturedPolicy === null ||
    capturedPolicy.model === null ||
    capturedPolicy.reasoningEffort === null ||
    input.benchmarkReceipts === null
      ? null
      : estimateAcceptedTaskCapacityForPolicy({
          report: budgetReport,
          receipts: input.benchmarkReceipts,
          harnessId: context.harnessId,
          taskClass,
          reservePercent,
          policy: {
            model: capturedPolicy.model,
            reasoningEffort: capturedPolicy.reasoningEffort,
            verbosity,
          },
        });
  const verbosityPerAllowance =
    verbosityLearning === null
      ? null
      : refineVerbosityForAllowance({
          taskClass,
          learning: verbosityLearning,
          baseCapacity: exactVerbosityCapacity(verbosityLearning.baseVerbosity),
          candidateCapacity: exactVerbosityCapacity(verbosityLearning.candidateVerbosity),
        });

  const preModelRecommendedVerbosity =
    effortLearning.state === 'deferred' || qualityPerAllowance.state === 'deferred'
      ? null
      : recommendedEffort !== currentEffort
        ? context.verbosity
        : verbosityLearning === null
          ? context.verbosity
          : verbosityLearning.state === 'deferred'
            ? null
            : verbosityPerAllowance === null
              ? verbosityLearning.baseVerbosity
              : verbosityPerAllowance.state === 'unavailable'
                ? verbosityLearning.baseVerbosity
                : verbosityPerAllowance.recommendedVerbosity;

  const catalogModelNames = [
    ...new Set(context.availableModels.flatMap((model) => [model.id, model.model])),
  ];
  const canLearnModel =
    capturedPolicy !== null &&
    capturedPolicy.model !== null &&
    capturedPolicy.reasoningEffort !== null &&
    capturedPolicy.reasoningEffort === currentEffort &&
    capturedPolicy.verbosity !== null &&
    capturedPolicy.verbosity === context.verbosity &&
    catalogModel !== null &&
    !context.modelCatalogTruncated &&
    recommendedEffort === currentEffort &&
    preModelRecommendedVerbosity === context.verbosity &&
    effortLearning.state !== 'learned' &&
    effortLearning.state !== 'deferred' &&
    verbosityLearning?.state !== 'learned' &&
    verbosityLearning?.state !== 'deferred' &&
    qualityPerAllowance.state !== 'deferred' &&
    verbosityPerAllowance?.state !== 'deferred';
  const modelLearning = canLearnModel
    ? refineModelWithOutcomes({
        harnessId: context.harnessId,
        baseModel: capturedPolicy.model,
        reasoningEffort: capturedPolicy.reasoningEffort,
        verbosity: capturedPolicy.verbosity,
        taskClass,
        availableModels: catalogModelNames,
        now: input.observedAt,
        receipts: input.benchmarkReceipts,
      })
    : null;
  const exactModelCapacity = (model: string | null) =>
    model === null ||
    capturedPolicy === null ||
    capturedPolicy.reasoningEffort === null ||
    capturedPolicy.verbosity === null ||
    input.benchmarkReceipts === null
      ? null
      : estimateAcceptedTaskCapacityForPolicy({
          report: budgetReport,
          receipts: input.benchmarkReceipts,
          harnessId: context.harnessId,
          taskClass,
          reservePercent,
          policy: {
            model,
            reasoningEffort: capturedPolicy.reasoningEffort,
            verbosity: capturedPolicy.verbosity,
          },
        });
  const modelPerAllowance =
    modelLearning === null
      ? null
      : refineModelForAllowance({
          taskClass,
          learning: modelLearning,
          baseCapacity: exactModelCapacity(modelLearning.baseModel),
          candidateCapacity: exactModelCapacity(modelLearning.candidateModel),
        });

  if (effortLearning.state === 'learned' || effortLearning.state === 'deferred') {
    const allowanceEvidence =
      qualityPerAllowance.state === 'unavailable' ? [] : qualityPerAllowance.reasons;
    recommendations.push({
      area: 'history',
      priority: 'first',
      action:
        effortLearning.state === 'deferred'
          ? 'Review task outcomes and quota/context constraints before another native policy change'
          : qualityPerAllowance.state === 'kept'
            ? 'Keep the base effort because the quality-gated lower effort does not improve backend allowance throughput'
            : qualityPerAllowance.state === 'deferred'
              ? 'Checkpoint or switch harness before spending more reasoning effort on this task'
              : qualityPerAllowance.state === 'allowance-efficient'
                ? 'Use the quality-gated effort that increases accepted-task throughput per included allowance'
                : 'Use the effort supported by repeated project task outcomes; keep verbosity unchanged',
      target: recommendedEffort,
      evidence: [...effortLearning.reasons, ...allowanceEvidence],
    });
  }

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

  const recommendedModel =
    catalogModel === null
      ? null
      : modelLearning === null
        ? context.model
        : modelLearning.state === 'deferred'
          ? null
          : modelPerAllowance === null || modelPerAllowance.state === 'unavailable'
            ? context.model
            : modelPerAllowance.recommendedModel;
  if (catalogModel !== null) {
    const modelEvidence: RecommendationEvidence[] = [
      {
        code: 'model-catalog',
        summary:
          catalogModel.displayName +
          ' is present in the installed native catalog; no cost or quality tier is inferred from its name',
      },
      ...(modelLearning?.reasons ?? []),
      ...(modelPerAllowance?.reasons ?? []),
    ];
    recommendations.push({
      area: 'model',
      priority:
        modelPerAllowance?.state === 'quality-recovery'
          ? 'first'
          : modelPerAllowance?.state === 'allowance-efficient'
            ? 'next'
            : 'optional',
      action:
        modelLearning?.state === 'deferred' || modelPerAllowance?.state === 'deferred'
          ? 'Checkpoint or recheck allowance before another model change; no proven catalog alternative currently fits the safe capacity'
          : recommendedModel === context.model
            ? modelPerAllowance?.state === 'kept'
              ? 'Keep the current model because the outcome-safe alternative does not improve backend allowance throughput'
              : modelPerAllowance?.state === 'capacity-unproven'
                ? 'Keep the current model until both models have complete exact-policy five-hour and weekly allowance evidence'
                : 'Keep the current discovered model until repeated paired outcome and allowance evidence proves an alternative'
            : modelPerAllowance?.state === 'allowance-efficient'
              ? 'Use the quality-gated catalog model that improves accepted-task throughput per included allowance'
              : 'Use the catalog model supported by repeated quality/retry recovery evidence',
      target: recommendedModel,
      evidence: modelEvidence,
    });
  }

  if (recommendedEffort !== null) {
    const evidence: RecommendationEvidence[] = [
      {
        code: 'task-quality-floor',
        summary: taskClass + ' task under the ' + profile + ' profile',
      },
      ...paceEvidence,
      ...(qualityPerAllowance.state === 'unavailable' ? [] : qualityPerAllowance.reasons),
    ];
    if (nativeEffort != null)
      evidence.push({
        code: 'configured-native-effort',
        summary:
          'Claude persistent preference only; active-session effort and managed overrides are not observed',
      });
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

  if (verbosityLearning?.state === 'deferred' || verbosityPerAllowance?.state === 'deferred') {
    recommendations.push({
      area: 'history',
      priority: 'first',
      action:
        'Checkpoint, recheck allowance or reduce context before applying the quality-recovery verbosity change',
      target: null,
      evidence: [...(verbosityLearning?.reasons ?? []), ...(verbosityPerAllowance?.reasons ?? [])],
    });
  }

  const recommendedVerbosity = preModelRecommendedVerbosity;
  if (recommendedVerbosity !== null) {
    const verbosityEvidence: RecommendationEvidence[] = [
      { code: 'task-class', summary: taskClass + ' task' },
      ...paceEvidence,
      ...pressure.evidence,
      ...(verbosityLearning?.reasons ?? []),
      ...(verbosityPerAllowance?.reasons ?? []),
    ];
    recommendations.push({
      area: 'verbosity',
      priority: verbosityPerAllowance?.state === 'quality-recovery' ? 'next' : 'optional',
      action:
        recommendedVerbosity === context.verbosity
          ? verbosityPerAllowance?.state === 'kept'
            ? 'Keep current verbosity because the lower candidate has not improved backend allowance throughput'
            : 'Keep the current verbosity until exact single-control outcome and allowance evidence supports a change'
          : verbosityPerAllowance?.state === 'allowance-efficient'
            ? 'Use the quality-gated lower verbosity that improves accepted-task throughput per included allowance'
            : 'Use the higher verbosity supported by repeated quality/retry recovery evidence',
      target: recommendedVerbosity,
      evidence: verbosityEvidence,
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
    effortLearning,
    ...(verbosityLearning === null ? {} : { verbosityLearning }),
    ...(modelLearning === null ? {} : { modelLearning }),
    currentVerbosity: context.verbosity,
    recommendedVerbosity,
    contextPressure: pressure.pressure,
    localBurnTrend,
    recentSession,
    pace: budgetWindows,
    budgetDecision,
    ...(input.tasksRemaining === null ? {} : { workloadCoverage }),
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

  const [budgetResult, contextResult, historyResult, outcomeHistory] = await Promise.all([
    runBudget(context),
    runContext(context),
    runHistory(context),
    readOptimizationHistory(context),
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
    tasksRemaining: context.tasksRemaining ?? null,
    harnesses: [],
  };

  if (contextReport === null || budgetReport === null) {
    return commandResult({
      command: 'optimize',
      exitCode: EXIT_CODES.ok,
      data: report,
      diagnostics: dedupeDiagnostics([
        ...budgetResult.diagnostics,
        ...contextResult.diagnostics,
        ...historyResult.diagnostics,
      ]),
    });
  }

  for (const harnessContext of contextReport.harnesses) {
    const budget = budgetReport.harnesses.find(
      (item) => item.harnessId === harnessContext.harnessId,
    );
    const pace =
      budget?.state === 'observed' &&
      budget.windows.every((window) => window.harnessId === harnessContext.harnessId)
        ? budget.windows.map((window) =>
            assessWindowPace(window, report.observedAt, reservePercent),
          )
        : [];
    report.harnesses.push(
      adviceForHarness({
        contextReport,
        context: harnessContext,
        budgetReport,
        budgetWindows: pace,
        benchmarkReceipts: outcomeHistory.receipts,
        observedAt: report.observedAt,
        reservePercent,
        tasksRemaining: context.tasksRemaining ?? null,
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
    diagnostics: dedupeDiagnostics([
      ...budgetResult.diagnostics,
      ...contextResult.diagnostics,
      ...historyResult.diagnostics,
      ...report.harnesses.flatMap((item) => item.diagnostics),
    ]),
  });
}
