import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type StackCombinationReviewCaptureReport,
} from '@token-harness/core';

import { parseArgv } from '../src/argv.js';
import { renderStackReviewReport } from '../src/render/stack-review.js';

const RTK = providerId('rtk');
const HARNESS_TRIM = providerId('harnesstrim');
const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

describe('stack-review CLI', () => {
  it('parses the read-only stack-review command in JSON mode', () => {
    assert.deepEqual(parseArgv(['stack-review', '--json']), {
      kind: 'command',
      json: true,
      command: 'stack-review',
      options: {
        harness: null,
        provider: null,
        project: null,
        since: null,
        until: null,
        plan: null,
        transaction: null,
        baselineReceipt: null,
        optimizedReceipt: null,
        benchmarkId: null,
        benchmarkVariant: null,
        benchmarkQuality: null,
        benchmarkAttempts: null,
        benchmarkFailedAttempts: null,
        optimizationCandidate: null,
        task: null,
        profile: null,
        reservePercent: null,
        tasksLeft: null,
        nativePolicy: false,
        agentSkill: false,
        verbose: false,
        yes: false,
      },
    });
  });

  it('renders the exact fingerprint without claiming compatibility', () => {
    const report: StackCombinationReviewCaptureReport = {
      capturedAt: '2026-09-12T09:00:00.000Z',
      ready: true,
      reviewState: 'pending-manual-decision',
      fingerprint: {
        providerIds: [HARNESS_TRIM, RTK],
        versions: { harnesstrim: '0.2.1', rtk: '0.44.0' },
        configuredHarnesses: {
          harnesstrim: [CLAUDE, CODEX],
          rtk: [CLAUDE],
        },
      },
      instructions: ['Test this exact combination together before recording a decision.'],
    };

    const rendered = renderStackReviewReport(report, {
      toolVersion: '0.1.10',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(rendered, /STACK REVIEW CAPTURE/);
    assert.match(rendered, /harnesstrim \+ rtk/);
    assert.match(rendered, /harnesstrim\s+0\.2\.1\s+claude, codex/);
    assert.match(rendered, /rtk\s+0\.44\.0\s+claude/);
    assert.match(rendered, /pending manual review/);
    assert.doesNotMatch(rendered, /compatible/i);
  });

  it('renders a non-ready capture as pending evidence, not success', () => {
    const report: StackCombinationReviewCaptureReport = {
      capturedAt: '2026-09-12T09:00:00.000Z',
      ready: false,
      reviewState: 'pending-manual-decision',
      fingerprint: null,
      instructions: ['Configure at least two managed optimization providers.'],
    };

    const rendered = renderStackReviewReport(report, {
      toolVersion: '0.1.10',
      home: null,
      decorate: false,
    });

    assert.match(rendered, /No multi-provider configured stack is ready to capture/);
    assert.match(rendered, /Configure at least two managed optimization providers/);
  });
});
