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
  problemCount: 1,
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
    {
      harnessId: harnessId('pi'),
      state: 'detected',
      version: '0.84.2',
      versionVerdict: 'unknown-newer',
      configPath: null,
      declaredVerificationTier: 'config-only',
      evidence: [],
      warnings: [],
    },
    {
      harnessId: harnessId('hermes'),
      state: 'absent',
      version: null,
      versionVerdict: null,
      configPath: null,
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

  it('shows active work first and ignores secondary newer harnesses in primary health', () => {
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor,
      status,
      budget,
      optimize,
    });

    // Pi is newer than tested and contributes to doctor.problemCount, but it is merely detected:
    // it is not wired, has no allowance window, and has no live pipeline. The active Codex setup
    // therefore remains READY while Pi stays available under progressive disclosure.
    assert.equal(model.state, 'ready');
    assert.equal(model.statusLabel, 'READY');
    assert.equal(model.nextStep.command, null);
    assert.match(model.nextStep.title, /coding agent normally/i);
    assert.deepEqual(model.harnesses.map((item) => item.id), ['codex']);
    assert.deepEqual(model.otherHarnesses.map((item) => item.name), ['Pi']);
    assert.equal(JSON.stringify(model).includes('Hermes'), false);
    assert.equal(model.harnesses[0]?.allowance[0]?.remainingPercent, 62);
    assert.match(model.recommendation?.action ?? '', /Codex/);
    assert.doesNotMatch(JSON.stringify(model), /\/home\/private/);
  });

  it('treats a newer-than-tested active harness as a limitation, not a broken setup', () => {
    const limitedDoctor: DoctorReport = {
      ...doctor,
      problemCount: 2,
      harnesses: doctor.harnesses.map((item) =>
        item.harnessId === 'codex' ? { ...item, versionVerdict: 'unknown-newer' as const } : item,
      ),
    };
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor: limitedDoctor,
      status,
      budget,
      optimize,
    });

    assert.equal(model.state, 'limited');
    assert.equal(model.statusLabel, 'READY WITH LIMITATIONS');
    assert.equal(model.nextStep.command, 'token-harness verify');
    assert.match(model.summary, /active integration/i);
  });

  it('does not let a secondary harness recommendation replace active guidance', () => {
    const withPiAdvice: OptimizeReport = {
      ...optimize,
      harnesses: [
        {
          harnessId: harnessId('pi'),
          state: 'advised',
          currentModel: null,
          recommendedModel: null,
          currentEffort: null,
          recommendedEffort: null,
          currentVerbosity: null,
          recommendedVerbosity: null,
          contextPressure: 'high',
          localBurnTrend: null,
          recentSession: null,
          pace: [],
          recommendations: [
            {
              area: 'context',
              priority: 'first',
              action: 'Change the secondary Pi context.',
              target: null,
              evidence: [{ code: 'pi-secondary', summary: 'Secondary Pi signal' }],
            },
          ],
          diagnostics: [],
        },
        ...optimize.harnesses,
      ],
    };
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor,
      status,
      budget,
      optimize: withPiAdvice,
    });

    assert.match(model.recommendation?.action ?? '', /^Codex:/);
    assert.doesNotMatch(model.recommendation?.action ?? '', /Pi/);
  });

  it('does not use zero-byte evidence to explain a recommendation when better evidence exists', () => {
    const withMisleadingFirstEvidence: OptimizeReport = {
      ...optimize,
      harnesses: optimize.harnesses.map((item) => ({
        ...item,
        recommendations: [
          {
            area: 'context',
            priority: 'first' as const,
            action: 'Reduce avoidable static context.',
            target: null,
            evidence: [
              { code: 'instruction-budget', summary: '0B known loaded of 32768B project-doc budget' },
              { code: 'mcp-exposure', summary: '12 MCP servers, 60 tools visible in inventory' },
            ],
          },
        ],
      })),
    };
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor: { ...doctor, problemCount: 0, harnesses: doctor.harnesses.slice(0, 1) },
      status,
      budget,
      optimize: withMisleadingFirstEvidence,
    });

    assert.match(model.recommendation?.reason ?? '', /60 tools/i);
    assert.doesNotMatch(model.recommendation?.reason ?? '', /^0B/);
  });

  it('ships accessible, local-only, read-only assets with progressive disclosure', () => {
    const model = buildDashboardModel({
      generatedAt: '2026-09-05T12:00:00.000Z',
      doctor: { ...doctor, problemCount: 0, harnesses: doctor.harnesses.slice(0, 1) },
      status,
      budget,
      optimize,
    });

    assert.match(DASHBOARD_HTML, /<main/);
    assert.match(DASHBOARD_HTML, /<details id="other-panel"/);
    assert.match(DASHBOARD_HTML, /<ul id="providers"/);
    assert.match(DASHBOARD_CSS, /focus-visible/);
    assert.match(DASHBOARD_CSS, /prefers-reduced-motion/);
    assert.match(DASHBOARD_CSS, /prefers-color-scheme:dark/);
    assert.doesNotMatch(`${DASHBOARD_HTML}${DASHBOARD_CSS}${DASHBOARD_JS}`, /https?:\/\//);
    assert.equal(uiAsset('/api/status', model).contentType, 'application/json; charset=utf-8');
    assert.equal(uiAsset('/actions', model).status, 404);
  });
});
