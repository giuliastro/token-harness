import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId, type TaskBenchmarkMatrixReport } from '@token-harness/core';

import { renderBenchmarkMatrixReport } from '../src/render/benchmark-matrix.js';

const report: TaskBenchmarkMatrixReport = {
  entries: [
    {
      benchmarkId: 'mechanical-real-1',
      taskClass: 'mechanical',
      harnessId: harnessId('codex'),
      verdict: 'optimized-better',
      basis: 'local-usage',
      evidenceLevel: 'local-evidence',
      baselineLocalTokens: 2000,
      optimizedLocalTokens: 1400,
      localTokenSavingPercent: 30,
      quota: null,
    },
  ],
  byTaskClass: [
    {
      taskClass: 'mechanical',
      pairs: 1,
      optimizedBetter: 1,
      baselineBetter: 0,
      equivalent: 0,
      inconclusive: 0,
      incomparable: 0,
      quotaBacked: 0,
      localEvidence: 1,
      qualityOnly: 0,
      localComparablePairs: 1,
      baselineLocalTokens: 2000,
      optimizedLocalTokens: 1400,
      localTokenSavingPercent: 30,
    },
  ],
  overall: {
    taskClass: null,
    pairs: 1,
    optimizedBetter: 1,
    baselineBetter: 0,
    equivalent: 0,
    inconclusive: 0,
    incomparable: 0,
    quotaBacked: 0,
    localEvidence: 1,
    qualityOnly: 0,
    localComparablePairs: 1,
    baselineLocalTokens: 2000,
    optimizedLocalTokens: 1400,
    localTokenSavingPercent: 30,
  },
  selection: {
    scanned: 2,
    completePairs: 1,
    incomplete: 1,
    invalid: 0,
    otherProject: 0,
    filteredOut: 0,
  },
};

describe('benchmark matrix rendering', () => {
  it('keeps verdicts, evidence level and local-token caveat visible', () => {
    const rendered = renderBenchmarkMatrixReport(report, {
      toolVersion: 'test',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(rendered, /^Benchmark matrix — current project$/m);
    assert.match(rendered, /mechanical-real-1 — optimized-better/);
    assert.match(rendered, /local-evidence/);
    assert.match(rendered, /delta \+30%/);
    assert.match(rendered, /Local token deltas are local evidence only/);
    assert.doesNotMatch(rendered, /score/i);
    for (const line of rendered.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `line is ${String(line.length)} chars: ${line}`);
    }
  });
});
