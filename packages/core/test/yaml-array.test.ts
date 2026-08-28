import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findYamlStringArrayEntry,
  mergeYamlStringArrayEntry,
  removeYamlStringArrayEntry,
} from '../src/index.js';

describe('managed YAML string-array entries', () => {
  it('adds one entry without reserializing unrelated YAML', () => {
    const original = [
      '# user comment',
      'theme: dark',
      'plugins:',
      '  enabled:',
      '    - security-guidance',
      '  path: ~/.hermes/plugins',
      'model: test',
      '',
    ].join('\n');

    const merged = mergeYamlStringArrayEntry({
      text: original,
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });

    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;
    assert.equal(
      merged.text,
      [
        '# user comment',
        'theme: dark',
        'plugins:',
        '  enabled:',
        '    - security-guidance',
        '    - harnesstrim',
        '  path: ~/.hermes/plugins',
        'model: test',
        '',
      ].join('\n'),
    );
    assert.equal(merged.changed, true);
  });

  it('preserves CRLF and a missing final newline', () => {
    const original = 'plugins:\r\n  enabled:\r\n    - other';
    const merged = mergeYamlStringArrayEntry({
      text: original,
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;
    assert.equal(merged.text, 'plugins:\r\n  enabled:\r\n    - other\r\n    - harnesstrim');
  });

  it('creates only the missing mapping tail', () => {
    const merged = mergeYamlStringArrayEntry({
      text: 'theme: dark\nplugins:\n  path: ~/.hermes/plugins\n',
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;
    assert.equal(
      merged.text,
      'theme: dark\nplugins:\n  path: ~/.hermes/plugins\n  enabled:\n    - harnesstrim\n',
    );
  });

  it('creates a new document without claiming unrelated structure', () => {
    const merged = mergeYamlStringArrayEntry({
      text: '',
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;
    assert.equal(merged.text, 'plugins:\n  enabled:\n    - harnesstrim');
  });

  it('is idempotent and returns the exact live line identity', () => {
    const original = 'plugins:\n  enabled:\n    - harnesstrim\n';
    const merged = mergeYamlStringArrayEntry({
      text: original,
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;
    assert.equal(merged.changed, false);
    assert.equal(merged.text, original);

    const found = findYamlStringArrayEntry({
      text: original,
      pointer: merged.entry.pointer,
      valueDigest: merged.entry.valueDigest,
    });
    assert.deepEqual(found, {
      state: 'found',
      valueDigest: merged.entry.valueDigest,
      lineDigest: merged.entry.lineDigest,
    });
  });

  it('removes only the exact line it owns', () => {
    const original =
      'plugins:\n  enabled:\n    - security-guidance\n    - harnesstrim\n  path: keep\n';
    const merged = mergeYamlStringArrayEntry({
      text: 'plugins:\n  enabled:\n    - security-guidance\n  path: keep\n',
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;

    const removal = removeYamlStringArrayEntry({
      text: original,
      pointer: merged.entry.pointer,
      valueDigest: merged.entry.valueDigest,
      lineDigest: merged.entry.lineDigest,
    });
    assert.deepEqual(removal, {
      state: 'removed',
      text: 'plugins:\n  enabled:\n    - security-guidance\n  path: keep\n',
    });
  });

  it('treats a comment added to the owned line as a modification', () => {
    const merged = mergeYamlStringArrayEntry({
      text: 'plugins:\n  enabled:\n',
      pointer: 'plugins.enabled',
      value: 'harnesstrim',
    });
    assert.equal(merged.state, 'merged');
    if (merged.state !== 'merged') return;

    const removal = removeYamlStringArrayEntry({
      text: 'plugins:\n  enabled:\n    - harnesstrim # user note\n',
      pointer: merged.entry.pointer,
      valueDigest: merged.entry.valueDigest,
      lineDigest: merged.entry.lineDigest,
    });
    assert.equal(removal.state, 'modified');
  });

  it('fails closed on flow style, tabs, duplicate keys and complex sequence children', () => {
    for (const text of [
      'plugins:\n  enabled: [harnesstrim]\n',
      'plugins:\n\tenabled:\n    - other\n',
      'plugins:\n  enabled:\n    - a\n  enabled:\n    - b\n',
      'plugins:\n  enabled:\n    name: harnesstrim\n',
    ]) {
      const merged = mergeYamlStringArrayEntry({
        text,
        pointer: 'plugins.enabled',
        value: 'harnesstrim',
      });
      assert.equal(merged.state, 'unmergeable', text);
    }
  });
});
