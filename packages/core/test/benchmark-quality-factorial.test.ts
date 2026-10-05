import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTaskBenchmarkFactorialReport,
  buildTaskBenchmarkMatrix,
  compareTaskBenchmarkReceipts,
  completeTaskBenchmarkCapture,
  factorialExperimentForArm,
  harnessId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkCheck,
  parseTaskBenchmarkReceipt,
  qualityFromCheckOutcome,
  type TaskBenchmarkReceipt,
  type TaskBenchmarkVariant,
  type TaskBenchmarkQualityEvidence,
  type UsageWindowSnapshot,
} from '../src/index.js';

const check = { executable: 'npm', args: ['run', 'verify'], timeoutMs: 300000 };
function quality(exitCode: number | null = 0): TaskBenchmarkQualityEvidence {
  return {
    source: 'check-command',
    check,
    exitCode,
    signal: null,
    failureReason: null,
    durationMs: 1,
    output: null,
    userRecordedQuality: null,
  };
}
function window(scope: 'five-hour' | 'weekly', used: number): UsageWindowSnapshot {
  return {
    harnessId: harnessId('codex'),
    bucketId: 'main',
    bucketName: 'Main',
    window: scope === 'weekly' ? 'secondary' : 'primary',
    scope,
    usedPercent: used,
    remainingPercent: 100 - used,
    windowDurationMinutes: scope === 'weekly' ? 10080 : 300,
    resetsAt: '2026-10-05T16:00:00Z',
    observedAt: '2026-10-05T12:00:00Z',
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}
function receipt(variant: TaskBenchmarkVariant, cost = 100): TaskBenchmarkReceipt {
  const experiment = factorialExperimentForArm(variant, 'initial-commit');
  const routed = experiment?.routing ?? variant === 'optimized';
  return {
    schemaVersion: 2,
    benchmarkId: 'factorial-test',
    variant,
    ...(experiment === null ? {} : { experiment }),
    taskClass: 'standard',
    harnessId: harnessId('codex'),
    model: 'gpt-6.1-sol',
    reasoningEffort: 'medium',
    verbosity: 'low',
    startedAt: '2026-10-05T12:00:00Z',
    completedAt: '2026-10-05T12:05:00Z',
    usageBefore: [window('five-hour', 20), window('weekly', 20)],
    usageAfter: [window('five-hour', 20 + cost / 100), window('weekly', 20 + cost / 1000)],
    localUsage: {
      inputTokens: cost,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: cost,
    },
    outcome: {
      qualityGate: 'passed',
      qualityEvidence: quality(),
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
    nativeRoutingAtStart: {
      configured: routed,
      promptSubmissions: 0,
      subagentsStarted: 0,
      subagentsStopped: 0,
      reportedModels: [],
    },
    nativeRoutingAtFinish: {
      configured: routed,
      promptSubmissions: 1,
      subagentsStarted: routed ? 1 : 0,
      subagentsStopped: routed ? 1 : 0,
      reportedModels: routed ? ['gpt-6-luna'] : [],
    },
  };
}
function pair() {
  const baseline = receipt('baseline');
  delete baseline.experiment;
  const optimized = receipt('optimized', 70);
  return { baseline, optimized };
}
function four() {
  return {
    baseline: receipt('baseline', 1000),
    'compression-only': receipt('compression-only', 800),
    'routing-only': receipt('routing-only', 700),
    combined: receipt('combined', 600),
  };
}

describe('benchmark quality provenance and schema compatibility', () => {
  it('accepts legacy schema-1 receipts without fabricating automated evidence', () => {
    const { baseline } = pair();
    baseline.schemaVersion = 1;
    delete baseline.outcome.qualityEvidence;
    const parsed = parseTaskBenchmarkReceipt(baseline);
    assert.ok(parsed.ok);
    assert.equal(parsed.receipt.schemaVersion, 1);
    assert.equal(parsed.receipt.outcome.qualityEvidence, undefined);
    assert.equal(parseTaskBenchmarkReceipt({ ...baseline, schemaVersion: 3 }).ok, false);
    assert.equal(parseTaskBenchmarkReceipt({ ...receipt('combined'), schemaVersion: 1 }).ok, false);
  });
  it('rejects invalid check shapes and inconsistent check outcomes', () => {
    for (const value of [
      'npm test',
      { ...check, executable: '' },
      { ...check, args: ['bad\narg'] },
      { ...check, timeoutMs: 0 },
    ])
      assert.equal(parseTaskBenchmarkCheck(value), null);
    const { baseline } = pair();
    baseline.outcome.qualityEvidence = quality(1);
    assert.equal(parseTaskBenchmarkReceipt(baseline).ok, false);
    baseline.outcome.qualityGate = 'failed';
    assert.equal(parseTaskBenchmarkReceipt(baseline).ok, true);
  });
  it('marks timeout, signal and start failure unknown even with an exit code', () => {
    const base = { exitCode: 0, signal: null, failure: null, timedOut: false };
    assert.equal(qualityFromCheckOutcome(base), 'passed');
    assert.equal(qualityFromCheckOutcome({ ...base, exitCode: 1 }), 'failed');
    assert.equal(qualityFromCheckOutcome({ ...base, timedOut: true }), 'unknown');
    assert.equal(qualityFromCheckOutcome({ ...base, signal: 'SIGTERM' }), 'unknown');
    assert.equal(
      qualityFromCheckOutcome({ ...base, failure: { reason: 'spawn-failed', message: 'fixture' } }),
      'unknown',
    );
  });
  it('blocks pair, matrix and routing savings when provenance or exact check differs', () => {
    for (const change of ['source', 'args', 'timeout'] as const) {
      const { baseline, optimized } = pair();
      optimized.outcome.qualityEvidence =
        change === 'source'
          ? { source: 'user-recorded' }
          : {
              ...quality(),
              source: 'check-command',
              check: {
                ...check,
                args: change === 'args' ? ['test'] : check.args,
                timeoutMs: change === 'timeout' ? 1000 : check.timeoutMs,
              },
              exitCode: 0,
              signal: null,
              failureReason: null,
              durationMs: 1,
              output: null,
              userRecordedQuality: null,
            };
      assert.equal(compareTaskBenchmarkReceipts(baseline, optimized).verdict, 'incomparable');
      const matrix = buildTaskBenchmarkMatrix([{ baseline, optimized }]);
      assert.equal(matrix.overall.localTokenSavingPercent, null);
      assert.equal(matrix.entries[0]!.nativeRouting?.qualityGatesPassed, false);
      assert.deepEqual(matrix.entries[0]!.quotaComparisons, []);
    }
  });
  it('exposes disagreements in matrix results and fixes the check at capture completion', () => {
    const { baseline, optimized } = pair();
    optimized.outcome.qualityEvidence = {
      ...quality(),
      source: 'check-command',
      check,
      exitCode: 0,
      signal: null,
      failureReason: null,
      durationMs: 1,
      output: null,
      userRecordedQuality: 'failed',
    };
    assert.match(
      buildTaskBenchmarkMatrix([{ baseline, optimized }]).entries[0]!.qualityMismatches![0]!,
      /user recorded failed; check passed/,
    );
    const capture = {
      ...baseline,
      projectId: 'p_test',
      localSessionsBefore: null,
      qualityCheck: check,
    };
    const parsed = parseTaskBenchmarkCapture(capture);
    assert.ok(parsed.ok);
    const input = {
      completedAt: baseline.completedAt,
      usageAfter: [],
      qualityGate: 'passed' as const,
      attempts: 1,
      failedAttempts: 0,
    };
    assert.equal(completeTaskBenchmarkCapture(parsed.capture, input).ok, false);
    assert.equal(
      completeTaskBenchmarkCapture(parsed.capture, { ...input, qualityEvidence: quality() }).ok,
      true,
    );
  });
});

describe('exploratory factorial effects', () => {
  it('keeps managed configuration at config-only and rejects mixed origins or initial fingerprints', () => {
    const arms = four();
    for (const receipt of Object.values(arms))
      receipt.experiment!.configuration = {
        source: 'managed-config-only',
        transactionId: 'factorial-' + 'a'.repeat(24),
        planId: '12345678',
        providers: ['rtk'],
        initialConfigurationId: 'sha256:' + 'b'.repeat(64),
      };
    const report = buildTaskBenchmarkFactorialReport('factorial-test', arms);
    assert.equal(report.status, 'complete');
    assert.equal(report.configurationEvidence, 'managed-config-only');
    assert.match(report.reasons[0]!, /config-only/);
    for (const r of Object.values(arms)) assert.equal(parseTaskBenchmarkReceipt(r).ok, true);
    arms.combined.experiment!.configuration!.initialConfigurationId = 'sha256:' + 'c'.repeat(64);
    assert.equal(buildTaskBenchmarkFactorialReport('factorial-test', arms).status, 'incomparable');
    delete arms.combined.experiment!.configuration;
    assert.equal(buildTaskBenchmarkFactorialReport('factorial-test', arms).status, 'incomparable');
  });
  it('calculates single effects and interaction with quota windows kept independent', () => {
    const report = buildTaskBenchmarkFactorialReport('factorial-test', four());
    assert.equal(report.status, 'complete');
    assert.equal(report.configurationEvidence, 'user-declared');
    const local = report.effects.find((e) => e.unit === 'local-tokens')!;
    assert.deepEqual(local, {
      unit: 'local-tokens',
      windowKey: null,
      scope: null,
      compressionSaving: 200,
      routingSaving: 300,
      combinedSaving: 400,
      interactionCost: 100,
    });
    assert.deepEqual(
      report.effects.filter((e) => e.unit === 'percentage-points').map((e) => e.scope),
      ['five-hour', 'weekly'],
    );
    assert.equal(report.interpretation, 'exploratory');
  });
  it('blocks combined-only quality regression while retaining eligible single effects', () => {
    const arms = four();
    arms.combined.outcome.qualityGate = 'failed';
    arms.combined.outcome.qualityEvidence = quality(1);
    const report = buildTaskBenchmarkFactorialReport('factorial-test', arms);
    assert.equal(report.status, 'quality-blocked');
    assert.equal(report.combinedQualityRegression, true);
    assert.equal(report.effects[0]!.compressionSaving, 200);
    assert.equal(report.effects[0]!.routingSaving, 300);
    assert.equal(report.effects[0]!.combinedSaving, null);
    assert.equal(report.effects[0]!.interactionCost, null);
  });
  it('requires callbacks and a true routing-off baseline', () => {
    const arms = four();
    arms['routing-only'].nativeRoutingAtFinish!.subagentsStarted = 0;
    const report = buildTaskBenchmarkFactorialReport('factorial-test', arms);
    assert.equal(report.status, 'routing-unverified');
    assert.equal(report.effects[0]!.routingSaving, null);
    assert.equal(report.effects[0]!.interactionCost, null);
    arms.baseline.nativeRoutingAtFinish!.configured = true;
    assert.equal(
      buildTaskBenchmarkFactorialReport('factorial-test', arms).effects[0]!.compressionSaving,
      null,
    );
  });
  it('rejects mixed trees, policies, gate identities, roles and malformed flags', () => {
    for (const mutation of ['tree', 'policy', 'gate', 'role', 'flags'] as const) {
      const arms = four();
      const r = arms.combined;
      if (mutation === 'tree') r.experiment!.startingState = 'other';
      if (mutation === 'policy') r.model = 'different';
      if (mutation === 'gate') r.outcome.qualityEvidence = { source: 'user-recorded' };
      if (mutation === 'role') r.variant = 'optimized';
      if (mutation === 'flags') r.experiment!.compression = false;
      const report = buildTaskBenchmarkFactorialReport('factorial-test', arms);
      assert.equal(report.status, 'incomparable');
      assert.deepEqual(report.effects, []);
    }
  });
  it('reports missing arms without inventing an optimized-as-combined receipt', () => {
    const report = buildTaskBenchmarkFactorialReport('factorial-test', {
      baseline: four().baseline,
    });
    assert.equal(report.status, 'incomplete');
    assert.deepEqual(report.missingArms, ['compression-only', 'routing-only', 'combined']);
    assert.deepEqual(report.effects, []);
  });
  it('does not combine different resets or missing quota evidence', () => {
    const arms = four();
    arms.combined.usageBefore[0]!.resetsAt = '2026-10-05T17:00:00Z';
    arms.combined.usageAfter[0]!.resetsAt = '2026-10-05T17:00:00Z';
    const report = buildTaskBenchmarkFactorialReport('factorial-test', arms);
    assert.deepEqual(
      report.effects.filter((e) => e.unit === 'percentage-points').map((e) => e.scope),
      ['weekly'],
    );
  });
});
