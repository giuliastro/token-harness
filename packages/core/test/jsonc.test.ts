import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendJsoncRootArray,
  editJsonc,
  parseJsoncDocumentText,
  type JsonValue,
} from '../src/index.js';

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

/**
 * A realistic OpenCode configuration, in the shapes the property table below pins byte for byte.
 * The comments and the trailing commas are the point: they are part of the user's file.
 */
const OPENCODE_LF = `{
  "$schema": "https://opencode.ai/config.json",
  // The default model.
  "model": "gpt-4o",
  "plugin": [
    "@token-harness/opencode",
    // Installed by hand; keep.
    "third-party-plugin",
  ],
  "experimental": {
    "completions": {
      "fuzzyMatch": true,
    },
  },
}
`;

const OPENCODE_CRLF = `{\r\n  // CRLF file.\r\n  "plugin": [],\r\n  "experimental": {\r\n    "plugins": [\r\n      "old",\r\n    ],\r\n  },\r\n}\r\n`;

const OPENCODE_TABS = `{
\t"plugin": [
\t\t"a",
\t],
\t"theme": "dark",
}
`;

const OPENCODE_EMPTY_NESTED = `{
  "experimental": {},
  "plugin": [],
}
`;

const OPENCODE_COMPACT = `{"plugin":["a"],"experimental":{}}`;

/**
 * The byte-property acceptance for RFC 0009 §Initial delivery order item 2.
 *
 * Each row edits one region of a real shape and asserts, without consulting the editor's own
 * decisions, that every byte outside that region is unchanged: the edited text is the original
 * with exactly `replaced.with` written at exactly `replaced.from`, and the span itself is the
 * region the row says it is — a closing bracket for an append, the old value for an update, a
 * closing brace for an insert.
 */
describe('every byte outside the edited region is unchanged', () => {
  interface Row {
    name: string;
    original: string;
    edit: () => ReturnType<typeof editJsonc>;
    /** The document the edit must parse to. */
    expected: Record<string, JsonValue>;
    /** Comments that must survive verbatim. */
    survives: string[];
    /** A direct byte check on the replaced span. */
    spanCheck: (original: string, span: { from: number; to: number }) => void;
  }

  const rows: Row[] = [
    {
      name: 'append into a root array, LF, trailing comma present',
      original: OPENCODE_LF,
      edit: () => editJsonc(OPENCODE_LF, 'plugin', { kind: 'append-element', value: 'new-plugin' }),
      expected: {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4o',
        plugin: ['@token-harness/opencode', 'third-party-plugin', 'new-plugin'],
        experimental: { completions: { fuzzyMatch: true } },
      },
      survives: ['The default model.', 'Installed by hand; keep.'],
      spanCheck: (original, span) => {
        // The append happens at the array's own closing bracket, and only there.
        assert.equal(span.from, original.indexOf(']'));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'append into a nested array, CRLF',
      original: OPENCODE_CRLF,
      edit: () =>
        editJsonc(OPENCODE_CRLF, 'experimental.plugins', {
          kind: 'append-element',
          value: 'new',
        }),
      expected: { plugin: [], experimental: { plugins: ['old', 'new'] } },
      survives: ['CRLF file.'],
      spanCheck: (original, span) => {
        // The nested array's own closing bracket, not the empty root one.
        const key = original.indexOf('"plugins"');
        assert.equal(span.from, original.indexOf(']', key));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'append into a root array, tabs',
      original: OPENCODE_TABS,
      edit: () => editJsonc(OPENCODE_TABS, 'plugin', { kind: 'append-element', value: 'b' }),
      expected: { plugin: ['a', 'b'], theme: 'dark' },
      survives: [],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.indexOf(']'));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'append into an empty root array',
      original: OPENCODE_CRLF,
      edit: () => editJsonc(OPENCODE_CRLF, 'plugin', { kind: 'append-element', value: 'first' }),
      expected: { plugin: ['first'], experimental: { plugins: ['old'] } },
      survives: ['CRLF file.'],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.indexOf(']'));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'update a member value, keeping the key and its comments',
      original: OPENCODE_LF,
      edit: () =>
        editJsonc(OPENCODE_LF, 'experimental', {
          kind: 'set-member',
          member: 'completions',
          value: { fuzzyMatch: false, minCertainty: 0.5 },
        }),
      expected: {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4o',
        plugin: ['@token-harness/opencode', 'third-party-plugin'],
        experimental: { completions: { fuzzyMatch: false, minCertainty: 0.5 } },
      },
      survives: ['The default model.', 'Installed by hand; keep.'],
      spanCheck: (original, span) => {
        // The replaced span is exactly the old value — an object here — and nothing before or
        // after it.
        const old = parseJsoncDocumentText(original.slice(span.from, span.to));
        assert.equal(old.state, 'parsed');
        if (old.state === 'parsed') assert.deepEqual(old.document, { fuzzyMatch: true });
      },
    },
    {
      name: 'update a scalar member value',
      original: OPENCODE_TABS,
      edit: () =>
        editJsonc(OPENCODE_TABS, '', { kind: 'set-member', member: 'theme', value: 'light' }),
      expected: { plugin: ['a'], theme: 'light' },
      survives: [],
      spanCheck: (original, span) => {
        assert.equal(original.slice(span.from, span.to), '"dark"');
      },
    },
    {
      name: 'insert a member into a non-empty object, comma added because the last has none',
      original: OPENCODE_LF,
      edit: () =>
        editJsonc(OPENCODE_LF, '', { kind: 'set-member', member: 'provider', value: 'openai' }),
      expected: {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4o',
        plugin: ['@token-harness/opencode', 'third-party-plugin'],
        experimental: { completions: { fuzzyMatch: true } },
        provider: 'openai',
      },
      survives: ['The default model.', 'Installed by hand; keep.'],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.lastIndexOf('}'));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'insert a member into a non-empty object, comma already present',
      original: OPENCODE_CRLF,
      edit: () =>
        editJsonc(OPENCODE_CRLF, '', { kind: 'set-member', member: 'provider', value: 'openai' }),
      expected: { plugin: [], experimental: { plugins: ['old'] }, provider: 'openai' },
      survives: ['CRLF file.'],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.lastIndexOf('}'));
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'insert into an empty object member',
      original: OPENCODE_EMPTY_NESTED,
      edit: () =>
        editJsonc(OPENCODE_EMPTY_NESTED, 'experimental', {
          kind: 'set-member',
          member: 'fuzzyMatch',
          value: true,
        }),
      expected: { experimental: { fuzzyMatch: true }, plugin: [] },
      survives: [],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.indexOf('{}') + 1);
        assert.equal(span.to, span.from);
      },
    },
    {
      name: 'insert into a compact one-line object',
      original: OPENCODE_COMPACT,
      edit: () =>
        editJsonc(OPENCODE_COMPACT, 'experimental', {
          kind: 'set-member',
          member: 'fuzzyMatch',
          value: true,
        }),
      expected: { plugin: ['a'], experimental: { fuzzyMatch: true } },
      survives: [],
      spanCheck: (original, span) => {
        assert.equal(span.from, original.indexOf('{}') + 1);
        assert.equal(span.to, span.from);
      },
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const result = row.edit();
      assert.equal(result.state, 'edited', (result as { reason?: string }).reason);
      if (result.state !== 'edited') return;
      const { replaced } = result;

      // The one byte-level claim the acceptance makes: the output is the input with exactly the
      // reported span replaced. Anything the editor did outside that span is a failure here.
      assert.equal(
        result.text,
        row.original.slice(0, replaced.from) + replaced.with + row.original.slice(replaced.to),
      );

      row.spanCheck(row.original, replaced);

      for (const fragment of row.survives) {
        assert.ok(result.text.includes(fragment), `lost ${JSON.stringify(fragment)}`);
      }

      const parsed = parseJsoncDocumentText(result.text);
      assert.equal(parsed.state, 'parsed');
      if (parsed.state === 'parsed') assert.deepEqual(parsed.document, row.expected);
    });
  }
});

describe('edits it cannot locate exactly are refused, naming the expression', () => {
  it('refuses a member that does not exist on the append path', () => {
    const result = editJsonc(OPENCODE_LF, 'experimental.missing', {
      kind: 'append-element',
      value: 'x',
    });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /"experimental\.missing"/);
      assert.match(result.reason, /"missing" member does not exist/);
    }
  });

  it('refuses an append target that is not an array', () => {
    const result = editJsonc(OPENCODE_LF, 'model', { kind: 'append-element', value: 'x' });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /"model" value is not an array/);
    }
  });

  it('refuses a path through a value that is not an object', () => {
    const result = editJsonc(OPENCODE_LF, 'model.sub', { kind: 'append-element', value: 'x' });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /"model" value is not an object/);
    }
  });

  it('refuses to guess which of two duplicate members is meant', () => {
    const duplicate = `{
  "experimental": { "a": 1 },
  "experimental": { "b": 2 },
}
`;
    const result = editJsonc(duplicate, 'experimental.plugins', {
      kind: 'append-element',
      value: 'x',
    });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      // A planning error names the path and the expression it could not resolve.
      assert.match(result.reason, /"experimental\.plugins"/);
      assert.match(result.reason, /"experimental" member appears more than once/);
    }
  });

  it('refuses to insert a member when the container does not exist', () => {
    const result = editJsonc(OPENCODE_LF, 'missing.container', {
      kind: 'set-member',
      member: 'x',
      value: 1,
    });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /"missing\.container"/);
      assert.match(result.reason, /"missing" member does not exist/);
    }
  });

  it('refuses a document whose root is not an object', () => {
    const result = editJsonc('[1, 2]', 'plugin', { kind: 'append-element', value: 'x' });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /the JSONC root is not an object/);
    }
  });

  it('refuses an ambiguous update target inside a duplicate document', () => {
    const duplicate = `{
  "a": 1,
  "b": 2,
  "a": 3,
}
`;
    const result = editJsonc(duplicate, '', { kind: 'set-member', member: 'a', value: 9 });
    assert.equal(result.state, 'uneditable');
    if (result.state === 'uneditable') {
      assert.match(result.reason, /"a" member appears more than once/);
    }
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
