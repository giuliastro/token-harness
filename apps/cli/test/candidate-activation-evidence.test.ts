import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeCandidateActivationEvidence } from '../src/commands/candidate-benchmark.js';

describe('candidate activation evidence', () => {
  it('verifies mcptoon only when every completed optimized pair has a verified usage witness', () => {
    const result = summarizeCandidateActivationEvidence('mcptoon', [
      { start: undefined, finish: undefined, mcptoon: 'verified' },
      { start: undefined, finish: undefined, mcptoon: 'verified' },
    ]);

    assert.equal(result.state, 'verified');
    assert.equal(result.verifiedPairs, 2);
    assert.equal(result.blockedPairs, 0);
    assert.equal(result.unknownPairs, 0);
  });

  it('blocks mcptoon activation when an optimized pair has no successful in-window call', () => {
    const result = summarizeCandidateActivationEvidence('mcptoon', [
      { start: undefined, finish: undefined, mcptoon: 'verified' },
      { start: undefined, finish: undefined, mcptoon: 'blocked' },
    ]);

    assert.equal(result.state, 'blocked');
    assert.equal(result.verifiedPairs, 1);
    assert.equal(result.blockedPairs, 1);
  });

  it('keeps partial mcptoon witness coverage unreviewed instead of guessing', () => {
    const result = summarizeCandidateActivationEvidence('mcptoon', [
      { start: undefined, finish: undefined, mcptoon: 'verified' },
      { start: undefined, finish: undefined },
    ]);

    assert.equal(result.state, 'unreviewed');
    assert.equal(result.verifiedPairs, 1);
    assert.equal(result.unknownPairs, 1);
  });

  it('does not turn the mcptoon witness into activation evidence for Headroom', () => {
    const result = summarizeCandidateActivationEvidence('headroom', [
      { start: undefined, finish: undefined, mcptoon: 'verified' },
    ]);

    assert.equal(result.state, 'unreviewed');
    assert.equal(result.verifiedPairs, 0);
    assert.equal(result.unknownPairs, 1);
  });
});
