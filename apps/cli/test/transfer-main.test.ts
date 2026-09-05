import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestText,
  harnessId,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
} from '@token-harness/core';

import { transferMain } from '../src/transfer-main.js';
import type { TransferObservation } from '../src/transfer-runtime.js';
import { TOOL_VERSION } from '../src/version.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function receipt(input: {
  harness: typeof CLAUDE | typeof CODEX;
  variant: 'baseline' | 'optimized';
  quality: TaskQualityGate;
  attempts?: number;
  failedAttempts?: number;
}): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: 'transfer-hard-a',
    variant: input.variant,
    taskClass: 'hard',
    harnessId: input.harness,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T18:00:00.000Z',
    completedAt: '2026-09-04T18:10:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: {
      qualityGate: input.quality,
      attempts: input.attempts ?? 1,
      failedAttempts: input.failedAttempts ?? 0,
      errorCodes: [],
    },
  };
}

function observed(): TransferObservation {
  return {
    status: 'observed',
    experiment: {
      projectId: 'p_current',
      stay: receipt({ harness: CLAUDE, variant: 'baseline', quality: 'failed' }),
      switched: receipt({ harness: CODEX, variant: 'optimized', quality: 'passed' }),
      handoffBytes: 700,
      handoffDigest: digestText('handoff fixture'),
    },
    reason: null,
  };
}

const args = ['--benchmark-id', 'transfer-hard-a', '--handoff-file', 'handoff.md'] as const;

describe('transfer CLI', () => {
  it('evaluates an observed project transfer experiment', async () => {
    const output = capture();
    const exitCode = await transferMain(args, output.streams, {
      observeExperiment: async () => observed(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /Cross-harness transfer evidence: proven-positive/);
    assert.match(output.stdout(), /Route: claude -> codex/);
    assert.match(output.stdout(), /Task class: hard/);
    assert.match(output.stdout(), /Basis: quality/);
    assert.match(output.stdout(), /Handoff: 700 \/ 2048 bytes/);
  });

  it('emits the assessment in the standard JSON envelope', async () => {
    const output = capture();
    const exitCode = await transferMain([...args, '--json'], output.streams, {
      observeExperiment: async () => observed(),
    });

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      data: {
        taskClass: string;
        assessment: { benefit: string; basis: string; handoffBytes: number };
      };
    };
    assert.equal(envelope.command, 'transfer');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.data.taskClass, 'hard');
    assert.equal(envelope.data.assessment.benefit, 'proven-positive');
    assert.equal(envelope.data.assessment.basis, 'quality');
    assert.equal(envelope.data.assessment.handoffBytes, 700);
  });

  it('honors the configured handoff budget', async () => {
    const output = capture();
    const exitCode = await transferMain([...args, '--max-handoff-bytes', '512'], output.streams, {
      observeExperiment: async () => observed(),
    });

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Cross-harness transfer evidence: non-positive/);
    assert.match(output.stdout(), /Basis: handoff-budget/);
  });

  it('returns a precondition error when the project pair cannot be admitted', async () => {
    const output = capture();
    const exitCode = await transferMain(args, output.streams, {
      observeExperiment: async () => ({
        status: 'other-project',
        experiment: null,
        reason: 'benchmark pair belongs to a different local project',
      }),
    });

    assert.equal(exitCode, 5);
    assert.equal(output.stdout(), '');
    assert.match(output.stderr(), /transfer-other-project/);
  });

  it('rejects malformed input without touching the runtime', async () => {
    const output = capture();
    let observations = 0;
    const exitCode = await transferMain(['--benchmark-id', 'INVALID'], output.streams, {
      observeExperiment: async () => {
        observations += 1;
        return observed();
      },
    });

    assert.equal(exitCode, 2);
    assert.equal(observations, 0);
    assert.match(output.stderr(), /invalid-transfer-input/);
  });

  it('lets help/version win without observing local state', async () => {
    let observations = 0;
    const runtime = {
      observeExperiment: async () => {
        observations += 1;
        return observed();
      },
    };

    const help = capture();
    assert.equal(await transferMain(['--bad', '--help'], help.streams, runtime), 0);
    assert.match(help.stdout(), /token-harness transfer/);

    const version = capture();
    assert.equal(await transferMain(['--bad', '--version'], version.streams, runtime), 0);
    assert.equal(version.stdout(), `${TOOL_VERSION}\n`);
    assert.equal(observations, 0);
  });
});
