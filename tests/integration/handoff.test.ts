import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactHandoff } from '@token-harness/core';

const base = {
  objective: 'Finish the quota-aware optimizer without regressing Codex configuration safety.',
  decisions: [
    'Keep subscription quota distinct from local token measurements.',
    'Do not mutate selected Codex profiles.',
  ],
  changedFiles: ['packages/core/src/domain/optimizer.ts', 'apps/cli/src/commands/optimize.ts'],
  validation: ['unit tests pass', 'typecheck passes'],
  unresolved: ['empirical model-tier ranking still needs real benchmark receipts'],
  nextAction:
    'Implement the next reversible optimizer slice and run the existing integration suite.',
};

test('buildCompactHandoff renders all supplied state when it fits', () => {
  const result = buildCompactHandoff({ ...base, maxBytes: 4096 });
  assert.equal(result.truncated, false);
  assert.equal(result.omitted.decisions, 0);
  assert.match(result.markdown, /## Objective/);
  assert.match(result.markdown, /Do not mutate selected Codex profiles\./);
  assert.match(result.markdown, /packages\/core\/src\/domain\/optimizer\.ts/);
  assert.match(result.markdown, /## Next action/);
  assert.ok(result.bytes <= result.maxBytes);
});

test('buildCompactHandoff enforces the configured UTF-8 byte ceiling', () => {
  const noisy = Array.from({ length: 24 }, (_, index) =>
    `decision ${index}: preserve only explicit state and never copy the full transcript`,
  );
  const result = buildCompactHandoff({
    ...base,
    objective: `${base.objective} ${'context '.repeat(80)}`,
    decisions: noisy,
    unresolved: noisy,
    maxBytes: 640,
  });

  assert.equal(result.truncated, true);
  assert.ok(result.bytes <= 640, `expected <= 640 bytes, got ${result.bytes}`);
  assert.ok(result.omitted.decisions + result.omitted.unresolved > 0);
  assert.match(result.markdown, /more omitted|…/);
});

test('buildCompactHandoff deduplicates and normalizes optional entries', () => {
  const result = buildCompactHandoff({
    objective: '  ship   the handoff core ',
    decisions: ['keep quota honest', ' keep   quota honest ', '', 'stay local-first'],
    changedFiles: ['PLAN.md', 'PLAN.md'],
    nextAction: ' open   the PR ',
    maxBytes: 1024,
  });

  assert.equal((result.markdown.match(/keep quota honest/g) ?? []).length, 1);
  assert.equal((result.markdown.match(/PLAN\.md/g) ?? []).length, 1);
  assert.match(result.markdown, /ship the handoff core/);
  assert.match(result.markdown, /open the PR/);
});

test('buildCompactHandoff truncates Unicode without exceeding bytes', () => {
  const result = buildCompactHandoff({
    objective: `Preserve UTF-8 safely ${'🚀'.repeat(300)}`,
    nextAction: `Continue safely ${'é'.repeat(300)}`,
    maxBytes: 320,
  });

  assert.equal(result.truncated, true);
  assert.ok(result.bytes <= 320);
  assert.doesNotMatch(result.markdown, /�/);
});

test('buildCompactHandoff is deterministic', () => {
  const first = buildCompactHandoff({ ...base, maxBytes: 700 });
  const second = buildCompactHandoff({ ...base, maxBytes: 700 });
  assert.deepEqual(first, second);
});

test('buildCompactHandoff rejects unsafe budgets and empty mandatory fields', () => {
  assert.throws(() => buildCompactHandoff({ ...base, maxBytes: 255 }), /maxBytes/);
  assert.throws(
    () => buildCompactHandoff({ ...base, objective: '   ', maxBytes: 512 }),
    /objective/,
  );
  assert.throws(
    () => buildCompactHandoff({ ...base, nextAction: '\n\t', maxBytes: 512 }),
    /nextAction/,
  );
});
