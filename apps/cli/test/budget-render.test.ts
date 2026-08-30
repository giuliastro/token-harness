import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId, type BudgetReport, type PlatformFacts } from '@token-harness/core';

import { renderBudgetReport } from '../src/render/budget.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

describe('budget rendering', () => {
  it('keeps observed windows separate and labels unavailable Claude honestly', () => {
    const report: BudgetReport = {
      platform: PLATFORM,
      observedAt: '2026-08-30T14:00:00.000Z',
      harnesses: [
        {
          harnessId: harnessId('claude'),
          state: 'unavailable',
          windows: [],
          planType: null,
          rateLimitReachedType: null,
          resetCreditsAvailable: null,
          diagnostics: [],
        },
        {
          harnessId: harnessId('codex'),
          state: 'observed',
          planType: 'pro',
          rateLimitReachedType: null,
          resetCreditsAvailable: 1,
          diagnostics: [],
          windows: [
            {
              harnessId: harnessId('codex'),
              bucketId: 'codex',
              bucketName: 'Codex',
              window: 'primary',
              scope: 'five-hour',
              usedPercent: 43.2,
              remainingPercent: 56.8,
              windowDurationMinutes: 300,
              resetsAt: '2026-08-30T16:00:00.000Z',
              observedAt: '2026-08-30T14:00:00.000Z',
              source: 'native-rpc',
              confidence: 'authoritative',
            },
            {
              harnessId: harnessId('codex'),
              bucketId: 'codex',
              bucketName: 'Codex',
              window: 'secondary',
              scope: 'weekly',
              usedPercent: 12,
              remainingPercent: 88,
              windowDurationMinutes: 10080,
              resetsAt: '2026-09-06T16:00:00.000Z',
              observedAt: '2026-08-30T14:00:00.000Z',
              source: 'native-rpc',
              confidence: 'authoritative',
            },
          ],
        },
      ],
    };

    const rendered = renderBudgetReport(report, {
      toolVersion: '0.1.3',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(rendered, /claude\s+- unavailable/);
    assert.match(rendered, /five-hour/);
    assert.match(rendered, /weekly/);
    assert.match(rendered, /43\.2%/);
    assert.match(rendered, /source - native-rpc\/authoritative/);
    assert.match(rendered, /reset credits - 1 available - read-only/);
    for (const line of rendered.split('\n')) {
      assert.ok(line.length <= 78, `line is too wide: ${line}`);
    }
  });

  it('makes companion and cached Claude provenance visible', () => {
    const report: BudgetReport = {
      platform: PLATFORM,
      observedAt: '2026-08-30T14:00:00.000Z',
      harnesses: [
        {
          harnessId: harnessId('claude'),
          state: 'observed',
          planType: 'pro',
          rateLimitReachedType: null,
          resetCreditsAvailable: null,
          diagnostics: [],
          windows: [
            {
              harnessId: harnessId('claude'),
              bucketId: 'claude-subscription',
              bucketName: 'Claude subscription',
              window: 'primary',
              scope: 'five-hour',
              usedPercent: 37.5,
              remainingPercent: 62.5,
              windowDurationMinutes: 300,
              resetsAt: '2026-08-30T16:00:00.000Z',
              observedAt: '2026-08-30T14:00:00.000Z',
              source: 'companion-cli',
              confidence: 'cached',
            },
          ],
        },
      ],
    };

    const rendered = renderBudgetReport(report, {
      toolVersion: '0.1.3',
      home: '/home/dev',
      decorate: false,
    });
    assert.match(rendered, /source - companion-cli\/cached/);
  });
});
