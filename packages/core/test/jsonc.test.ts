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
