import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import {
  commandResult,
  decideEfficiency,
  harnessId,
  toEnvelope,
  type OptimizeReport,
} from '@token-harness/core';
import { renderOptimizeReport } from '../src/render/optimize.js';
import { renderSimpleOptimize } from '../src/render/simple.js';

// Fixed unavailable observations keep these public transcripts portable and deterministic.
const report: OptimizeReport = {
  platform: {
    os: 'windows',
    osDisplayName: 'test',
    arch: 'x64',
    nodeVersion: '22.13.0',
    isWsl: false,
  },
  projectRoot: '/fixture/project',
  observedAt: '2026-10-04T12:00:00.000Z',
  taskClass: 'critical',
  profile: 'balanced',
  reservePercent: 20,
  harnesses: ['claude', 'codex'].map((id) => ({
    harnessId: harnessId(id),
    state: 'unavailable',
    currentModel: null,
    recommendedModel: null,
    currentEffort: null,
    recommendedEffort: null,
    currentVerbosity: null,
    recommendedVerbosity: null,
    contextPressure: 'unknown',
    localBurnTrend: null,
    recentSession: null,
    pace: [],
    recommendations: [],
    diagnostics: [],
  })),
};
report.efficiencyDecisions = ['claude', 'codex'].map((harness) =>
  decideEfficiency({
    currentHarness: harness === 'claude' ? 'claude' : 'codex',
    taskClass: report.taskClass,
    optimization: report.harnesses,
  }),
);

export const efficiencyFixtures = {
  'json.json':
    JSON.stringify(
      toEnvelope(commandResult({ command: 'optimize', exitCode: 0, data: report }), 'test'),
      null,
      2,
    ) + '\n',
  'human.txt': renderSimpleOptimize(report),
  'verbose.txt': renderOptimizeReport(report, { toolVersion: 'test', home: null, decorate: false }),
};

it('golden-compares human and JSON efficiency output while keeping unavailable evidence unknown', () => {
  for (const [name, actual] of Object.entries(efficiencyFixtures)) {
    const fixture = new URL(
      `../../../../tests/fixtures/efficiency-output/${name}`,
      import.meta.url,
    );
    assert.equal(actual, readFileSync(fixture, 'utf8'), name);
    if (name.endsWith('.txt')) assert.ok(actual.split('\n').every((line) => line.length <= 78));
  }
});
