/**
 * The golden-file normalizer — RFC 0006 §Golden-file determinism.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeGolden } from '../src/index.js';

const OPTIONS = {
  toolVersion: '0.1.0',
  home: 'C:\\Users\\dev',
  stateRoot: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
  projectRoot: 'C:\\work\\demo',
};

describe('golden normalizer', () => {
  it('folds the Token Harness version but not provider versions', () => {
    const input = 'Token Harness 0.1.0 — rtk 1.4.2 — harnesstrim 0.0.5';
    assert.equal(
      normalizeGolden(input, OPTIONS),
      'Token Harness <version> — rtk 1.4.2 — harnesstrim 0.0.5',
    );
  });

  it('leaves a provider version alone even when it equals the tool version', () => {
    const input = 'Token Harness 0.1.0 — rtk 0.1.0';
    assert.equal(normalizeGolden(input, OPTIONS), 'Token Harness <version> — rtk 0.1.0');
  });

  it('reduces the tilde form and the absolute form to the same token', () => {
    assert.equal(
      normalizeGolden('~/.claude/settings.json', OPTIONS),
      normalizeGolden('C:\\Users\\dev\\.claude\\settings.json', OPTIONS),
    );
    assert.equal(
      normalizeGolden('~/.claude/settings.json', OPTIONS),
      '<home>/.claude/settings.json',
    );
  });

  it('prefers the most specific root, so a nested state directory is <state>', () => {
    assert.equal(
      normalizeGolden('~/AppData/Local/TokenHarness/receipts/7f3a91c2.json', OPTIONS),
      '<state>/receipts/<id:1>.json',
    );
  });

  it('treats the literal tokens in the RFC transcripts as fixed points', () => {
    assert.equal(
      normalizeGolden('<state>/receipts/7f3a91c2.json', OPTIONS),
      '<state>/receipts/<id:1>.json',
    );
    assert.equal(normalizeGolden('project <project>', OPTIONS), 'project <project>');
  });

  it('assigns stable ordinals in first-appearance order', () => {
    assert.equal(
      normalizeGolden('plan 7f3a91c2, pipeline b41e, plan 7f3a91c2', OPTIONS),
      'plan <id:1>, pipeline <id:2>, plan <id:1>',
    );
  });

  it('does not mistake hex-looking English or grouped numbers for an id', () => {
    const input = 'Added median latency. Coverage 91%. Saved 1,204,880 and 873,478. decade';
    const output = normalizeGolden(input, OPTIONS);
    assert.match(output, /1,204,880/);
    assert.match(output, /873,478/);
    assert.match(output, /decade/);
    assert.doesNotMatch(output, /<id:/);
  });

  it('normalizes timestamps before dates, so a year is never read as an id', () => {
    assert.equal(
      normalizeGolden('applied 2026-07-29T10:12:04Z over 2026-07-22 to 2026-07-29', OPTIONS),
      'applied <timestamp> over <date> to <date>',
    );
  });

  it('normalizes durations', () => {
    assert.equal(
      normalizeGolden('latency 11ms and 2.5s', OPTIONS),
      'latency <duration> and <duration>',
    );
  });

  it('folds line endings', () => {
    assert.equal(normalizeGolden('a\r\nb\rc\n', OPTIONS), 'a\nb\nc\n');
  });

  it('is idempotent', () => {
    const input =
      'Token Harness 0.1.0 — plan 7f3a91c2 — 2026-07-29T10:12:04Z — ~/.claude/settings.json — 11ms';
    const once = normalizeGolden(input, OPTIONS);
    assert.equal(normalizeGolden(once, OPTIONS), once);
  });

  it('handles JSON-escaped Windows roots, because the JSON goldens are text', () => {
    const input = '{ "path": "C:\\\\Users\\\\dev\\\\.claude\\\\settings.json" }';
    assert.equal(normalizeGolden(input, OPTIONS), '{ "path": "<home>/.claude/settings.json" }');
  });
});
