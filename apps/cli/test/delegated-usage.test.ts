import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { observeDelegatedUsage } from '../src/delegated-usage.js';

const usage = {
  input_tokens: 1,
  cache_creation_input_tokens: 2,
  cache_read_input_tokens: 3,
  output_tokens: 4,
};

describe('observeDelegatedUsage', () => {
  it('composes both readers over the real filesystem', async () => {
    const home = mkdtempSync(join(tmpdir(), 'th-delegated-'));
    const outside = mkdtempSync(join(tmpdir(), 'th-outside-'));
    try {
      const dir = join(home, '.claude', 'projects', 'p', 'subagents');
      mkdirSync(dir, { recursive: true });
      const now = new Date();
      const line = JSON.stringify({
        timestamp: now.toISOString(),
        message: { id: 'm', model: 'haiku', usage },
      });
      writeFileSync(join(dir, 'a.jsonl'), `${line}\n`);
      writeFileSync(join(outside, 'x.jsonl'), `${line}\n`);
      try {
        symlinkSync(outside, join(home, '.claude', 'projects', 'link'), 'junction');
      } catch {
        // Symlinks may be unavailable; the main assertions still hold.
      }
      const report = await observeDelegatedUsage({ home, env: {}, now });
      assert.equal(report.days, 30);
      assert.deepEqual(
        report.harnesses.map((h) => [h.harnessId, h.state]),
        [
          ['claude', 'observed'],
          ['codex', 'no-data'],
        ],
      );
      assert.equal(report.harnesses[0]?.delegated.total, 10);
      assert.equal(report.harnesses[0]?.root.total, 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
