import fs from 'node:fs';

function replace(path, before, after) {
  const current = fs.readFileSync(path, 'utf8');
  if (!current.includes(before)) throw new Error(`missing replacement anchor in ${path}`);
  fs.writeFileSync(path, current.replace(before, after));
}

function replaceBetween(path, startMarker, endMarker, replacement) {
  const current = fs.readFileSync(path, 'utf8');
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`missing range anchor in ${path}`);
  fs.writeFileSync(path, current.slice(0, start) + replacement + current.slice(end));
}

replace(
  'packages/core/src/domain/optimizer.ts',
  "import type { EffortLearningDecision } from './outcome-learning.js';\n",
  "import type { EffortLearningDecision } from './outcome-learning.js';\nimport type { VerbosityLearningDecision } from './verbosity-learning.js';\n",
);
replace(
  'packages/core/src/domain/optimizer.ts',
  "  /** Additive project-local feedback; legacy reports may omit it. */\n  effortLearning?: EffortLearningDecision;\n  recommendations: OptimizationRecommendation[];",
  "  /** Additive project-local feedback; legacy reports may omit it. */\n  effortLearning?: EffortLearningDecision;\n  /** Additive single-control verbosity feedback; legacy reports may omit it. */\n  verbosityLearning?: VerbosityLearningDecision;\n  recommendations: OptimizationRecommendation[];",
);

replace(
  'apps/cli/src/commands/optimize.ts',
  "  refineEffortForAllowance,\n  refineEffortWithOutcomes,\n",
  "  refineEffortForAllowance,\n  refineEffortWithOutcomes,\n  refineVerbosityForAllowance,\n  refineVerbosityWithOutcomes,\n  VERBOSITY_LEVELS,\n",
);
replaceBetween(
  'apps/cli/src/commands/optimize.ts',
  'function verbosityTarget(input: {',
  'function adviceForHarness(input: {',
  '',
);
replace(
  'apps/cli/src/commands/optimize.ts',
  "  const recommendedEffort =\n    qualityPerAllowance.state === 'unavailable'\n      ? effortLearning.recommendedEffort\n      : qualityPerAllowance.recommendedEffort;\n  if (effortLearning.state === 'learned' || effortLearning.state === 'deferred') {",
  "  const recommendedEffort =\n    qualityPerAllowance.state === 'unavailable'\n      ? effortLearning.recommendedEffort\n      : qualityPerAllowance.recommendedEffort;\n\n  const canLearnVerbosity =\n    capturedPolicy !== null &&\n    capturedPolicy.model !== null &&\n    capturedPolicy.reasoningEffort !== null &&\n    capturedPolicy.reasoningEffort === currentEffort &&\n    capturedPolicy.verbosity !== null &&\n    VERBOSITY_LEVELS.includes(\n      capturedPolicy.verbosity as (typeof VERBOSITY_LEVELS)[number],\n    ) &&\n    recommendedEffort === currentEffort &&\n    effortLearning.state !== 'learned' &&\n    effortLearning.state !== 'deferred' &&\n    qualityPerAllowance.state !== 'deferred';\n  const verbosityLearning = canLearnVerbosity\n    ? refineVerbosityWithOutcomes({\n        harnessId: context.harnessId,\n        model: capturedPolicy.model,\n        reasoningEffort: capturedPolicy.reasoningEffort,\n        taskClass,\n        supported: VERBOSITY_LEVELS,\n        baseVerbosity: capturedPolicy.verbosity,\n        budget: budgetDecision,\n        contextPressure: pressure.pressure,\n        now: input.observedAt,\n        receipts: input.benchmarkReceipts,\n      })\n    : null;\n  const exactVerbosityCapacity = (verbosity: string | null) =>\n    verbosity === null ||\n    capturedPolicy === null ||\n    capturedPolicy.model === null ||\n    capturedPolicy.reasoningEffort === null ||\n    input.benchmarkReceipts === null\n      ? null\n      : estimateAcceptedTaskCapacityForPolicy({\n          report: budgetReport,\n          receipts: input.benchmarkReceipts,\n          harnessId: context.harnessId,\n          taskClass,\n          reservePercent,\n          policy: {\n            model: capturedPolicy.model,\n            reasoningEffort: capturedPolicy.reasoningEffort,\n            verbosity,\n          },\n        });\n  const verbosityPerAllowance =\n    verbosityLearning === null\n      ? null\n      : refineVerbosityForAllowance({\n          taskClass,\n          learning: verbosityLearning,\n          baseCapacity: exactVerbosityCapacity(verbosityLearning.baseVerbosity),\n          candidateCapacity: exactVerbosityCapacity(verbosityLearning.candidateVerbosity),\n        });\n\n  if (effortLearning.state === 'learned' || effortLearning.state === 'deferred') {",
);

replaceBetween(
  'apps/cli/src/commands/optimize.ts',
  '  const recommendedVerbosity =\n',
  '  return {\n',
  `  if (\n    verbosityLearning?.state === 'deferred' ||\n    verbosityPerAllowance?.state === 'deferred'\n  ) {\n    recommendations.push({\n      area: 'history',\n      priority: 'first',\n      action:\n        'Checkpoint, recheck allowance or reduce context before applying the quality-recovery verbosity change',\n      target: null,\n      evidence: [\n        ...(verbosityLearning?.reasons ?? []),\n        ...(verbosityPerAllowance?.reasons ?? []),\n      ],\n    });\n  }\n\n  const recommendedVerbosity =\n    effortLearning.state === 'deferred' || qualityPerAllowance.state === 'deferred'\n      ? null\n      : recommendedEffort !== currentEffort\n        ? context.verbosity\n        : verbosityLearning === null\n          ? context.verbosity\n          : verbosityLearning.state === 'deferred'\n            ? null\n            : verbosityPerAllowance === null\n              ? verbosityLearning.baseVerbosity\n              : verbosityPerAllowance.state === 'unavailable'\n                ? verbosityLearning.baseVerbosity\n                : verbosityPerAllowance.recommendedVerbosity;\n  if (recommendedVerbosity !== null) {\n    const verbosityEvidence: RecommendationEvidence[] = [\n      { code: 'task-class', summary: taskClass + ' task' },\n      ...paceEvidence,\n      ...pressure.evidence,\n      ...(verbosityLearning?.reasons ?? []),\n      ...(verbosityPerAllowance?.reasons ?? []),\n    ];\n    recommendations.push({\n      area: 'verbosity',\n      priority:\n        verbosityPerAllowance?.state === 'quality-recovery' ? 'next' : 'optional',\n      action:\n        recommendedVerbosity === context.verbosity\n          ? verbosityPerAllowance?.state === 'kept'\n            ? 'Keep current verbosity because the lower candidate has not improved backend allowance throughput'\n            : 'Keep the current verbosity until exact single-control outcome and allowance evidence supports a change'\n          : verbosityPerAllowance?.state === 'allowance-efficient'\n            ? 'Use the quality-gated lower verbosity that improves accepted-task throughput per included allowance'\n            : 'Use the higher verbosity supported by repeated quality/retry recovery evidence',\n      target: recommendedVerbosity,\n      evidence: verbosityEvidence,\n    });\n  }\n\n`,
);
replace(
  'apps/cli/src/commands/optimize.ts',
  '    effortLearning,\n    currentVerbosity: context.verbosity,',
  '    effortLearning,\n    verbosityLearning: verbosityLearning ?? undefined,\n    currentVerbosity: context.verbosity,',
);

const plannerReplacement = `/** Learned single-control experiments must still describe the native plan observation. */\nfunction admitOutcomePolicy(\n  advice: HarnessOptimizationAdvice,\n  observation: HarnessContextObservation,\n  diagnostics: Diagnostic[],\n): boolean {\n  const effortLearning = advice.effortLearning;\n  const verbosityLearning = advice.verbosityLearning;\n  if (effortLearning?.state === 'deferred' || verbosityLearning?.state === 'deferred') {\n    diagnostics.push(\n      diagnostic({\n        severity: 'info',\n        code: 'outcome-native-policy-deferred',\n        subject: advice.harnessId,\n        message:\n          'Outcome evidence defers native policy changes until context or allowance is reviewed',\n        remediation:\n          'Inspect token-harness optimize for the decision and re-observe before making a new plan',\n      }),\n    );\n    return false;\n  }\n\n  if (effortLearning?.state !== 'learned' && verbosityLearning?.state !== 'learned') return true;\n  const observed = benchmarkPolicySnapshot(observation);\n  if (observed === null) {\n    diagnostics.push(\n      diagnostic({\n        severity: 'warning',\n        code: 'outcome-native-policy-drift',\n        subject: advice.harnessId,\n        message: 'The configured native policy could not be re-observed after outcome-based advice',\n        remediation:\n          'Re-run the native plan against a stable model, effort and verbosity configuration',\n      }),\n    );\n    return false;\n  }\n\n  if (effortLearning?.state === 'learned') {\n    const catalog = observation.availableModels.find(\n      (model) => model.model === observation.model || model.id === observation.model,\n    );\n    const supported = catalog?.supportedReasoningEfforts ?? observation.nativeEffort?.supported ?? [];\n    if (\n      observed.model !== effortLearning.policy.model ||\n      observed.verbosity !== effortLearning.policy.verbosity ||\n      observed.reasoningEffort !== advice.currentEffort ||\n      advice.recommendedEffort === null ||\n      !supported.includes(advice.recommendedEffort)\n    ) {\n      diagnostics.push(\n        diagnostic({\n          severity: 'warning',\n          code: 'outcome-native-policy-drift',\n          subject: advice.harnessId,\n          message:\n            'The configured policy or supported effort catalog changed after outcome-based advice',\n          remediation:\n            'Re-run the native plan against a stable model, effort and verbosity configuration',\n        }),\n      );\n      return false;\n    }\n  }\n\n  if (verbosityLearning?.state === 'learned') {\n    const knownVerbosity =\n      advice.recommendedVerbosity !== null &&\n      ['low', 'medium', 'high'].includes(advice.recommendedVerbosity);\n    if (\n      observed.model !== verbosityLearning.policy.model ||\n      observed.reasoningEffort !== verbosityLearning.policy.reasoningEffort ||\n      observed.verbosity !== advice.currentVerbosity ||\n      advice.recommendedEffort !== advice.currentEffort ||\n      advice.recommendedVerbosity === null ||\n      !knownVerbosity ||\n      (advice.recommendedVerbosity !== advice.currentVerbosity &&\n        advice.recommendedVerbosity !== verbosityLearning.candidateVerbosity)\n    ) {\n      diagnostics.push(\n        diagnostic({\n          severity: 'warning',\n          code: 'verbosity-native-policy-drift',\n          subject: advice.harnessId,\n          message:\n            'Model, effort or verbosity changed after the single-control verbosity recommendation',\n          remediation:\n            'Re-run token-harness optimize and plan against one stable native policy tuple',\n        }),\n      );\n      return false;\n    }\n  }\n\n  return true;\n}\n\n`;
replaceBetween(
  'apps/cli/src/commands/plan.ts',
  '/** Learned single-control experiments must still describe the native plan observation. */',
  'async function appendCodexNativePolicy(',
  plannerReplacement,
);

fs.appendFileSync(
  'PLAN.md',
  `\n\n## Verbosity quality-per-allowance milestone (2026-09-07, RFC 0017)\n\nThe optimizer now treats native verbosity as a separate learned control. Model and reasoning effort\nmust remain fixed across project-local paired receipts. A lower verbosity is actionable only after\nrepeated quality/retry no-regression evidence and complete exact-policy p75 backend quota cost that\nis non-worse in both five-hour and weekly windows and better in at least one. Higher verbosity is\nreserved for repeated quality/retry recovery and measured zero accepted-task capacity defers it.\nEffort and verbosity are never learned in the same optimizer step. The former pressure-only\nverbosity downgrade is intentionally removed so unknown allowance benefit cannot masquerade as an\noptimization. Managed Codex planning re-observes the exact tuple and fails closed on drift.\n`,
);
