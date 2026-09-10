import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TaskBenchmarkMatrixEntry } from '@token-harness/core';

import { summarizeCandidateBenchmarkEntries } from '../src/commands/candidate-benchmark.js';
import { parseArgv } from '../src/argv.js';

function entry(
  benchmarkId: string,
  input: Partial<TaskBenchmarkMatrixEntry>,
): TaskBenchmarkMatrixEntry {
  return {
    benchmarkId,
    taskClass: 'standard',
    harnessId: 'codex',
    verdict: 'inconclusive',
    basis: 'none',
    evidenceLevel: 'none',
    baselineLocalTokens: null,
    optimizedLocalTokens: null,
    localTokenSavingPercent: null,
    quota: null,
    ...input,
  };
}

describe('candidate benchmark evidence', () => {
  it('parses only supported explicit candidate attribution', () => {
    const parsed = parseArgv([
      'benchmark-start',
      '--benchmark-id',
      'headroom-standard-1',
      '--candidate',
      'headroom',
      '--variant',
      'baseline',
      '--task',
      'standard',
      '--harness',
      'codex',
    ]);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.optimizationCandidate, 'headroom');

    const invalid = parseArgv(['benchmark-start', '--candidate', 'unknown']);
    assert.equal(invalid.kind, 'usage-error');
    if (invalid.kind === 'usage-error')
      assert.equal(invalid.diagnostics[0]?.code, 'invalid-optimization-candidate');
  });

  it('summarizes attributed pairs without inventing a composite verdict', () => {
    const summary = summarizeCandidateBenchmarkEntries('headroom', [
      entry('h-1', {
        verdict: 'optimized-better',
        basis: 'local-usage',
        evidenceLevel: 'local-evidence',
        baselineLocalTokens: 1000,
        optimizedLocalTokens: 700,
        localTokenSavingPercent: 30,
      }),
      entry('h-2', {
        verdict: 'baseline-better',
        basis: 'backend-quota',
        evidenceLevel: 'quota-backed',
        baselineLocalTokens: 500,
        optimizedLocalTokens: 600,
        localTokenSavingPercent: -20,
      }),
      entry('h-3', {
        verdict: 'inconclusive',
        basis: 'none',
        evidenceLevel: 'none',
      }),
    ]);

    assert.deepEqual(summary, {
      candidateId: 'headroom',
      pairs: 3,
      optimizedBetter: 1,
      baselineBetter: 1,
      equivalent: 0,
      inconclusive: 1,
      incomparable: 0,
      quotaBacked: 1,
      localEvidence: 1,
      qualityOnly: 0,
      localComparablePairs: 2,
      baselineLocalTokens: 1500,
      optimizedLocalTokens: 1300,
      localTokenSavingPercent: 13.3,
    });
  });
});
