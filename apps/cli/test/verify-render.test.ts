import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type VerificationResult,
  type VerifyReport,
} from '@token-harness/core';

import { renderVerifyReport } from '../src/render/verify.js';

function report(result: VerificationResult): VerifyReport {
  return {
    receiptId: null,
    appliedAt: null,
    results: [result],
    healthyAtDeclaredTier: true,
  };
}

function result(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    providerId: providerId('harnesstrim'),
    harnessId: harnessId('codex'),
    status: 'healthy',
    declaredTier: 'config-only',
    managedByTokenHarness: true,
    checks: [],
    ...overrides,
  };
}

describe('verify ownership rendering', () => {
  it('reports a configured canary with no runtime receipt as not proven', () => {
    const rendered = renderVerifyReport(
      {
        receiptId: null,
        appliedAt: null,
        healthyAtDeclaredTier: false,
        results: [
          result({
            status: 'not-applicable',
            checks: [
              {
                id: 'canary-intercepted',
                status: 'not-exercised',
                summary: 'no Claude receipt yet',
                achievedTier: null,
                evidence: [],
                remediation: 'Run Claude Code after authentication.',
              },
            ],
          }),
        ],
      },
      { toolVersion: 'test', home: null, decorate: false },
    );

    assert.match(rendered, /1 provider–harness integration not proven yet/);
    assert.doesNotMatch(rendered, /Healthy at the declared tier/);
  });

  it('separates a user-installed provider executable from a managed integration', () => {
    const rendered = renderVerifyReport(report(result({ providerManagedByTokenHarness: false })), {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    assert.match(rendered, /Provider executable: user-installed/);
    assert.match(rendered, /integration: managed by Token Harness/);
    assert.doesNotMatch(rendered, /set up by you/);
  });

  it('keeps legacy verification results byte-compatible with the old ownership wording', () => {
    const rendered = renderVerifyReport(report(result({ managedByTokenHarness: false })), {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    assert.match(rendered, /harnesstrim on codex — set up by you, tier config-only/);
  });

  it('keeps the new ownership detail inside the terminal width contract', () => {
    const rendered = renderVerifyReport(report(result({ providerManagedByTokenHarness: false })), {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    for (const line of rendered.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `line is ${String(line.length)} chars: ${line}`);
    }
  });
});
