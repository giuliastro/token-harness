import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOptimizationStack,
  harnessId,
  providerId,
  type MetricsReport,
  type ProviderDetection,
  type ProviderId,
  type ProviderUpdateRow,
  type StackQualityEvidence,
  type VerifyReport,
} from '../src/index.js';

const RTK = providerId('rtk');
const HARNESS_TRIM = providerId('harnesstrim');
const CLAUDE = harnessId('claude');

function detection(
  provider: ProviderId = RTK,
  state: ProviderDetection['state'] = 'configured',
): ProviderDetection {
  const version = provider === RTK ? '0.44.0' : '0.1.0';
  return {
    providerId: provider,
    state,
    version: state === 'absent' ? null : version,
    executable: state === 'absent' ? null : `/tools/${provider}`,
    installationChannel: state === 'absent' ? null : provider === RTK ? 'cargo' : 'npm',
    versionVerdict: state === 'absent' ? null : 'in-range',
    configuredHarnesses: state === 'configured' ? [CLAUDE] : [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: state === 'absent' ? [] : [CLAUDE],
    evidence: [],
    warnings: [],
  };
}

function verification(
  providers: readonly ProviderId[] = [RTK],
  status: 'healthy' | 'degraded' | 'not-applicable' = 'healthy',
): VerifyReport {
  return {
    receiptId: null,
    appliedAt: null,
    healthyAtDeclaredTier: status !== 'degraded',
    results: providers.map((provider) => ({
      providerId: provider,
      harnessId: CLAUDE,
      status,
      declaredTier: provider === RTK ? ('canary' as const) : ('config-only' as const),
      managedByTokenHarness: false,
      checks: [],
    })),
  };
}

function metrics(providers: readonly ProviderId[] = [RTK]): MetricsReport {
  return {
    windowStart: '2026-09-01',
    windowEnd: '2026-09-09',
    pipelineId: null,
    classes: [],
    providers: providers.flatMap((provider) =>
      provider === RTK
        ? [
            {
              providerId: RTK,
              saved: 1200,
              before: 4000,
              after: 2800,
              unit: 'tokens' as const,
              class: 'exact-local' as const,
              operations: 12,
              harnesses: [CLAUDE],
              managedByTokenHarness: false,
              adapterMode: 'native' as const,
            },
            {
              providerId: RTK,
              saved: 9000,
              unit: 'chars' as const,
              class: 'estimated-local' as const,
              operations: 3,
              harnesses: [CLAUDE],
              managedByTokenHarness: false,
              adapterMode: 'legacy' as const,
            },
          ]
        : [
            {
              providerId: HARNESS_TRIM,
              saved: 450,
              before: 1700,
              after: 1250,
              unit: 'tokens' as const,
              class: 'exact-local' as const,
              operations: 8,
              harnesses: [CLAUDE],
              managedByTokenHarness: false,
              adapterMode: 'native' as const,
            },
          ],
    ),
    coveragePercent: 80,
    bypassed: 3,
    inflatedOperations: 1,
    errors: 0,
    errorBreakdown: [],
    addedMedianLatencyMs: null,
  };
}

function currentUpdate(
  provider: ProviderId = RTK,
  verdict: ProviderUpdateRow['verdict'] = 'current',
): ProviderUpdateRow {
  const installed = provider === RTK ? '0.44.0' : '0.1.0';
  return {
    providerId: provider,
    installed,
    available: verdict === 'current' ? installed : provider === RTK ? '0.45.0' : '0.2.0',
    channel: provider === RTK ? 'cargo' : 'npm',
    verdict,
    pin: null,
  };
}

const descriptor = {
  providerId: RTK,
  displayName: 'RTK',
  category: 'command-output-reduction' as const,
};
const harnessTrimDescriptor = {
  providerId: HARNESS_TRIM,
  displayName: 'HarnessTrim',
  category: 'command-output-reduction' as const,
};

function healthyPairInput() {
  return {
    components: [descriptor, harnessTrimDescriptor],
    detections: [detection(RTK), detection(HARNESS_TRIM)],
    verification: verification([RTK, HARNESS_TRIM]),
    metrics: metrics([RTK, HARNESS_TRIM]),
    updates: [currentUpdate(RTK), currentUpdate(HARNESS_TRIM)],
  };
}

describe('optimization stack snapshot', () => {
  it('represents the healthy single-component steady state with no runtime toggle action', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate()],
    });

    assert.equal(stack.state, 'healthy');
    assert.equal(stack.combinationReview.state, 'not-applicable');
    assert.equal(stack.components.length, 1);
    const component = stack.components[0]!;
    assert.equal(component.installed, true);
    assert.equal(component.configured, true);
    assert.equal(component.verification, 'verified');
    assert.equal(component.health, 'healthy');
    assert.equal(component.update, 'current');
    assert.equal(component.nextAction, null);
  });

  it('keeps unlike local measurements separate instead of inventing a total', () => {
    const component = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate()],
    }).components[0]!;

    assert.deepEqual(
      component.savings.map((row) => [row.class, row.unit, row.saved]),
      [
        ['exact-local', 'tokens', 1200],
        ['estimated-local', 'chars', 9000],
      ],
    );
    assert.equal('allowanceSaved' in component, false);
    assert.equal('apiCostSaved' in component, false);
  });

  it('asks for verification when configuration exists but no verification evidence was supplied', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      metrics: metrics(),
      updates: [currentUpdate()],
    });

    assert.equal(stack.state, 'incomplete');
    assert.equal(stack.components[0]!.verification, 'not-checked');
    assert.equal(stack.components[0]!.health, 'unknown');
    assert.equal(stack.components[0]!.nextAction?.kind, 'verify');
  });

  it('does not call an unexercised integration broken', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification([RTK], 'not-applicable'),
      updates: [currentUpdate()],
    });

    assert.equal(stack.components[0]!.verification, 'not-exercised');
    assert.equal(stack.components[0]!.health, 'unknown');
    assert.equal(stack.components[0]!.nextAction?.kind, 'verify');
  });

  it('makes provider-attributed quality regression a health problem rather than a savings win', () => {
    const quality = new Map<ProviderDetection['providerId'], StackQualityEvidence>([
      [
        RTK,
        {
          state: 'regressed',
          confidence: 'high',
          detail: 'Paired benchmark failed the explicit task-quality gate.',
        },
      ],
    ]);
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate()],
      qualityByProvider: quality,
    });

    assert.equal(stack.state, 'attention');
    assert.equal(stack.components[0]!.health, 'attention');
    assert.equal(stack.components[0]!.nextAction?.kind, 'review-health');
  });

  it('keeps unattributed drift explicit instead of assigning it to a provider by guesswork', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate()],
      unattributedDrift: [
        {
          code: 'unowned-entry-on-exclusive-scope',
          path: '/config/agent.json',
          detail: 'An unowned hook overlaps an exclusive scope.',
          remediation: 'Review the live hook configuration.',
        },
      ],
    });

    assert.equal(stack.state, 'attention');
    assert.equal(stack.components[0]!.conflicts.length, 0);
    assert.equal(stack.unattributedDrift.length, 1);
  });

  it('surfaces reviewed update state as one lifecycle action without applying it', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate(RTK, 'upgradable')],
    });

    assert.equal(stack.components[0]!.update, 'available');
    assert.equal(stack.components[0]!.updateAvailableVersion, '0.45.0');
    assert.equal(stack.components[0]!.nextAction?.kind, 'review-update');
    assert.equal(stack.state, 'incomplete');
  });

  it('does not infer combined compatibility from two individually healthy components', () => {
    const stack = buildOptimizationStack(healthyPairInput());

    assert.equal(
      stack.components.every((component) => component.health === 'healthy'),
      true,
    );
    assert.equal(stack.combinationReview.state, 'not-recorded');
    assert.deepEqual(stack.combinationReview.providerIds, [HARNESS_TRIM, RTK]);
    assert.match(
      stack.combinationReview.detail,
      /do not prove these components were reviewed together/,
    );
    assert.equal(stack.state, 'incomplete');
  });

  it('accepts combined review only for the exact configured provider set', () => {
    const reviewed = buildOptimizationStack({
      ...healthyPairInput(),
      combinationReview: {
        state: 'reviewed',
        providerIds: [RTK, HARNESS_TRIM],
        detail: 'Exact combined fixture passed.',
        evidence: ['fixture:rtk+harnesstrim'],
      },
    });
    assert.equal(reviewed.combinationReview.state, 'reviewed');
    assert.equal(reviewed.state, 'healthy');

    const mismatched = buildOptimizationStack({
      ...healthyPairInput(),
      combinationReview: {
        state: 'reviewed',
        providerIds: [RTK],
        detail: 'Single-provider evidence only.',
        evidence: ['fixture:rtk'],
      },
    });
    assert.equal(mismatched.combinationReview.state, 'not-recorded');
    assert.match(
      mismatched.combinationReview.detail,
      /does not match the exact configured provider set/,
    );
    assert.equal(mismatched.state, 'incomplete');
  });

  it('makes an explicitly incompatible reviewed combination an attention state', () => {
    const stack = buildOptimizationStack({
      ...healthyPairInput(),
      combinationReview: {
        state: 'incompatible',
        providerIds: [HARNESS_TRIM, RTK],
        detail: 'Combined fixture exposed conflicting command interception.',
        evidence: ['fixture:rtk+harnesstrim-conflict'],
      },
    });

    assert.equal(stack.combinationReview.state, 'incompatible');
    assert.equal(stack.state, 'attention');
  });
});
