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

  it('renders the exact fingerprint and passive evidence gaps without claiming compatibility', () => {
    const report: StackCombinationReviewCaptureReport = {
      capturedAt: '2026-09-12T09:00:00.000Z',
      ready: true,
      reviewState: 'pending-manual-decision',
      fingerprint: {
        providerIds: [HARNESS_TRIM, RTK],
        versions: { harnesstrim: '0.3.0', rtk: '0.49.0' },
        configuredHarnesses: {
          harnesstrim: [CODEX],
          rtk: [CLAUDE],
        },
      },
      verificationEvidence: [
        {
          providerId: HARNESS_TRIM,
          harnessId: CODEX,
          declaredTier: 'config-only',
          verificationStatus: 'healthy',
          runtimeEvidence: 'not-exercised',
          detail: 'No telemetry file yet, so nothing has been observed.',
        },
        {
          providerId: RTK,
          harnessId: CLAUDE,
          declaredTier: 'canary',
          verificationStatus: 'healthy',
          runtimeEvidence: 'observed',
          detail: '616 commands intercepted on 2026-09-11.',
        },
      ],
      instructions: [
        'Exercise these integrations through normal agent use, then rerun verify and stack-review: harnesstrim on codex.',
      ],
    };

    const rendered = renderStackReviewReport(report, {
      toolVersion: '0.1.10',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(rendered, /STACK REVIEW CAPTURE/);
    assert.match(rendered, /harnesstrim \+ rtk/);
    assert.match(rendered, /harnesstrim\s+0\.3\.0\s+codex/);
    assert.match(rendered, /rtk\s+0\.49\.0\s+claude/);
    assert.match(rendered, /pending manual review/);
    assert.match(rendered, /PASSIVE VERIFICATION/);
    assert.match(rendered, /harnesstrim \/ codex\s+not exercised\s+config-only/);
    assert.match(rendered, /rtk \/ claude\s+observed\s+canary/);
    assert.match(rendered, /616 commands intercepted/);
    assert.match(rendered, /Exercise these integrations through normal agent use/);
    assert.doesNotMatch(rendered, /compatible/i);
  });

  it('renders a non-ready capture as pending evidence, not success', () => {
    const report: StackCombinationReviewCaptureReport = {
      capturedAt: '2026-09-12T09:00:00.000Z',
      ready: false,
      reviewState: 'pending-manual-decision',
      fingerprint: null,
      verificationEvidence: [],
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
