/**
 * The published matrices — PLAN §8.3, last bullet.
 *
 * Two assertions, and they guard opposite failures.
 *
 * The generated tables must equal what the manifests currently say, because a hand-maintained copy
 * of data the code already holds goes stale in one direction only: the document keeps promising what
 * the build stopped doing, and nothing complains.
 *
 * The hand-written section must mention every limitation a manifest declares. That direction cannot
 * be generated — most of those limitations are facts about the world, not manifest fields — so what
 * is checked is completeness rather than wording.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * The generators, imported rather than re-implemented.
 *
 * Importing them must not *write* the file — that is why the write lives in
 * `tests/tools/matrices.mjs` and not here. A generator that regenerated the artifact on import would
 * make this test compare the file against itself and it could never fail.
 */
import {
  HANDWRITTEN_MARKER,
  MATRICES_PATH,
  declaredLimitations,
  generatedSection,
} from '../src/index.js';

const document = readFileSync(MATRICES_PATH, 'utf8');

describe('the published matrices', () => {
  it('matches what the manifests say right now', () => {
    const generated = document.slice(0, document.indexOf(HANDWRITTEN_MARKER));
    assert.equal(
      generated,
      `${generatedSection()}\n`,
      'docs/matrices.md is out of date — run `node tests/tools/matrices.mjs`',
    );
  });

  it('mentions every limitation a manifest declares', () => {
    const known = document.slice(document.indexOf(HANDWRITTEN_MARKER));
    const stated = declaredLimitations();
    // Without this the loop below passes on an empty list, which is the state a refactor that
    // stopped collecting limitations would produce — and it would look like coverage.
    assert.ok(stated.length > 0, 'no manifest declares a limitation, so this test checks nothing');

    for (const limitation of stated) {
      /**
       * Matched on the opening words rather than on the whole sentence.
       *
       * A manifest's `limitation` is written for a diagnostic and this document is prose; requiring
       * the exact string would force one of them to be worded for the other. What must not happen is
       * a limitation being declared in code and absent here.
       *
       * The words must be *contiguous*. The first version of this filtered out short words first and
       * joined what was left, which built a phrase that appears in neither text — it failed against a
       * document that did contain the limitation, spelled the way the manifest spells it. A matcher
       * whose failures do not mean what they say is worse than no matcher.
       */
      const normalize = (text: string): string =>
        text.toLowerCase().replace(/[`*]/g, '').replace(/\s+/g, ' ');
      const fragment = limitation.split(/[,.;]/)[0]?.trim() ?? limitation;
      const anchor = normalize(fragment).split(' ').slice(0, 4).join(' ');
      assert.ok(
        anchor !== '' && normalize(known).includes(anchor),
        `no limitation in docs/matrices.md covers: ${limitation}\n  looked for: ${anchor}`,
      );
    }
  });

  it('has a hand-written section at all', () => {
    // The control for the test above: with no such section, `known` would be empty and every
    // `includes` would fail loudly rather than the suite passing on an empty search space. Asserted
    // anyway, because a generator that silently dropped the marker would make the second test's
    // failure look like a documentation problem.
    assert.ok(document.includes(HANDWRITTEN_MARKER));
    assert.ok(document.indexOf(HANDWRITTEN_MARKER) < document.length - 200);
  });
});
