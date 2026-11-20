import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId, type TaskBenchmarkMatrixEntry } from '@token-harness/core';

import { summarizeCandidateBenchmarkEntries } from '../src/commands/candidate-benchmark.js';
import { parseCandidateBenchmarkAttribution } from '../src/commands/candidate-benchmark-attribution.js';

describe('candidate benchmark attribution semantics', () => {
  it('accepts Token Optimizer as an experiment label without inferring activation', () => {
    const parsed = parseCandidateBenchmarkAttribution({
      schemaVersion: 1,
      benchmarkId: 'token-optimizer-eval-m-1',
      candidateId: 'token-optimizer-mcp',
      projectId: 'p_test',
    });
    assert.equal(parsed?.candidateId, 'token-optimizer-mcp');
    assert.equal(parsed?.candidateVersion, undefined);
  });
  it('does not credit ordinary matrix entries unless they were explicitly attributed', () => {
    const ordinary: TaskBenchmarkMatrixEntry = {
      benchmarkId: 'ordinary-1',
      taskClass: 'standard',
      harnessId: harnessId('codex'),
      verdict: 'optimized-better',
      basis: 'local-usage',
      evidenceLevel: 'local-evidence',
      baselineLocalTokens: 100,
      optimizedLocalTokens: 50,
      localTokenSavingPercent: 50,
      quota: null,
    };

    assert.equal(summarizeCandidateBenchmarkEntries('mcptoon', []).pairs, 0);
    assert.equal(summarizeCandidateBenchmarkEntries('mcptoon', [ordinary]).pairs, 1);
  });
});
