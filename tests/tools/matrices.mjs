/**
 * Writes `docs/matrices.md` — PLAN §8.3, last bullet.
 *
 * A runner only. The generators live in `tests/src/matrices.ts` so that
 * `tests/integration/matrices.test.ts` can import them and compare their output against the
 * committed file; a plain `.mjs` here is not compiled, so a test cannot import it.
 *
 * The write lives here and not in that module for the same reason: a generator that rewrote the
 * artifact on import would make the test compare the file against itself, and it could never fail.
 *
 * Everything above the known-limitations heading is replaced. Everything from that heading down is
 * carried through untouched, because a person wrote it.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { HANDWRITTEN_MARKER, MATRICES_PATH, generatedSection } from '../dist/src/matrices.js';

const existing = (() => {
  try {
    return readFileSync(MATRICES_PATH, 'utf8');
  } catch {
    return '';
  }
})();

const index = existing.indexOf(HANDWRITTEN_MARKER);
const placeholder = [
  HANDWRITTEN_MARKER,
  '',
  'Written by hand. Every limitation a manifest declares must appear here; the test checks it.',
  '',
].join('\n');

const handwritten = index < 0 ? placeholder : existing.slice(index);

writeFileSync(MATRICES_PATH, `${generatedSection()}\n${handwritten}`, 'utf8');
console.log(`wrote ${MATRICES_PATH}`);
