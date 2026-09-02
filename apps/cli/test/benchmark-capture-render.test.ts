import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type TaskBenchmarkCaptureFinishReport,
  type TaskBenchmarkCaptureStartReport,
} from '@token-harness/core';

import {
  renderBenchmarkFinishReport,
  renderBenchmarkStartReport,
} from '../src/render/benchmark-capture.js';

const capture = {
  schemaVersion: 1 as const,
  benchmarkId: 'mechanical-real-1',
  variant: 'baseline' as const,
  taskClass: 'mechanical' as const,
  harnessId: harnessId('codex'),
  projectId: 'p_test',
  model: 'gpt-5.6-codex',
  reasoningEffort: 'medium',
  verbosity: 'low',
  startedAt: '2026-09-02T10:00:00.000Z',
  usageBefore: [],
};

describe('benchmark capture rendering', () => {
  it('shows the exact finish command after start', () => {
    const report: TaskBenchmarkCaptureStartReport = {
      capture,
      capturePath:
        '/home/dev/.local/state/token-harness/benchmarks/mechanical-real-1/baseline.capture.json',
    };
    const rendered = renderBenchmarkStartReport(report, {
      toolVersion: 'test',
      home: '/home/dev',
      decorate: false,
    });

    assert.match(rendered, /^Benchmark start — mechanical-real-1 \/ baseline$/m);
    assert.match(rendered, /benchmark-finish/);
    assert.match(rendered, /--quality passed/);
    assert.match(rendered, /baseline\.capture\.json/);
    for (const line of rendered.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `line is ${String(line.length)} chars: ${line}`);
    }
  });

  it('makes local-usage absence explicit after finish', () => {
    const report: TaskBenchmarkCaptureFinishReport = {
      capturePath:
        '/home/dev/.local/state/token-harness/benchmarks/mechanical-real-1/baseline.capture.json',
      receiptPath:
        '/home/dev/.local/state/token-harness/benchmarks/mechanical-real-1/baseline.json',
      receipt: {
        schemaVersion: 1,
        benchmarkId: capture.benchmarkId,
        variant: capture.variant,
        taskClass: capture.taskClass,
        harnessId: capture.harnessId,
        model: capture.model,
        reasoningEffort: capture.reasoningEffort,
        verbosity: capture.verbosity,
        startedAt: capture.startedAt,
        completedAt: '2026-09-02T10:20:00.000Z',
        usageBefore: [],
        usageAfter: [],
        localUsage: null,
        outcome: {
          qualityGate: 'passed',
          attempts: 1,
          failedAttempts: 0,
          errorCodes: [],
        },
      },
    };

    const rendered = renderBenchmarkFinishReport(report, {
      toolVersion: 'test',
      home: '/home/dev',
      decorate: false,
    });
    assert.match(rendered, /Local usage: not captured by this slice/);
    assert.match(rendered, /token-harness benchmark --baseline/);
    for (const line of rendered.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `line is ${String(line.length)} chars: ${line}`);
    }
  });
});
