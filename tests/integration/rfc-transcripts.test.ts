/**
 * The golden transcripts are transcriptions, and this proves it.
 *
 * RFC 0006 §Golden path: "The following transcripts are normative. Phase 1
 * commits them as golden files, and any change to them is a reviewed change to
 * the product surface."
 *
 * A committed copy of a normative document drifts unless something compares it.
 * This test re-extracts the five transcripts from `docs/rfcs/0006-cli-contract.md`
 * and asserts each `expected.txt` is byte-identical to its source, so editing
 * the RFC and forgetting the fixture — or the reverse — fails here rather than
 * turning into a silently forked contract.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { GOLDEN_ROOT, REPO_ROOT } from '../src/index.js';

/** In RFC document order. */
const SCENARIOS = [
  'doctor-installed-unwired',
  'plan-clean',
  'plan-brownfield-conflict',
  'verify-managed-and-adopted',
  'metrics-week',
];

const FENCE = '```';

interface Transcript {
  command: string;
  body: string;
}

function extractTranscripts(): Transcript[] {
  const path = join(REPO_ROOT, 'docs', 'rfcs', '0006-cli-contract.md');
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const found: Transcript[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `${FENCE}text`) continue;
    const block: string[] = [];
    let cursor = index + 1;
    for (; cursor < lines.length && lines[cursor] !== FENCE; cursor += 1) {
      block.push(lines[cursor] as string);
    }
    index = cursor;

    const first = block[0];
    if (first === undefined || !first.startsWith('$ token-harness')) continue;

    const body = block.slice(1);
    while (body.length > 0 && body[0] === '') body.shift();
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    found.push({ command: first.slice(2), body: `${body.join('\n')}\n` });
  }

  return found;
}

describe('RFC 0006 golden path', () => {
  const transcripts = extractTranscripts();

  it('has exactly five transcripts', () => {
    assert.equal(
      transcripts.length,
      SCENARIOS.length,
      'RFC 0006 §Golden path gained or lost a transcript; add or remove the matching fixture directory',
    );
  });

  for (const [index, name] of SCENARIOS.entries()) {
    it(`${name} is transcribed byte for byte`, () => {
      const transcript = transcripts[index];
      assert.ok(transcript, `no transcript at position ${index}`);
      const committed = readFileSync(`${GOLDEN_ROOT}${name}/expected.txt`, 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      assert.equal(committed, transcript.body);
    });
  }

  it('each fixture declares the command its transcript invokes', () => {
    for (const [index, name] of SCENARIOS.entries()) {
      const scenario = JSON.parse(readFileSync(`${GOLDEN_ROOT}${name}/scenario.json`, 'utf8')) as {
        command: string;
      };
      const invoked = transcripts[index]?.command ?? '';
      assert.ok(
        invoked.startsWith(`token-harness ${scenario.command}`),
        `${name} declares command ${scenario.command} but the transcript runs "${invoked}"`,
      );
    }
  });
});
