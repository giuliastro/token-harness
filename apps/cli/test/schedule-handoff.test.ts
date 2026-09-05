import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileSystemPort } from '@token-harness/core';

import { readScheduleHandoffBytes } from '../src/schedule-handoff.js';

type HandoffFs = Pick<FileSystemPort, 'stat' | 'readFile'>;

describe('schedule handoff file reader', () => {
  it('returns the exact file byte length without decoding content', async () => {
    const fs: HandoffFs = {
      stat: async () => ({ kind: 'file', byteLength: 99, mode: null }),
      readFile: async () => Uint8Array.from([0, 255, 10, 13, 1]),
    };

    assert.equal(await readScheduleHandoffBytes({ fs, handoffFile: 'handoff.md' }), 5);
  });

  it('returns null for a missing path or a non-file', async () => {
    let reads = 0;
    const missing: HandoffFs = {
      stat: async () => null,
      readFile: async () => {
        reads += 1;
        return new Uint8Array();
      },
    };
    const directory: HandoffFs = {
      stat: async () => ({ kind: 'directory', byteLength: 0, mode: null }),
      readFile: async () => {
        reads += 1;
        return new Uint8Array();
      },
    };

    assert.equal(await readScheduleHandoffBytes({ fs: missing, handoffFile: 'missing.md' }), null);
    assert.equal(await readScheduleHandoffBytes({ fs: directory, handoffFile: 'dir' }), null);
    assert.equal(reads, 0);
  });

  it('returns null when the file cannot be read', async () => {
    const fs: HandoffFs = {
      stat: async () => ({ kind: 'file', byteLength: 12, mode: null }),
      readFile: async () => {
        throw new Error('fixture read failure');
      },
    };

    assert.equal(await readScheduleHandoffBytes({ fs, handoffFile: 'handoff.md' }), null);
  });
});
