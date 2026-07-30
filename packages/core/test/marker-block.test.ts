/**
 * Marker-fenced blocks — RFC 0004 §Ownership.
 *
 * The important test in this file is the last one. Everything outside the fence
 * belongs to the user, and RFC 0004 §Brownfield adoption requires it back
 * byte-for-byte, so `upsert` followed by `remove` must return the original bytes for
 * every file shape — including the awkward ones nobody writes a fixture for by
 * accident: CRLF, a byte-order mark, no trailing newline, empty.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestText,
  findMarkerBlock,
  removeMarkerBlock,
  upsertMarkerBlock,
  type MarkerCommentSyntax,
} from '../src/index.js';

const FENCE = { begin: 'token-harness:begin', end: 'token-harness:end' };
const HASH: MarkerCommentSyntax = { prefix: '#', suffix: '' };
const HTML: MarkerCommentSyntax = { prefix: '<!--', suffix: '-->' };

function upsert(text: string, body: string, syntax: MarkerCommentSyntax = HASH): string {
  const result = upsertMarkerBlock({ text, fence: FENCE, syntax, body });
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.text;
}

function remove(text: string): string {
  const result = removeMarkerBlock(text, FENCE);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.text;
}

describe('locating a block', () => {
  it('reports absence when neither fence is present', () => {
    assert.equal(findMarkerBlock('# nothing to see\n', FENCE).state, 'absent');
  });

  it('finds a block and digests its body, not the whole file', () => {
    const lookup = findMarkerBlock(
      'user content\n# token-harness:begin\nours\n# token-harness:end\nmore user content\n',
      FENCE,
    );
    assert.equal(lookup.state, 'found');
    if (lookup.state !== 'found') return;
    assert.equal(lookup.block.body, 'ours\n');
    assert.equal(lookup.block.bodyDigest, digestText('ours\n'));
  });

  it('matches a fence by the token the line contains, whatever the comment syntax', () => {
    for (const fence of [
      '# token-harness:begin',
      '// token-harness:begin',
      '<!-- token-harness:begin -->',
      '    ; token-harness:begin (added by hand)',
    ]) {
      const end = fence.replace('begin', 'end');
      const lookup = findMarkerBlock(`${fence}\nours\n${end}\n`, FENCE);
      assert.equal(lookup.state, 'found', fence);
    }
  });

  /**
   * Found by the round-trip table below, which is what property tests are for. Plain
   * substring matching turns a user's sentence mentioning `token-harness:beginner`
   * into an unterminated block, and then refuses to write anything to their file.
   */
  it('does not mistake a longer word for the token', () => {
    for (const line of ['see token-harness:beginner\n', 'token-harness:endorsed by nobody\n']) {
      assert.equal(findMarkerBlock(line, FENCE).state, 'absent', line);
    }
  });

  it('still matches a delimiter pressed against the token', () => {
    assert.equal(
      findMarkerBlock('<!--token-harness:begin-->\nours\n<!--token-harness:end-->\n', FENCE).state,
      'found',
    );
  });

  it('locates an empty block', () => {
    const lookup = findMarkerBlock('# token-harness:begin\n# token-harness:end\n', FENCE);
    assert.equal(lookup.state, 'found');
    if (lookup.state !== 'found') return;
    assert.equal(lookup.block.body, '');
  });

  const malformed: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['an unterminated block', '# token-harness:begin\nours\n', /is never closed/],
    ['a stray end fence', 'user\n# token-harness:end\n', /with no matching/],
    [
      'two begin fences',
      '# token-harness:begin\na\n# token-harness:end\n# token-harness:begin\nb\n# token-harness:end\n',
      /more than one/,
    ],
  ];

  for (const [name, text, reason] of malformed) {
    it(`refuses to guess at ${name}`, () => {
      const lookup = findMarkerBlock(text, FENCE);
      assert.equal(lookup.state, 'malformed');
      if (lookup.state !== 'malformed') return;
      assert.match(lookup.reason, reason);
      // And the write path refuses for the same reason rather than appending a
      // second block beside the broken one.
      const write = upsertMarkerBlock({ text, fence: FENCE, syntax: HASH, body: 'x' });
      assert.equal(write.ok, false);
    });
  }
});

describe('inserting a block', () => {
  it('appends it, with the comment syntax it was given', () => {
    assert.equal(
      upsert('user\n', 'ours\n', HTML),
      'user\n\n<!-- token-harness:begin -->\nours\n<!-- token-harness:end -->\n',
    );
  });

  it('creates the whole file when there was nothing there', () => {
    assert.equal(upsert('', 'ours\n'), '# token-harness:begin\nours\n# token-harness:end\n');
  });

  it('normalizes the body to the file line ending, and adds the final one', () => {
    assert.equal(
      upsert('user\r\n', 'a\nb'),
      'user\r\n\r\n# token-harness:begin\r\na\r\nb\r\n# token-harness:end\r\n',
    );
  });

  it('keeps a byte-order mark at the front where it belongs', () => {
    const result = upsert('﻿user\n', 'ours\n');
    assert.ok(result.startsWith('﻿'), JSON.stringify(result.slice(0, 3)));
    assert.equal(result.indexOf('﻿', 1), -1, 'exactly one byte-order mark');
  });

  it('inherits the absence of a trailing newline rather than adding one', () => {
    // The file's trailing-newline property is what makes `remove` an exact inverse.
    assert.ok(!upsert('user', 'ours\n').endsWith('\n'));
  });
});

describe('updating a block', () => {
  it('replaces only the body', () => {
    const before = 'top\n# token-harness:begin\nold\n# token-harness:end\nbottom\n';
    assert.equal(
      upsert(before, 'new\n'),
      'top\n# token-harness:begin\nnew\n# token-harness:end\nbottom\n',
    );
  });

  it('leaves a fence the user reformatted exactly as they wrote it', () => {
    const before =
      'top\n   <!-- token-harness:begin (do not edit) -->\nold\n<!--token-harness:end-->\n';
    const after = upsert(before, 'new\n', HTML);
    assert.ok(after.includes('   <!-- token-harness:begin (do not edit) -->'), after);
    assert.ok(after.includes('<!--token-harness:end-->'), after);
  });

  it('reports that nothing changed when the body is already exactly right', () => {
    const text = 'top\n# token-harness:begin\nours\n# token-harness:end\n';
    const result = upsertMarkerBlock({ text, fence: FENCE, syntax: HASH, body: 'ours\n' });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.changed, false);
    assert.equal(result.text, text);
  });

  it('is idempotent', () => {
    const once = upsert('user\n', 'ours\n');
    assert.equal(upsert(once, 'ours\n'), once);
  });
});

describe('removing a block', () => {
  it('takes the fences with it and leaves the rest alone', () => {
    assert.equal(
      remove('top\n# token-harness:begin\nours\n# token-harness:end\nbottom\n'),
      'top\nbottom\n',
    );
  });

  it('reports that nothing changed when there is no block', () => {
    const result = removeMarkerBlock('user\n', FENCE);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.changed, false);
  });

  it('refuses a malformed block instead of deleting half of it', () => {
    const result = removeMarkerBlock('# token-harness:begin\nours\n', FENCE);
    assert.equal(result.ok, false);
  });
});

/**
 * The property, over every file shape that has ever broken a text editor.
 *
 * RFC 0004 §Brownfield adoption clause 5: "configuration the user wrote is preserved
 * byte-for-byte where it is not the specific entry being adopted."
 */
describe('insert and remove are exact inverses', () => {
  const FILES: ReadonlyArray<readonly [string, string]> = [
    ['an empty file', ''],
    ['a single line with a newline', 'user\n'],
    ['a single line without a newline', 'user'],
    ['several lines', 'a\nb\nc\n'],
    ['CRLF throughout', 'a\r\nb\r\n'],
    ['CRLF without a final newline', 'a\r\nb'],
    ['mixed endings', 'a\r\nb\nc\r\n'],
    ['a trailing blank line', 'a\n\n'],
    ['several trailing blank lines', 'a\n\n\n\n'],
    ['a leading blank line', '\na\n'],
    ['only blank lines', '\n\n'],
    ['a byte-order mark', '﻿a\n'],
    ['a byte-order mark and no trailing newline', '﻿a'],
    ['content that mentions the marker inside a word', 'see token-harness:beginner\n'],
    ['tabs and trailing spaces the user wants kept', '\ta = 1   \n  b\t\n'],
  ];

  const BODIES: readonly string[] = ['ours\n', 'ours', '', 'a\nb\n', 'a\r\nb\r\n'];

  for (const [name, original] of FILES) {
    for (const body of BODIES) {
      it(`${name}, body ${JSON.stringify(body)}`, () => {
        const written = upsert(original, body);
        assert.notEqual(written, original, 'the block should have been written');
        assert.equal(remove(written), original);
      });
    }
  }

  it('survives a second pass through the same body', () => {
    for (const [, original] of FILES) {
      const once = upsert(original, 'ours\n');
      const twice = upsert(once, 'ours\n');
      assert.equal(twice, once);
      assert.equal(remove(twice), original);
    }
  });

  it('survives an updated body', () => {
    for (const [, original] of FILES) {
      const written = upsert(upsert(original, 'first\n'), 'second\n');
      assert.ok(written.includes('second'));
      assert.ok(!written.includes('first'));
      assert.equal(remove(written), original);
    }
  });
});
