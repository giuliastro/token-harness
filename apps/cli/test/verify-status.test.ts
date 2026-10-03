import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type VerificationCheck,
  type VerificationResult,
} from '@token-harness/core';

import {
  allResultsAtDeclaredTier,
  harnessesForVerification,
  statusFor,
  verificationHasProblems,
} from '../src/commands/verify-status.js';

function check(
  id: string,
  status: VerificationCheck['status'],
  achievedTier: VerificationCheck['achievedTier'],
): VerificationCheck {
  return { id, status, achievedTier, summary: id, evidence: [], remediation: null };
}

function result(status: VerificationResult['status']): VerificationResult {
  return {
    providerId: providerId('harnesstrim'),
    harnessId: harnessId('claude'),
    status,
    declaredTier: 'canary',
    managedByTokenHarness: true,
    checks: [],
  };
}

describe('verify tier summary', () => {
  it('restricts provider rows to the selected installed harness', () => {
    const claude = harnessId('claude');
    const codex = harnessId('codex');
    assert.deepEqual(harnessesForVerification(codex, [claude, codex], [claude, codex]), [codex]);
    assert.deepEqual(harnessesForVerification(null, [claude], [claude, codex]), [claude]);
  });

  it('keeps an unobserved passive canary distinct from a known lower tier', () => {
    const checks = [
      check('integration-configured', 'pass', 'config-only'),
      check('canary-intercepted', 'not-exercised', null),
    ];

    assert.equal(statusFor('config-only', 'canary', checks), 'not-applicable');
    assert.equal(statusFor('config-only', 'canary'), 'degraded');
  });

  it('does not label pass-through telemetry as a canary failure', () => {
    const checks = [check('canary-intercepted', 'info', null)];
    assert.equal(statusFor('config-only', 'canary', checks), 'not-applicable');
  });

  it('keeps an optional integration with no exercised checks out of the failure state', () => {
    const checks = [
      check('managed-guidance-claude', 'not-exercised', 'presence'),
      check('managed-guidance-codex', 'not-exercised', 'presence'),
    ];
    assert.equal(statusFor('presence', 'config-only', checks), 'not-applicable');
  });

  it('does not call an unproven integration healthy or raise exit 3 for no activity', () => {
    const unproven = result('not-applicable');
    assert.equal(allResultsAtDeclaredTier([unproven]), false);
    assert.equal(verificationHasProblems([unproven], 0), false);
  });

  it('raises exit 3 for a known result below its declared tier', () => {
    const degraded = result('degraded');
    assert.equal(allResultsAtDeclaredTier([degraded]), false);
    assert.equal(verificationHasProblems([degraded], 0), true);
  });
});
