import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guidedCandidateObservation } from '../src/guided-candidate-readiness.js';

describe('guided candidate promotion readiness', () => {
  it('uses the shared promotion gates without treating benchmark capability as promotion', () => {
    const candidate = guidedCandidateObservation({
      id: 'gitnexus',
      displayName: 'GitNexus',
      category: 'repository-exploration',
      state: 'benchmark-ready',
      version: '1.2.3',
      minimumBenchmarkVersion: 'capability-gated',
    });

    assert.equal(candidate.promotionReadiness.passedGateCount, 2);
    assert.equal(candidate.promotionReadiness.requiredGateCount, 8);
    assert.equal(candidate.promotionReadiness.nextGate, 'selection-evidence');
    assert.equal(candidate.promotionReadiness.promotionEligible, false);
    assert.equal(candidate.promotionReadiness.state, 'blocked');
  });

  it('keeps the dedicated broad context-owner gate visible for Headroom', () => {
    const candidate = guidedCandidateObservation({
      id: 'headroom',
      displayName: 'Headroom',
      category: 'context-minimization',
      state: 'benchmark-ready',
      version: '0.9.0',
      minimumBenchmarkVersion: 'capability-gated',
    });

    assert.equal(candidate.promotionReadiness.passedGateCount, 2);
    assert.equal(candidate.promotionReadiness.requiredGateCount, 9);
    assert.ok(candidate.promotionReadiness.unreviewedGateIds.includes('context-owner-admission'));
    assert.equal(candidate.promotionReadiness.promotionEligible, false);
  });
});
