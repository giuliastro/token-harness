/** Exploratory four-arm effects; units and runtime evidence never get blended. */
import {
  comparableQuotaDeltas,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
} from './benchmark.js';
import {
  FACTORIAL_BENCHMARK_ARMS,
  parseTaskBenchmarkFactorialExperiment,
  sameQualityGateEvidence,
  type TaskBenchmarkFactorialArm,
} from './benchmark-quality.js';

export interface TaskBenchmarkFactorialEffect {
  unit: 'local-tokens' | 'percentage-points';
  windowKey: string | null;
  scope: string | null;
  compressionSaving: number | null;
  routingSaving: number | null;
  combinedSaving: number | null;
  /** Cost above additive prediction: positive means interference, negative means synergy. */
  interactionCost: number | null;
}

export interface TaskBenchmarkFactorialReport {
  benchmarkId: string;
  status: 'incomplete' | 'incomparable' | 'quality-blocked' | 'routing-unverified' | 'complete';
  interpretation: 'exploratory';
  configurationEvidence: 'user-declared' | 'managed-config-only';
  missingArms: TaskBenchmarkFactorialArm[];
  quality: Partial<Record<TaskBenchmarkFactorialArm, TaskQualityGate>>;
  qualitySources: Partial<Record<TaskBenchmarkFactorialArm, 'user-recorded' | 'check-command'>>;
  qualityMismatches: TaskBenchmarkFactorialArm[];
  combinedQualityRegression: boolean;
  effects: TaskBenchmarkFactorialEffect[];
  reasons: string[];
}

function routingMatches(receipt: TaskBenchmarkReceipt, enabled: boolean): boolean {
  const before = receipt.nativeRoutingAtStart;
  const after = receipt.nativeRoutingAtFinish;
  if (
    before == null ||
    after == null ||
    before.configured !== enabled ||
    after.configured !== enabled
  )
    return false;
  return enabled
    ? after.promptSubmissions > 0 && after.subagentsStarted > 0
    : after.subagentsStarted === 0;
}

export function buildTaskBenchmarkFactorialReport(
  benchmarkId: string,
  receipts: Partial<Record<TaskBenchmarkFactorialArm, TaskBenchmarkReceipt>>,
): TaskBenchmarkFactorialReport {
  const report: TaskBenchmarkFactorialReport = {
    benchmarkId,
    status: 'incomplete',
    interpretation: 'exploratory',
    configurationEvidence: 'user-declared',
    missingArms: [],
    quality: {},
    qualitySources: {},
    qualityMismatches: [],
    combinedQualityRegression: false,
    effects: [],
    reasons: [
      'Arm settings and starting state are user-declared; compression activation is not proven by labels.',
      'One four-arm set is exploratory; repeat controlled sets before attributing a stable interaction.',
    ],
  };
  for (const arm of FACTORIAL_BENCHMARK_ARMS) {
    const receipt = receipts[arm];
    if (receipt === undefined) report.missingArms.push(arm);
    else {
      report.quality[arm] = receipt.outcome.qualityGate;
      report.qualitySources[arm] = receipt.outcome.qualityEvidence?.source ?? 'user-recorded';
      const evidence = receipt.outcome.qualityEvidence;
      if (
        evidence?.source === 'check-command' &&
        evidence.userRecordedQuality !== null &&
        evidence.userRecordedQuality !== receipt.outcome.qualityGate
      )
        report.qualityMismatches.push(arm);
    }
  }
  if (Object.values(receipts).some((r) => r.experiment?.configuration !== undefined)) {
    report.configurationEvidence = 'managed-config-only';
    report.reasons[0] =
      'Managed arm configuration was inspected; this is config-only evidence, not proof of runtime compression or a restored Git tree.';
  }
  if (report.missingArms.length > 0) {
    report.reasons.push('All four arms are required for a factorial report.');
    return report;
  }
  const baseline = receipts.baseline!;
  const compression = receipts['compression-only']!;
  const routing = receipts['routing-only']!;
  const combined = receipts.combined!;
  if (
    FACTORIAL_BENCHMARK_ARMS.some((arm) => {
      const receipt = receipts[arm]!;
      return (
        receipt.variant !== arm ||
        receipt.benchmarkId !== benchmarkId ||
        parseTaskBenchmarkFactorialExperiment(receipt.experiment, arm) === null ||
        baseline.experiment === undefined ||
        receipt.experiment?.startingState !== baseline.experiment.startingState ||
        receipt.experiment?.configuration?.initialConfigurationId !==
          baseline.experiment.configuration?.initialConfigurationId ||
        JSON.stringify(receipt.experiment?.configuration?.providers) !==
          JSON.stringify(baseline.experiment.configuration?.providers) ||
        receipt.taskClass !== baseline.taskClass ||
        receipt.harnessId !== baseline.harnessId ||
        receipt.model !== baseline.model ||
        receipt.reasoningEffort !== baseline.reasoningEffort ||
        receipt.verbosity !== baseline.verbosity ||
        (receipt.policyAtFinish != null &&
          (receipt.policyAtFinish.model !== receipt.model ||
            receipt.policyAtFinish.reasoningEffort !== receipt.reasoningEffort ||
            receipt.policyAtFinish.verbosity !== receipt.verbosity)) ||
        !sameQualityGateEvidence(baseline.outcome.qualityEvidence, receipt.outcome.qualityEvidence)
      );
    })
  ) {
    report.status = 'incomparable';
    report.reasons.push(
      'Task, harness, root policy, starting state, arm roles or quality-check identity differ.',
    );
    return report;
  }
  const passed = (receipt: TaskBenchmarkReceipt): boolean =>
    receipt.outcome.qualityGate === 'passed';
  const off = routingMatches(baseline, false) && routingMatches(compression, false);
  const routingObserved = off && routingMatches(routing, true);
  const combinedObserved = off && routingMatches(combined, true);
  const compressionEligible = passed(baseline) && passed(compression) && off;
  const routingEligible = passed(baseline) && passed(routing) && routingObserved;
  const combinedEligible = passed(baseline) && passed(combined) && combinedObserved;
  const interactionEligible = compressionEligible && routingEligible && combinedEligible;
  report.combinedQualityRegression = passed(baseline) && combined.outcome.qualityGate === 'failed';
  report.status = !FACTORIAL_BENCHMARK_ARMS.every((arm) => passed(receipts[arm]!))
    ? 'quality-blocked'
    : !routingObserved || !combinedObserved
      ? 'routing-unverified'
      : 'complete';
  if (!routingObserved || !combinedObserved)
    report.reasons.push(
      'Routing effects require off-arm configuration and genuine on-arm prompt/subagent callbacks.',
    );
  if (report.combinedQualityRegression)
    report.reasons.push(
      'Combined quality regressed; combined savings and interaction are blocked.',
    );
  function effect(
    costs: readonly [number | null, number | null, number | null, number | null],
    unit: TaskBenchmarkFactorialEffect['unit'],
    windowKey: string | null,
    scope: string | null,
  ): TaskBenchmarkFactorialEffect {
    const [b, c, r, k] = costs;
    return {
      unit,
      windowKey,
      scope,
      compressionSaving: compressionEligible && b !== null && c !== null ? b - c : null,
      routingSaving: routingEligible && b !== null && r !== null ? b - r : null,
      combinedSaving: combinedEligible && b !== null && k !== null ? b - k : null,
      interactionCost:
        interactionEligible && b !== null && c !== null && r !== null && k !== null
          ? k - c - r + b
          : null,
    };
  }
  const local = [baseline, compression, routing, combined].map(
    (receipt) => receipt.localUsage?.totalTokens ?? null,
  );
  if (local.some((cost) => cost !== null))
    report.effects.push(
      effect(
        local as [number | null, number | null, number | null, number | null],
        'local-tokens',
        null,
        null,
      ),
    );
  const quota = [baseline, compression, routing, combined].map(
    (receipt) => new Map(comparableQuotaDeltas(receipt).map((delta) => [delta.key, delta])),
  );
  for (const [key, delta] of quota[0]!) {
    const matches = quota.map((windows) => windows.get(key));
    if (matches.some((match) => match === undefined || match.resetsAt !== delta.resetsAt)) continue;
    report.effects.push(
      effect(
        matches.map((match) => match!.usedPercentDelta) as [number, number, number, number],
        'percentage-points',
        key,
        delta.scope,
      ),
    );
  }
  if (report.effects.length === 0)
    report.reasons.push(
      'No comparable local usage or common authoritative/reported quota window is available.',
    );
  return report;
}
