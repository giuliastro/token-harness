import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TaskBenchmarkMatrixEntry } from '@token-harness/core';

import { summarizeCandidateBenchmarkEntries } from '../src/commands/candidate-benchmark.js';

describe('candidate benchmark attribution semantics', () => {
  it('does not credit ordinary matrix entries unless they were explicitly attributed', () => {
    const ordinary: TaskBenchmarkMatrixEntry = {
      benchmarkId: 'ordinary-1',
      taskClass: 'standard',
      harnessId: 'codex',
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
