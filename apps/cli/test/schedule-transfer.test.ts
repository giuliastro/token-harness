import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestText,
  harnessId,
  type CrossHarnessTransferReceipt,
} from '@token-harness/core';

import {
  readProjectTransferReceipts,
  type ProjectTransferReceiptReaderInput,
} from '../src/schedule-transfer.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const STATE_ROOT = '/state';
const ROOT = `${STATE_ROOT}/benchmarks`;
const PROJECT = 'p_current';

function receipt(
  benchmarkId: string,
  overrides: Partial<CrossHarnessTransferReceipt> = {},
): CrossHarnessTransferReceipt {
  return {
    schemaVersion: 1,
    benchmarkId,
    projectId: PROJECT,
    taskClass: 'hard',
    currentHarness: CLAUDE,
    candidateHarness: CODEX,
    handoffBytes: 700,
    handoffDigest: digestText(`# ${benchmarkId}`),
    maxHandoffBytes: 2048,
    benefit: 'proven-positive',
    basis: 'quality',
    reasons: ['fixture evidence'],
    recordedAt: '2026-09-05T04:00:00.000Z',
    ...overrides,
  };
}

function fixture() {
  const files = new Map<string, string>();
  const directories = new Set<string>([ROOT]);
  const children = new Map<string, string[]>([[ROOT, []]]);
  const encoded = new TextEncoder();

  function addReceipt(directoryName: string, value: unknown): void {
    const directory = `${ROOT}/${directoryName}`;
    if (!directories.has(directory)) {
      directories.add(directory);
      children.set(ROOT, [...(children.get(ROOT) ?? []), directoryName]);
    }
    files.set(`${directory}/transfer.json`, JSON.stringify(value));
  }

  const fs: ProjectTransferReceiptReaderInput['fs'] = {
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

  return { files, directories, children, addReceipt, fs };
}

async function read(f: ReturnType<typeof fixture>) {
  return readProjectTransferReceipts({
    fs: f.fs,
    stateRoot: STATE_ROOT,
    projectId: PROJECT,
  });
}

describe('schedule project transfer receipt reader', () => {
  it('admits valid receipts attributed to the current project', async () => {
    const f = fixture();
    f.addReceipt('hard-b', receipt('hard-b'));
    f.addReceipt('hard-a', receipt('hard-a'));

    const rows = await read(f);
    assert.deepEqual(rows.map((row) => row.benchmarkId), ['hard-a', 'hard-b']);
  });

  it('ignores receipts attributed to another project', async () => {
    const f = fixture();
    f.addReceipt('other', receipt('other', { projectId: 'p_other' }));

    assert.deepEqual(await read(f), []);
  });

  it('ignores a valid receipt stored under a different benchmark directory', async () => {
    const f = fixture();
    f.addReceipt('directory-id', receipt('receipt-id'));

    assert.deepEqual(await read(f), []);
  });

  it('ignores malformed and future-schema transfer state', async () => {
    const f = fixture();
    f.addReceipt('malformed', { schemaVersion: 1 });
    f.addReceipt('future', { ...receipt('future'), schemaVersion: 2 });
    const badDir = `${ROOT}/bad-json`;
    f.directories.add(badDir);
    f.children.set(ROOT, [...(f.children.get(ROOT) ?? []), 'bad-json']);
    f.files.set(`${badDir}/transfer.json`, '{not-json');

    assert.deepEqual(await read(f), []);
  });

  it('returns an empty set when benchmark state does not exist', async () => {
    const f = fixture();
    f.directories.delete(ROOT);

    assert.deepEqual(await read(f), []);
  });
});
