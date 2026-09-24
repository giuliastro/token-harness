import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONTEXT_GOVERNOR_MAX_MATERIALS,
  parseContextGovernorSnapshot,
} from '../src/domain/context-governor.js';

const VALID_SNAPSHOT = {
  schemaVersion: 1,
  harnessId: 'codex',
  taskBoundary: 'continuing',
  validation: 'passing',
  quality: 'passed',
  reuse: 'efficient',
  materials: [
    {
      kind: 'tool-output',
      state: 'superseded',
      byteLength: 512,
      reduction: 'none',
    },
  ],
};

describe('context governor snapshot parser', () => {
  it('accepts a versioned content-free observation', () => {
    const parsed = parseContextGovernorSnapshot(VALID_SNAPSHOT);
    assert.ok(parsed);
    assert.equal(parsed.harnessId, 'codex');
    assert.equal(parsed.materials[0]?.byteLength, 512);
  });

  it('rejects extra fields at both levels', () => {
    assert.equal(
      parseContextGovernorSnapshot({ ...VALID_SNAPSHOT, transcript: 'must never be accepted' }),
      null,
    );
    assert.equal(
      parseContextGovernorSnapshot({
        ...VALID_SNAPSHOT,
        materials: [{ ...VALID_SNAPSHOT.materials[0], path: '/private/file' }],
      }),
      null,
    );
  });

  it('rejects unsupported harnesses and invalid byte or checkpoint bounds', () => {
    assert.equal(parseContextGovernorSnapshot({ ...VALID_SNAPSHOT, harnessId: 'opencode' }), null);
    assert.equal(
      parseContextGovernorSnapshot({
        ...VALID_SNAPSHOT,
        materials: [{ ...VALID_SNAPSHOT.materials[0], byteLength: -1 }],
      }),
      null,
    );
    assert.equal(
      parseContextGovernorSnapshot({ ...VALID_SNAPSHOT, checkpointMaxBytes: 255 }),
      null,
    );
  });

  it('rejects more than 128 material observations', () => {
    const materials = Array.from({ length: CONTEXT_GOVERNOR_MAX_MATERIALS + 1 }, () => ({
      ...VALID_SNAPSHOT.materials[0],
    }));
    assert.equal(parseContextGovernorSnapshot({ ...VALID_SNAPSHOT, materials }), null);
  });
});
