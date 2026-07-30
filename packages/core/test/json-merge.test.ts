/**
 * JSON merging — RFC 0004 §Ownership and §Shared config merges.
 *
 * "Shared config merges preserve: unrelated keys; comments where the selected parser
 * supports them; hook order outside the Token Harness-owned entries; user formatting
 * when practical."
 *
 * Each of those four is a describe block below. The comment clause is satisfied by
 * refusing, which is the only honest option for a `JSON.parse` round trip.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canonicalJson,
  containsJsonComment,
  formatJsonDocument,
  jsonValueDigest,
  mergeJsonEntries,
  parseJsonDocumentText,
  parseJsonPointer,
  removeJsonEntry,
  resolveJsonPointer,
  type JsonFormatting,
  type JsonMergeOperation,
  type JsonValue,
} from '../src/index.js';

function parsed(text: string): { document: JsonValue; formatting: JsonFormatting } {
  const result = parseJsonDocumentText(text);
  assert.equal(result.state, 'parsed');
  if (result.state !== 'parsed') throw new Error('unreachable');
  return { document: result.document, formatting: result.formatting };
}

function merged(text: string, operations: readonly JsonMergeOperation[]): string {
  const { document, formatting } = parsed(text);
  const result = mergeJsonEntries(document, operations);
  assert.equal(result.state, 'merged');
  if (result.state !== 'merged') throw new Error('unreachable');
  return formatJsonDocument(result.document, formatting);
}

describe('pointers', () => {
  it('split on dots', () => {
    assert.deepEqual(parseJsonPointer('hooks.PreToolUse'), ['hooks', 'PreToolUse']);
  });

  it('escape a literal dot, because `mcpServers.my.server` is a real shape', () => {
    assert.deepEqual(parseJsonPointer('mcpServers.my\\.server'), ['mcpServers', 'my.server']);
    assert.deepEqual(parseJsonPointer('a\\\\b'), ['a\\b']);
  });

  it('reject the shapes that would silently address the wrong thing', () => {
    for (const pointer of ['', '.', 'a.', '.a', 'a..b', 'a\\b']) {
      assert.equal(parseJsonPointer(pointer), null, JSON.stringify(pointer));
    }
  });

  it('resolve through objects and array indices', () => {
    const document = { hooks: { PreToolUse: [{ matcher: 'Bash' }] } } as JsonValue;
    assert.deepEqual(resolveJsonPointer(document, ['hooks', 'PreToolUse', '0', 'matcher']), {
      found: true,
      value: 'Bash',
    });
    assert.deepEqual(resolveJsonPointer(document, ['hooks', 'Missing']), {
      found: false,
      value: undefined,
    });
    assert.deepEqual(resolveJsonPointer(document, ['hooks', 'PreToolUse', '9']), {
      found: false,
      value: undefined,
    });
  });
});

describe('value identity', () => {
  it('is independent of key order, because reordering is formatting', () => {
    assert.equal(
      jsonValueDigest({ b: 1, a: 2 } as JsonValue),
      jsonValueDigest({ a: 2, b: 1 } as JsonValue),
    );
  });

  it('changes when the content changes', () => {
    assert.notEqual(jsonValueDigest({ a: 1 } as JsonValue), jsonValueDigest({ a: 2 } as JsonValue));
  });

  it('is stable for nested structures and arrays, where order does matter', () => {
    assert.equal(canonicalJson({ a: [1, 2], b: null } as JsonValue), '{"a":[1,2],"b":null}');
    assert.notEqual(jsonValueDigest([1, 2] as JsonValue), jsonValueDigest([2, 1] as JsonValue));
  });
});

describe('comments are refused, not stripped', () => {
  it('detects a comment outside a string', () => {
    assert.equal(containsJsonComment('{\n  // a note\n  "a": 1\n}\n'), true);
    assert.equal(containsJsonComment('{ /* a note */ "a": 1 }'), true);
  });

  it('does not mistake a URL in a value for a comment', () => {
    // Refusing to edit every settings file that mentions https:// would be its own defect.
    assert.equal(containsJsonComment('{ "homepage": "https://example.test/x" }'), false);
    assert.equal(containsJsonComment('{ "escaped": "a \\" // b" }'), false);
  });

  it('reports a commented document as unmergeable rather than parsing it lossily', () => {
    const result = parseJsonDocumentText('{\n  // keep me\n  "a": 1\n}\n');
    assert.equal(result.state, 'comments');
  });

  it('reports malformed JSON separately, so the diagnostic can differ', () => {
    const result = parseJsonDocumentText('{ "a": }');
    assert.equal(result.state, 'malformed');
  });
});

describe('user formatting is preserved', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['two-space indentation', '{\n  "a": 1\n}\n'],
    ['four-space indentation', '{\n    "a": 1\n}\n'],
    ['tab indentation', '{\n\t"a": 1\n}\n'],
    ['CRLF', '{\r\n  "a": 1\r\n}\r\n'],
    ['no trailing newline', '{\n  "a": 1\n}'],
    ['a byte-order mark', '﻿{\n  "a": 1\n}\n'],
  ];

  for (const [name, text] of cases) {
    it(`round trips ${name} untouched when nothing changes`, () => {
      const { document, formatting } = parsed(text);
      assert.equal(formatJsonDocument(document, formatting), text);
    });
  }

  it('writes a new entry in the file existing style', () => {
    const after = merged('{\r\n\t"a": 1\r\n}\r\n', [
      { kind: 'set', pointer: 'b', value: 2, expectedValueDigest: null },
    ]);
    assert.equal(after, '{\r\n\t"a": 1,\r\n\t"b": 2\r\n}\r\n');
  });
});

describe('unrelated keys and hook order are preserved', () => {
  const SETTINGS = [
    '{',
    '  "theme": "dark",',
    '  "hooks": {',
    '    "PreToolUse": [',
    '      { "matcher": "Read", "command": "user-first" },',
    '      { "matcher": "Write", "command": "user-second" }',
    '    ]',
    '  }',
    '}',
    '',
  ].join('\n');

  const ENTRY = { matcher: 'Bash', command: 'rtk hook pre' } as JsonValue;

  it('appends an owned element without disturbing the user entries', () => {
    const after = merged(SETTINGS, [
      { kind: 'append', pointer: 'hooks.PreToolUse', value: ENTRY, expectedValueDigest: null },
    ]);
    const document = parsed(after).document as {
      theme: string;
      hooks: { PreToolUse: { matcher: string }[] };
    };
    assert.equal(document.theme, 'dark');
    assert.deepEqual(
      document.hooks.PreToolUse.map((entry) => entry.matcher),
      ['Read', 'Write', 'Bash'],
    );
  });

  it('replaces an owned element in place, so the user entries keep their positions', () => {
    const first = merged(SETTINGS, [
      { kind: 'append', pointer: 'hooks.PreToolUse', value: ENTRY, expectedValueDigest: null },
    ]);
    // Put a user entry after ours, then update ours.
    const withTrailing = merged(first, [
      {
        kind: 'append',
        pointer: 'hooks.PreToolUse',
        value: { matcher: 'Glob', command: 'user-third' } as JsonValue,
        expectedValueDigest: null,
      },
    ]);
    const updated = merged(withTrailing, [
      {
        kind: 'append',
        pointer: 'hooks.PreToolUse',
        value: { matcher: 'Bash', command: 'rtk hook pre --v2' } as JsonValue,
        expectedValueDigest: jsonValueDigest(ENTRY),
      },
    ]);

    const document = parsed(updated).document as {
      hooks: { PreToolUse: { matcher: string; command: string }[] };
    };
    assert.deepEqual(
      document.hooks.PreToolUse.map((entry) => entry.matcher),
      ['Read', 'Write', 'Bash', 'Glob'],
    );
    assert.equal(document.hooks.PreToolUse[2]?.command, 'rtk hook pre --v2');
  });

  it('creates a missing array and its parent objects', () => {
    const after = merged('{}\n', [
      { kind: 'append', pointer: 'hooks.PostToolUse', value: ENTRY, expectedValueDigest: null },
    ]);
    const document = parsed(after).document as { hooks: { PostToolUse: unknown[] } };
    assert.equal(document.hooks.PostToolUse.length, 1);
  });

  it('is idempotent: appending the same element twice appends once', () => {
    const once = merged(SETTINGS, [
      { kind: 'append', pointer: 'hooks.PreToolUse', value: ENTRY, expectedValueDigest: null },
    ]);
    const twice = merged(once, [
      { kind: 'append', pointer: 'hooks.PreToolUse', value: ENTRY, expectedValueDigest: null },
    ]);
    assert.equal(twice, once);
  });
});

describe('preconditions', () => {
  it('report drift when a `set` target holds something else', () => {
    const { document } = parsed('{ "a": 1 }');
    const result = mergeJsonEntries(document, [
      { kind: 'set', pointer: 'a', value: 2, expectedValueDigest: null },
    ]);
    assert.equal(result.state, 'drift');
  });

  it('accept a `set` whose target already holds exactly what we would write', () => {
    const { document } = parsed('{ "a": 1 }');
    const result = mergeJsonEntries(document, [
      { kind: 'set', pointer: 'a', value: 1, expectedValueDigest: null },
    ]);
    assert.equal(result.state, 'merged');
  });

  it('report drift when a `set` target the plan expected is gone', () => {
    const { document } = parsed('{}');
    const result = mergeJsonEntries(document, [
      { kind: 'set', pointer: 'a', value: 2, expectedValueDigest: jsonValueDigest(1) },
    ]);
    assert.equal(result.state, 'drift');
  });

  it('report drift when a `set` target changed since planning', () => {
    const { document } = parsed('{ "a": 99 }');
    const result = mergeJsonEntries(document, [
      { kind: 'set', pointer: 'a', value: 2, expectedValueDigest: jsonValueDigest(1) },
    ]);
    assert.equal(result.state, 'drift');
  });

  it('report drift when the owned array element is no longer there', () => {
    const { document } = parsed('{ "list": [{ "matcher": "Read" }] }');
    const result = mergeJsonEntries(document, [
      {
        kind: 'append',
        pointer: 'list',
        value: { matcher: 'Bash', v: 2 } as JsonValue,
        expectedValueDigest: jsonValueDigest({ matcher: 'Bash' } as JsonValue),
      },
    ]);
    assert.equal(result.state, 'drift');
  });

  it('accept an owned array element already updated to the new value', () => {
    const { document } = parsed('{ "list": [{ "matcher": "Bash", "v": 2 }] }');
    const result = mergeJsonEntries(document, [
      {
        kind: 'append',
        pointer: 'list',
        value: { matcher: 'Bash', v: 2 } as JsonValue,
        expectedValueDigest: jsonValueDigest({ matcher: 'Bash' } as JsonValue),
      },
    ]);
    assert.equal(result.state, 'merged');
  });

  it('refuse to replace a value the user put where an object has to go', () => {
    const { document } = parsed('{ "hooks": "a string the user wrote" }');
    const result = mergeJsonEntries(document, [
      { kind: 'set', pointer: 'hooks.PreToolUse', value: [], expectedValueDigest: null },
    ]);
    assert.equal(result.state, 'unmergeable');
  });

  it('refuse to append to something that is not an array', () => {
    const { document } = parsed('{ "list": 5 }');
    const result = mergeJsonEntries(document, [
      { kind: 'append', pointer: 'list', value: 1, expectedValueDigest: null },
    ]);
    assert.equal(result.state, 'unmergeable');
  });

  it('never mutate the document they were given', () => {
    const { document } = parsed('{ "a": 1 }');
    const before = canonicalJson(document);
    mergeJsonEntries(document, [
      { kind: 'set', pointer: 'b', value: 2, expectedValueDigest: null },
    ]);
    assert.equal(canonicalJson(document), before);
  });
});

describe('removing an owned entry', () => {
  it('deletes a `set` value and leaves the rest alone', () => {
    const { document } = parsed('{ "a": 1, "ours": { "x": 1 } }');
    const result = removeJsonEntry(document, {
      pointer: 'ours',
      placement: 'value',
      valueDigest: jsonValueDigest({ x: 1 } as JsonValue),
    });
    assert.equal(result.state, 'removed');
    if (result.state !== 'removed') return;
    assert.equal(canonicalJson(result.document), '{"a":1}');
  });

  it('removes one array element and keeps the order of the others', () => {
    const { document } = parsed('{ "list": ["a", "ours", "b"] }');
    const result = removeJsonEntry(document, {
      pointer: 'list',
      placement: 'array-element',
      valueDigest: jsonValueDigest('ours'),
    });
    assert.equal(result.state, 'removed');
    if (result.state !== 'removed') return;
    assert.equal(canonicalJson(result.document), '{"list":["a","b"]}');
  });

  it('refuses when the entry was edited', () => {
    const { document } = parsed('{ "ours": { "x": 2 } }');
    const result = removeJsonEntry(document, {
      pointer: 'ours',
      placement: 'value',
      valueDigest: jsonValueDigest({ x: 1 } as JsonValue),
    });
    // RFC 0004 §Ownership: an edited entry is not removed automatically.
    assert.equal(result.state, 'modified');
  });

  it('reports absence rather than failing, because uninstall is idempotent', () => {
    const { document } = parsed('{ "list": [] }');
    assert.equal(
      removeJsonEntry(document, {
        pointer: 'list',
        placement: 'array-element',
        valueDigest: jsonValueDigest('ours'),
      }).state,
      'absent',
    );
    assert.equal(
      removeJsonEntry(document, {
        pointer: 'gone',
        placement: 'value',
        valueDigest: jsonValueDigest('ours'),
      }).state,
      'absent',
    );
  });
});
