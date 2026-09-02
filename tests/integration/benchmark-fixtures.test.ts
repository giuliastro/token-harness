import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareTaskBenchmarkReceipts,
  parseTaskBenchmarkReceipt,
  type TaskClass,
} from '@token-harness/core';

import { listBenchmarkFixtures, loadBenchmarkFixture } from '../src/index.js';

describe('paired benchmark fixture corpus', () => {
  it('covers at least three task classes with explicit quality-gated baseline/optimized pairs', () => {
    const names = listBenchmarkFixtures();
    assert.ok(names.length >= 3, `expected at least three fixtures, got ${String(names.length)}`);

    const taskClasses = new Set<TaskClass>();
    for (const name of names) {
      const loaded = loadBenchmarkFixture(name);
      assert.equal(loaded.scenario.fixtureKind, 'contract-not-empirical');

      const baseline = parseTaskBenchmarkReceipt(loaded.baseline);
      const optimized = parseTaskBenchmarkReceipt(loaded.optimized);
      assert.equal(baseline.ok, true, `${name} baseline did not parse`);
      assert.equal(optimized.ok, true, `${name} optimized did not parse`);
      if (!baseline.ok || !optimized.ok) continue;

      assert.equal(baseline.receipt.variant, 'baseline');
      assert.equal(optimized.receipt.variant, 'optimized');
      assert.equal(baseline.receipt.benchmarkId, loaded.scenario.name);
      assert.equal(optimized.receipt.benchmarkId, loaded.scenario.name);
      assert.equal(baseline.receipt.taskClass, loaded.scenario.taskClass);
      assert.equal(optimized.receipt.taskClass, loaded.scenario.taskClass);
      assert.equal(baseline.receipt.harnessId, loaded.scenario.harnessId);
      assert.equal(optimized.receipt.harnessId, loaded.scenario.harnessId);
      assert.notEqual(baseline.receipt.outcome.qualityGate, 'unknown');
      assert.notEqual(optimized.receipt.outcome.qualityGate, 'unknown');

      taskClasses.add(baseline.receipt.taskClass);

      const comparison = compareTaskBenchmarkReceipts(baseline.receipt, optimized.receipt);
      assert.equal(comparison.verdict, loaded.scenario.expectedVerdict, name);
      assert.equal(comparison.basis, loaded.scenario.expectedBasis, name);
      assert.equal(comparison.evidenceLevel, loaded.scenario.expectedEvidenceLevel, name);
    }

    assert.ok(taskClasses.has('mechanical'));
    assert.ok(taskClasses.has('standard'));
    assert.ok(taskClasses.has('hard'));
  });

  it('proves token savings alone cannot win the quality-regression fixture', () => {
    const loaded = loadBenchmarkFixture('standard-quality-regression');
    const baseline = parseTaskBenchmarkReceipt(loaded.baseline);
    const optimized = parseTaskBenchmarkReceipt(loaded.optimized);
    assert.equal(baseline.ok, true);
    assert.equal(optimized.ok, true);
    if (!baseline.ok || !optimized.ok) return;

    assert.ok(
      (optimized.receipt.localUsage?.totalTokens ?? Number.POSITIVE_INFINITY) <
        (baseline.receipt.localUsage?.totalTokens ?? 0),
    );

    const comparison = compareTaskBenchmarkReceipts(baseline.receipt, optimized.receipt);
    assert.equal(comparison.verdict, 'baseline-better');
    assert.equal(comparison.basis, 'quality');
  });

  it('proves retry cost can outweigh local token savings without a quota claim', () => {
    const loaded = loadBenchmarkFixture('hard-retry-cost');
    const baseline = parseTaskBenchmarkReceipt(loaded.baseline);
    const optimized = parseTaskBenchmarkReceipt(loaded.optimized);
    assert.equal(baseline.ok, true);
    assert.equal(optimized.ok, true);
    if (!baseline.ok || !optimized.ok) return;

    assert.ok(
      (optimized.receipt.localUsage?.totalTokens ?? Number.POSITIVE_INFINITY) <
        (baseline.receipt.localUsage?.totalTokens ?? 0),
    );

    const comparison = compareTaskBenchmarkReceipts(baseline.receipt, optimized.receipt);
    assert.equal(comparison.quota, null);
    assert.equal(comparison.verdict, 'baseline-better');
    assert.equal(comparison.basis, 'failed-attempts');
    assert.equal(comparison.evidenceLevel, 'local-evidence');
  });
});
