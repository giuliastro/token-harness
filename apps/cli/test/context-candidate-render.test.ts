import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContextReport } from '@token-harness/core';

import { renderContextReport } from '../src/render/context-cost.js';

const REPORT: ContextReport = {
  platform: {
    os: 'linux',
    osDisplayName: 'Linux',
    arch: 'x64',
    nodeVersion: '22.13.0',
    isWsl: false,
  },
  projectRoot: '/work/demo',
  observedAt: '2026-09-11T13:00:00.000Z',
  instructions: [],
  knownLoadedInstructionBytes: 0,
  discoveredInstructionBytes: 0,
  instructionHierarchy: [],
  harnesses: [],
  optimizationCandidates: [
    {
      id: 'gitnexus',
      displayName: 'GitNexus',
      category: 'repository-exploration',
      state: 'benchmark-ready',
      version: '1.2.3',
      minimumBenchmarkVersion: 'capability-gated',
    },
  ],
};

describe('context candidate rendering', () => {
  it('shows local promotion prerequisites without claiming activation or eligibility', () => {
    const output = renderContextReport(REPORT, {
      toolVersion: '0.1.10',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(output, /CANDIDATES — experimental/);
    assert.match(output, /GitNexus: benchmark-ready; repository-exploration; version 1\.2\.3/);
    assert.match(output, /promotion gates 2\/8; next selection-evidence; blocked/);
    assert.match(output, /benchmark-ready means reviewed benchmark surfaces only/);
    assert.match(output, /it does not prove activation or promotion/);
    assert.doesNotMatch(output, /promotion gates 8\/8/);
  });
});
