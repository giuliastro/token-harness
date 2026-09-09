import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOptimizationStack,
  harnessId,
  providerId,
  type MetricsReport,
  type ProviderDetection,
  type ProviderUpdateRow,
  type StackQualityEvidence,
  type VerifyReport,
} from '../src/index.js';

const RTK = providerId('rtk');
const CLAUDE = harnessId('claude');

function detection(state: ProviderDetection['state'] = 'configured'): ProviderDetection {
  return {
    providerId: RTK,
    state,
    version: state === 'absent' ? null : '0.44.0',
    executable: state === 'absent' ? null : '/tools/rtk',
    installationChannel: state === 'absent' ? null : 'cargo',
    versionVerdict: state === 'absent' ? null : 'supported',
    configuredHarnesses: state === 'configured' ? [CLAUDE] : [],
    unmanagedHarnessesConfigured: [],
    supportsUnmanagedHarnesses: false,
    managedByTokenHarness: false,
    assignableHarnesses: state === 'absent' ? [] : [CLAUDE],
    evidence: [],
    warnings: [],
  };
}

function verification(status: 'healthy' | 'degraded' | 'not-applicable' = 'healthy'): VerifyReport {
  return {
    receiptId: null,
    appliedAt: null,
    healthyAtDeclaredTier: status !== 'degraded',
    results: [
      {
        providerId: RTK,
        harnessId: CLAUDE,
        status,
        declaredTier: 'canary',
        managedByTokenHarness: false,
        checks: [],
      },
    ],
  };
}

function metrics(): MetricsReport {
  return {
    windowStart: '2026-09-01',
    windowEnd: '2026-09-09',
    pipelineId: null,
    classes: [],
    providers: [
      {
        providerId: RTK,
        saved: 1200,
        before: 4000,
        after: 2800,
        unit: 'tokens',
        class: 'exact-local',
        operations: 12,
        harnesses: [CLAUDE],
        managedByTokenHarness: false,
        adapterMode: 'native',
      },
      {
        providerId: RTK,
        saved: 9000,
        unit: 'chars',
        class: 'estimated-local',
        operations: 3,
        harnesses: [CLAUDE],
        managedByTokenHarness: false,
        adapterMode: 'legacy',
      },
    ],
    coveragePercent: 80,
    bypassed: 3,
    inflatedOperations: 1,
    errors: 0,
    errorBreakdown: [],
    addedMedianLatencyMs: null,
  };
}

function currentUpdate(verdict: ProviderUpdateRow['verdict'] = 'current'): ProviderUpdateRow {
  return {
    providerId: RTK,
    installed: '0.44.0',
    available: verdict === 'current' ? '0.44.0' : '0.45.0',
    channel: 'cargo',
    verdict,
    pin: null,
  };
}

const descriptor = { providerId: RTK, displayName: 'RTK', category: 'command-output-reduction' as const };

describe('optimization stack snapshot', () => {
  it('represents the healthy steady state with no runtime toggle action', () => {
    const stack = buildOptimizationStack({
      components: [descriptor],
      detections: [detection()],
      verification: verification(),
      metrics: metrics(),
      updates: [currentUpdate()],
    });

    assert.equal(stack.state, 'healthy');
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
      verification: verification('not-applicable'),
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
      updates: [currentUpdate('upgradable')],
    });

    assert.equal(stack.components[0]!.update, 'available');
    assert.equal(stack.components[0]!.updateAvailableVersion, '0.45.0');
    assert.equal(stack.components[0]!.nextAction?.kind, 'review-update');
    assert.equal(stack.state, 'incomplete');
  });
});
