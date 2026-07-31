import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appendJsoncRootArray, parseJsoncDocumentText } from '../src/index.js';

describe('JSONC editor', () => {
  const original = `{
  // Kept exactly: this is the user's note.
  "plugin": [
    "existing", // and this trailing comment stays too
  ],
  "theme": "dark",
}\n`;

  it('reads comments and trailing commas without treating the file as malformed', () => {
    const parsed = parseJsoncDocumentText(original);
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { plugin: ['existing'], theme: 'dark' });
  });

  it('inserts into an existing array without rewriting user comments or commas', () => {
    const result = appendJsoncRootArray(original, 'plugin', '@token-harness/opencode');
    assert.equal(result.state, 'edited');
    if (result.state !== 'edited') return;
    assert.match(result.text, /Kept exactly: this is the user's note/);
    assert.match(result.text, /and this trailing comment stays too/);
    assert.match(result.text, /"theme": "dark",/);
    const parsed = parseJsoncDocumentText(result.text);
    assert.equal(parsed.state, 'parsed');
    if (parsed.state === 'parsed') {
      assert.deepEqual(parsed.document, {
        plugin: ['existing', '@token-harness/opencode'],
        theme: 'dark',
      });
    }
  });

  it('refuses a missing array instead of reconstructing the document', () => {
    const result = appendJsoncRootArray(original, 'missing', 'value');
    assert.deepEqual(result, { state: 'uneditable', reason: 'the "missing" array does not exist' });
  });
});

describe('trailing commas inside strings', () => {
  /**
   * The regression these exist for.
   *
   * The trailing-comma stripper was `text.replace(/,(\s*[}\]])/g, '$1')` — a regex over the whole
   * document, which cannot see string boundaries. `"wait for it, }"` silently became
   * `"wait for it }"`, in a module whose whole purpose is not to alter a user's file, and the
   * parsed value is what an adapter reports as a configured command.
   */
  it('keeps a comma that is inside a string value', () => {
    const parsed = parseJsoncDocumentText('{"note": "wait for it, }", "n": 1}');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { note: 'wait for it, }', n: 1 });
  });

  it('keeps a comma before a bracket inside a string', () => {
    const parsed = parseJsoncDocumentText('{"a": ["x, ]"], "b": 2}');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { a: ['x, ]'], b: 2 });
  });

  it('is not fooled by an escaped quote before the comma', () => {
    const parsed = parseJsoncDocumentText('{"s": "a \\" b, ]", "t": [1,]}');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { s: 'a " b, ]', t: [1] });
  });

  it('still removes real trailing commas', () => {
    const parsed = parseJsoncDocumentText('{"a": [1, 2,], "b": 3,}');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { a: [1, 2], b: 3 });
  });

  it('removes a trailing comma separated from its bracket by a comment', () => {
    // Comments are blanked before this runs, so the comma and the bracket end up separated by
    // whitespace alone — which is exactly what the stripper is allowed to look through.
    const parsed = parseJsoncDocumentText('{"t": [1, /* done, ] */]}');
    assert.equal(parsed.state, 'parsed');
    if (parsed.state !== 'parsed') return;
    assert.deepEqual(parsed.document, { t: [1] });
  });

  it('leaves an unterminated string for the parser to reject', () => {
    // Copied to the end rather than guessed at: a malformed document should be reported as
    // malformed, not silently repaired into something that parses.
    assert.equal(parseJsoncDocumentText('{"s": "no end}').state, 'malformed');
  });
});
