import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId, type OptimizationCandidateId } from '@token-harness/core';

import {
  buildCandidateBenchmarkEvidence,
  summarizeCandidateActivationEvidence,
  summarizeCandidateBenchmarkEntries,
  type CandidateBenchmarkEvidenceEntry,
} from '../src/commands/candidate-benchmark.js';
import { parseArgv } from '../src/argv.js';

function entry(
  benchmarkId: string,
  input: Partial<CandidateBenchmarkEvidenceEntry>,
): CandidateBenchmarkEvidenceEntry {
  return {
    benchmarkId,
    taskClass: 'standard',
    harnessId: harnessId('codex'),
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

describe('candidate activation evidence', () => {
  it('verifies GitNexus only when every completed optimized task sees usable MCP at both boundaries', () => {
    assert.deepEqual(
      summarizeCandidateActivationEvidence('gitnexus', [
        { start: 'usable', finish: 'usable' },
        { start: 'usable', finish: 'usable' },
      ]),
      {
        candidateId: 'gitnexus',
        state: 'verified',
        verifiedPairs: 2,
        blockedPairs: 0,
        unknownPairs: 0,
        reason:
          '2 optimized pair(s) observed the GitNexus MCP server usable at both task boundaries',
      },
    );
  });

  it('blocks contradictory runtime evidence and keeps legacy evidence unreviewed', () => {
    const blocked = summarizeCandidateActivationEvidence('gitnexus', [
      { start: 'usable', finish: 'unusable' },
    ]);
    assert.equal(blocked.state, 'blocked');
    assert.equal(blocked.blockedPairs, 1);

    const legacy = summarizeCandidateActivationEvidence('gitnexus', [
      { start: undefined, finish: undefined },
    ]);
    assert.equal(legacy.state, 'unreviewed');
    assert.equal(legacy.unknownPairs, 1);
  });
});

describe('candidate benchmark evidence', () => {
  it('parses supported explicit candidate attribution, including GitNexus', () => {
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

    const gitnexus = parseArgv([
      'benchmark-start',
      '--benchmark-id',
      'gitnexus-standard-1',
      '--candidate',
      'gitnexus',
      '--variant',
      'baseline',
      '--task',
      'standard',
      '--harness',
      'codex',
    ]);
    assert.equal(gitnexus.kind, 'command');
    if (gitnexus.kind === 'command') {
      assert.equal(gitnexus.options.optimizationCandidate, 'gitnexus');
    }

    const invalid = parseArgv(['benchmark-start', '--candidate', 'unknown']);
    assert.equal(invalid.kind, 'usage-error');
    if (invalid.kind === 'usage-error')
      assert.equal(invalid.diagnostics[0]?.code, 'invalid-optimization-candidate');
  });

  it('summarizes evidence coverage, local tokens and quality-passed wall clock separately', () => {
    const summary = summarizeCandidateBenchmarkEntries('headroom', [
      entry('h-1', {
        verdict: 'optimized-better',
        basis: 'local-usage',
        evidenceLevel: 'local-evidence',
        baselineLocalTokens: 1000,
        optimizedLocalTokens: 700,
        localTokenSavingPercent: 30,
        baselineWallClockMs: 600_000,
        optimizedWallClockMs: 480_000,
        wallClockSavingPercent: 20,
      }),
      entry('h-2', {
        verdict: 'baseline-better',
        basis: 'backend-quota',
        evidenceLevel: 'quota-backed',
        baselineLocalTokens: 500,
        optimizedLocalTokens: 600,
        localTokenSavingPercent: -20,
        baselineWallClockMs: 1_200_000,
        optimizedWallClockMs: 1_500_000,
        wallClockSavingPercent: -25,
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
      evidencePairs: 2,
      evidenceCoveragePercent: 66.7,
      localComparablePairs: 2,
      baselineLocalTokens: 1500,
      optimizedLocalTokens: 1300,
      localTokenSavingPercent: 13.3,
      wallClockComparablePairs: 2,
      baselineWallClockMs: 1_800_000,
      optimizedWallClockMs: 1_980_000,
      wallClockSavingPercent: -10,
    });
    assert.equal('recommendation' in summary, false);
    assert.equal('score' in summary, false);
  });

  it('keeps Headroom, mcptoon and GitNexus evidence isolated', () => {
    const byCandidate = new Map<OptimizationCandidateId, CandidateBenchmarkEvidenceEntry[]>([
      [
        'headroom',
        [
          entry('headroom-1', {
            verdict: 'optimized-better',
            evidenceLevel: 'local-evidence',
          }),
        ],
      ],
      [
        'mcptoon',
        [
          entry('mcptoon-1', {
            verdict: 'baseline-better',
            evidenceLevel: 'quality-only',
          }),
        ],
      ],
      [
        'gitnexus',
        [
          entry('gitnexus-1', {
            verdict: 'equivalent',
            evidenceLevel: 'quota-backed',
          }),
        ],
      ],
    ]);

    const evidence = buildCandidateBenchmarkEvidence(byCandidate);
    assert.deepEqual(
      evidence.map((row) => row.candidateId),
      ['headroom', 'mcptoon', 'gitnexus'],
    );
    assert.deepEqual(
      evidence.map((row) => [row.optimizedBetter, row.baselineBetter, row.equivalent]),
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    );
    assert.deepEqual(
      evidence.map((row) => row.evidenceCoveragePercent),
      [100, 100, 100],
    );
  });

  it('keeps absent timing evidence unknown instead of guessing duration savings', () => {
    const summary = summarizeCandidateBenchmarkEntries('gitnexus', [
      entry('gitnexus-no-timing', {
        verdict: 'optimized-better',
        evidenceLevel: 'local-evidence',
      }),
    ]);
    assert.equal(summary.candidateId, 'gitnexus');
    assert.equal(summary.pairs, 1);
    assert.equal(summary.wallClockComparablePairs, 0);
    assert.equal(summary.baselineWallClockMs, null);
    assert.equal(summary.optimizedWallClockMs, null);
    assert.equal(summary.wallClockSavingPercent, null);
  });

  it('keeps an empty candidate explicit with unknown coverage', () => {
    const summary = summarizeCandidateBenchmarkEntries('gitnexus', []);
    assert.equal(summary.candidateId, 'gitnexus');
    assert.equal(summary.pairs, 0);
    assert.equal(summary.evidencePairs, 0);
    assert.equal(summary.evidenceCoveragePercent, null);
    assert.equal(summary.localTokenSavingPercent, null);
    assert.equal(summary.wallClockSavingPercent, null);
  });
});
