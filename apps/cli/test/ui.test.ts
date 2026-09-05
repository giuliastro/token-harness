import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type BudgetReport,
  type DoctorReport,
  type OptimizeReport,
  type PlatformFacts,
  type StatusReport,
} from '@token-harness/core';

import {
  DASHBOARD_CSS,
  DASHBOARD_HTML,
  DASHBOARD_JS,
  buildDashboardModel,
  parseUiArgs,
  uiAsset,
} from '../src/ui.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

const doctor: DoctorReport = {
  platform: PLATFORM,
  problemCount: 0,
  harnesses: [
    {
      harnessId: harnessId('codex'),
      state: 'configured',
      version: '0.152.1',
      versionVerdict: 'in-range',
      configPath: '/home/private/.codex/config.toml',
      declaredVerificationTier: 'config-only',
      evidence: [],
      warnings: [],
    },
  ],
  providers: [
    {
      providerId: providerId('harnesstrim'),
      state: 'configured',
      version: '0.2.1',
      executable: '/home/private/bin/harnesstrim',
      installationChannel: null,
      versionVerdict: 'in-range',
      configuredHarnesses: [harnessId('codex')],
      unmanagedHarnessesConfigured: [],
      supportsUnmanagedHarnesses: true,
      managedByTokenHarness: false,
      assignableHarnesses: [harnessId('codex')],
      evidence: [],
      warnings: [],
    },
  ],
};

const budget: BudgetReport = {
  platform: PLATFORM,
  observedAt: '2026-09-05T12:00:00.000Z',
  harnesses: [
    {
      harnessId: harnessId('codex'),
      state: 'observed',
      planType: 'pro',
      rateLimitReachedType: null,
      resetCreditsAvailable: 0,
      diagnostics: [],
      windows: [
        {
          harnessId: harnessId('codex'),
          bucketId: 'codex',
          bucketName: 'Five hour',
          window: 'primary',
          scope: 'five-hour',
          usedPercent: 38,
          remainingPercent: 62,
          windowDurationMinutes: 300,
          resetsAt: '2026-09-05T14:00:00.000Z',
          observedAt: '2026-09-05T12:00:00.000Z',
          source: 'native-rpc',
          confidence: 'authoritative',
        },
      ],
    },
  ],
};

const status: StatusReport = {
  platform: PLATFORM,
  pipelines: [],
  drift: [],
  importers: [],
  problemCount: 0,
};

const optimize: OptimizeReport = {
  platform: PLATFORM,
  projectRoot: '/home/private/project',
  observedAt: '2026-09-05T12:00:00.000Z',
  taskClass: 'standard',
  profile: 'balanced',
  reservePercent: 20,
  harnesses: [
    {
      harnessId: harnessId('codex'),
      state: 'advised',
      currentModel: 'gpt-5',
      recommendedModel: 'gpt-5',
      currentEffort: 'medium',
      recommendedEffort: 'medium',
      currentVerbosity: 'low',
      recommendedVerbosity: 'low',
      contextPressure: 'low',
      localBurnTrend: null,
      recentSession: null,
      pace: [],
      recommendations: [
        {
          area: 'quota',
          priority: 'first',
          action: 'Continue with the current profile.',
          target: null,
          evidence: [{ code: 'quota-healthy', summary: 'Allowance is above reserve.' }],
        },
      ],
      diagnostics: [],
    },
  ],
};

describe('local dashboard', () => {
  it('parses safe local server options and rejects unknown flags', () => {
    assert.deepEqual(parseUiArgs(['--no-open', '--port', '7331']), {
      ok: true,
      options: { help: false, json: false, open: false, port: 7331 },
    });
    assert.equal(parseUiArgs(['--listen', '0.0.0.0']).ok, false);
  });

  it('builds an action-oriented snapshot without exposing local paths', () => {
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor,
      status,
      budget,
      optimize,
    });

    assert.equal(model.state, 'ready');
    assert.equal(model.harnesses[0]?.allowance[0]?.remainingPercent, 62);
    assert.match(model.recommendation?.action ?? '', /Codex/);
    assert.doesNotMatch(JSON.stringify(model), /\/home\/private/);
  });

  it('ships only local static assets and a read-only JSON route', () => {
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor,
      status,
      budget,
      optimize,
    });

    assert.match(DASHBOARD_HTML, /<main/);
    assert.doesNotMatch(`${DASHBOARD_HTML}${DASHBOARD_CSS}${DASHBOARD_JS}`, /https?:\/\//);
    assert.equal(uiAsset('/api/status', model).contentType, 'application/json; charset=utf-8');
    assert.equal(uiAsset('/actions', model).status, 404);
  });
});
