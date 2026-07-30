/**
 * Ownership — RFC 0004 §Ownership and §Post-apply drift.
 *
 * The verdict has to be able to come back *no*. "User edits inside an owned file
 * change its digest and block automatic deletion until the user reviews the new
 * uninstall plan" is only true if `owned-modified` is reachable and if
 * `mayRemoveAutomatically` refuses it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIGEST_ALGORITHM,
  digestBytes,
  digestText,
  digestsMatch,
  isDigest,
  mayRemoveAutomatically,
  snapshotIsAbsence,
  verifyOwnership,
  type FileSnapshot,
  type OwnedFileRecord,
  type OwnedMarkerBlockRecord,
} from '../src/index.js';

const OURS = digestText('ours\n');
const THEIRS = digestText('theirs\n');

const FILE: OwnedFileRecord = {
  kind: 'owned-file',
  path: '/home/dev/.local/state/token-harness/receipts/1.json',
  digest: OURS,
  mode: '0600',
};

const BLOCK: OwnedMarkerBlockRecord = {
  kind: 'owned-marker-block',
  path: '/home/dev/project/AGENTS.md',
  markerBegin: 'token-harness:begin',
  markerEnd: 'token-harness:end',
  bodyDigest: OURS,
};

describe('digests', () => {
  it('name the algorithm that produced them', () => {
    assert.ok(OURS.startsWith(`${DIGEST_ALGORITHM}:`));
    assert.ok(isDigest(OURS));
  });

  it('reject anything that is not one', () => {
    for (const value of [
      '',
      'deadbeef',
      'sha256:xyz',
      'md5:'.padEnd(37, '0'),
      OURS.toUpperCase(),
    ]) {
      assert.equal(isDigest(value), false, value);
    }
  });

  it('digest text as UTF-8 with no byte-order mark', () => {
    assert.equal(digestText('ours\n'), digestBytes(new TextEncoder().encode('ours\n')));
  });

  it('never match a null against a null', () => {
    // Two files that both failed to be read are not two identical files.
    assert.equal(digestsMatch(null, null), false);
    assert.equal(digestsMatch(OURS, null), false);
    assert.equal(digestsMatch(OURS, OURS), true);
  });
});

describe('an owned file', () => {
  it('is unchanged when the digest still matches', () => {
    assert.equal(verifyOwnership(FILE, { exists: true, fileDigest: OURS }), 'owned-unchanged');
  });

  it('is modified when it does not', () => {
    assert.equal(verifyOwnership(FILE, { exists: true, fileDigest: THEIRS }), 'owned-modified');
  });

  it('is missing when it is gone', () => {
    assert.equal(verifyOwnership(FILE, { exists: false }), 'missing');
  });
});

describe('an owned marker block', () => {
  it('is unchanged when the body digest matches', () => {
    assert.equal(verifyOwnership(BLOCK, { exists: true, bodyDigest: OURS }), 'owned-unchanged');
  });

  it('is modified when the body was edited', () => {
    assert.equal(verifyOwnership(BLOCK, { exists: true, bodyDigest: THEIRS }), 'owned-modified');
  });

  it('is missing when the fence was removed, even though the file is still there', () => {
    // RFC 0004 §Post-apply drift asks for "an owned marker block that was edited or
    // removed" to be distinguishable. The file was never ours, so `unowned` would be
    // the wrong answer for a file whose block someone deleted.
    assert.equal(verifyOwnership(BLOCK, { exists: true, bodyDigest: null }), 'missing');
  });

  it('does not care what the rest of the file says', () => {
    assert.equal(
      verifyOwnership(BLOCK, { exists: true, bodyDigest: OURS, fileDigest: THEIRS }),
      'owned-unchanged',
    );
  });
});

describe('what may be removed automatically', () => {
  it('is only an unchanged owned artifact', () => {
    assert.equal(mayRemoveAutomatically('owned-unchanged'), true);
    assert.equal(mayRemoveAutomatically('owned-modified'), false);
    assert.equal(mayRemoveAutomatically('missing'), false);
    assert.equal(mayRemoveAutomatically('unowned'), false);
  });
});

describe('a snapshot', () => {
  it('can record an absence, which is what rollback restores after a creation', () => {
    const absence: FileSnapshot = {
      schemaVersion: 1,
      path: '/home/dev/project/AGENTS.md',
      existed: false,
      wasDirectory: false,
      digest: null,
      mode: null,
      byteLength: null,
      contentRef: null,
      capturedAt: '2026-07-29T10:12:04.000Z',
    };
    assert.equal(snapshotIsAbsence(absence), true);
    assert.equal(snapshotIsAbsence({ ...absence, existed: true }), false);
  });
});
