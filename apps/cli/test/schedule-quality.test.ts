import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
} from '@token-harness/core';

import {
  readProjectBenchmarkReceipts,
  type ProjectBenchmarkReceiptReaderInput,
} from '../src/schedule-quality.js';

const CODEX = harnessId('codex');
const CLAUDE = harnessId('claude');
const STATE_ROOT = '/state';
const ROOT = `${STATE_ROOT}/benchmarks`;
const PROJECT = 'p_current';

function receipt(input: {
  benchmarkId: string;
  variant: 'baseline' | 'optimized';
  quality?: TaskQualityGate;
  harness?: typeof CODEX | typeof CLAUDE;
  taskClass?: 'mechanical' | 'standard' | 'hard' | 'critical';
}): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: input.variant,
    taskClass: input.taskClass ?? 'hard',
    harnessId: input.harness ?? CODEX,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T12:00:00.000Z',
    completedAt: '2026-09-04T12:05:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: {
      qualityGate: input.quality ?? 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
  };
}

function capture(input: {
  benchmarkId: string;
  variant: 'baseline' | 'optimized';
  projectId?: string;
  harness?: typeof CODEX | typeof CLAUDE;
  taskClass?: 'mechanical' | 'standard' | 'hard' | 'critical';
}): TaskBenchmarkCapture {
  return {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: input.variant,
    taskClass: input.taskClass ?? 'hard',
    harnessId: input.harness ?? CODEX,
    projectId: input.projectId ?? PROJECT,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T12:00:00.000Z',
    usageBefore: [],
    localSessionsBefore: null,
  };
}

function fixture() {
  const files = new Map<string, string>();
  const directories = new Set<string>([ROOT]);
  const children = new Map<string, string[]>([[ROOT, []]]);
  const encoded = new TextEncoder();

  function addDirectory(benchmarkId: string): string {
    const directory = `${ROOT}/${benchmarkId}`;
    directories.add(directory);
    children.set(ROOT, [...(children.get(ROOT) ?? []), benchmarkId]);
    return directory;
  }

  function addVariant(input: {
    benchmarkId: string;
    variant: 'baseline' | 'optimized';
    receipt?: TaskBenchmarkReceipt;
    capture?: TaskBenchmarkCapture;
  }): void {
    const directory = directories.has(`${ROOT}/${input.benchmarkId}`)
      ? `${ROOT}/${input.benchmarkId}`
      : addDirectory(input.benchmarkId);
    if (input.receipt !== undefined) {
      files.set(`${directory}/${input.variant}.json`, JSON.stringify(input.receipt));
    }
    if (input.capture !== undefined) {
      files.set(`${directory}/${input.variant}.capture.json`, JSON.stringify(input.capture));
    }
  }

  const fs: ProjectBenchmarkReceiptReaderInput['fs'] = {
    join: (...parts) => parts.join('/').replaceAll('//', '/'),
    stat: async (path) => {
      if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
      const text = files.get(path);
      return text === undefined
        ? null
        : { kind: 'file', byteLength: encoded.encode(text).byteLength, mode: null };
    },
    readFile: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error('missing fixture file');
      return encoded.encode(text);
    },
    readDirectory: async (path) => children.get(path) ?? [],
  };

  return { files, directories, children, addDirectory, addVariant, fs };
}

describe('schedule project benchmark receipt reader', () => {
  it('admits matching baseline and optimized receipt/capture variants for the project', async () => {
    const f = fixture();
    f.addVariant({
      benchmarkId: 'hard-a',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'hard-a', variant: 'baseline', quality: 'passed' }),
      capture: capture({ benchmarkId: 'hard-a', variant: 'baseline' }),
    });
    f.addVariant({
      benchmarkId: 'hard-a',
      variant: 'optimized',
      receipt: receipt({ benchmarkId: 'hard-a', variant: 'optimized', quality: 'failed' }),
      capture: capture({ benchmarkId: 'hard-a', variant: 'optimized' }),
    });

    const rows = await readProjectBenchmarkReceipts({
      fs: f.fs,
      stateRoot: STATE_ROOT,
      projectId: PROJECT,
    });

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.benchmarkId, row.variant, row.outcome.qualityGate]),
      [
        ['hard-a', 'baseline', 'passed'],
        ['hard-a', 'optimized', 'failed'],
      ],
    );
  });

  it('ignores otherwise valid receipts attributed to another project', async () => {
    const f = fixture();
    f.addVariant({
      benchmarkId: 'hard-other',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'hard-other', variant: 'baseline' }),
      capture: capture({ benchmarkId: 'hard-other', variant: 'baseline', projectId: 'p_other' }),
    });

    const rows = await readProjectBenchmarkReceipts({
      fs: f.fs,
      stateRoot: STATE_ROOT,
      projectId: PROJECT,
    });

    assert.deepEqual(rows, []);
  });

  it('rejects receipt/capture identity mismatches instead of trusting either side', async () => {
    const f = fixture();
    f.addVariant({
      benchmarkId: 'wrong-harness',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'wrong-harness', variant: 'baseline', harness: CODEX }),
      capture: capture({ benchmarkId: 'wrong-harness', variant: 'baseline', harness: CLAUDE }),
    });
    f.addVariant({
      benchmarkId: 'wrong-task',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'wrong-task', variant: 'baseline', taskClass: 'hard' }),
      capture: capture({ benchmarkId: 'wrong-task', variant: 'baseline', taskClass: 'standard' }),
    });
    f.addVariant({
      benchmarkId: 'wrong-id',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'wrong-id', variant: 'baseline' }),
      capture: capture({ benchmarkId: 'different-id', variant: 'baseline' }),
    });

    const rows = await readProjectBenchmarkReceipts({
      fs: f.fs,
      stateRoot: STATE_ROOT,
      projectId: PROJECT,
    });

    assert.deepEqual(rows, []);
  });

  it('ignores missing, malformed, and unparsable sibling state', async () => {
    const f = fixture();
    f.addVariant({
      benchmarkId: 'missing-capture',
      variant: 'baseline',
      receipt: receipt({ benchmarkId: 'missing-capture', variant: 'baseline' }),
    });
    const malformedDir = f.addDirectory('malformed');
    f.files.set(`${malformedDir}/baseline.json`, '{not-json');
    f.files.set(
      `${malformedDir}/baseline.capture.json`,
      JSON.stringify(capture({ benchmarkId: 'malformed', variant: 'baseline' })),
    );
    const invalidDir = f.addDirectory('invalid-shape');
    f.files.set(`${invalidDir}/baseline.json`, JSON.stringify({ schemaVersion: 1 }));
    f.files.set(
      `${invalidDir}/baseline.capture.json`,
      JSON.stringify(capture({ benchmarkId: 'invalid-shape', variant: 'baseline' })),
    );

    const rows = await readProjectBenchmarkReceipts({
      fs: f.fs,
      stateRoot: STATE_ROOT,
      projectId: PROJECT,
    });

    assert.deepEqual(rows, []);
  });

  it('returns an empty set when benchmark state does not exist', async () => {
    const f = fixture();
    f.directories.delete(ROOT);

    const rows = await readProjectBenchmarkReceipts({
      fs: f.fs,
      stateRoot: STATE_ROOT,
      projectId: PROJECT,
    });

    assert.deepEqual(rows, []);
  });
});
