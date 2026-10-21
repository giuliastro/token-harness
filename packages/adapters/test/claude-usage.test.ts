import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { readClaudeUsage } from '../src/index.js';
import { DAY, NOW, tempHome, testUsageLog, writeJsonl } from './usage-fixture.js';

const homes: string[] = [];
function home(): string {
  const path = tempHome();
  homes.push(path);
  return path;
}
afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

const RECENT = '2026-06-29T10:00:00.000Z';
function record(id: string, model: string, extra: object = {}, timestamp = RECENT): object {
  return {
    timestamp,
    requestId: `req-${id}`,
    message: {
      id: `msg-${id}`,
      model,
      content: 'SECRET TEXT',
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 40,
      },
    },
    ...extra,
  };
}
function read(h: string, days?: number) {
  return readClaudeUsage({ home: h, env: {}, now: NOW, days, fs: testUsageLog });
}

describe('readClaudeUsage', () => {
  it('reports no-data when the projects directory is missing', async () => {
    const result = await read(home());
    assert.equal(result.state, 'no-data');
    assert.equal(result.files, 0);
    assert.equal(result.errors, 0);
  });

  it('splits root from delegated by subagents path and isSidechain', async () => {
    const h = home();
    const projects = join(h, '.claude', 'projects', 'proj');
    writeJsonl(join(projects, 's1.jsonl'), [
      record('a', 'opus'),
      record('b', 'haiku', { isSidechain: true }),
    ]);
    writeJsonl(join(projects, 's1', 'subagents', 'agent-1.jsonl'), [record('c', 'haiku')]);
    const result = await read(h);
    assert.equal(result.state, 'observed');
    assert.equal(result.files, 2);
    assert.deepEqual(result.root.byModel, [
      { model: 'opus', input: 10, cacheWrite: 20, cacheRead: 30, output: 40, total: 100 },
    ]);
    assert.equal(result.root.total, 100);
    assert.deepEqual(result.delegated.byModel, [
      { model: 'haiku', input: 20, cacheWrite: 40, cacheRead: 60, output: 80, total: 200 },
    ]);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  });

  it('deduplicates streamed records and skips synthetic models', async () => {
    const h = home();
    writeJsonl(join(h, '.claude', 'projects', 'p', 's.jsonl'), [
      record('a', 'opus'),
      record('a', 'opus'),
      record('s', '<synthetic>'),
      { type: 'user', message: { content: 'no usage' } },
    ]);
    const result = await read(h);
    assert.equal(result.root.total, 100);
    assert.equal(result.root.byModel.length, 1);
  });

  it('filters by record timestamp and by file mtime', async () => {
    const h = home();
    const projects = join(h, '.claude', 'projects', 'p');
    writeJsonl(join(projects, 'fresh.jsonl'), [
      record('old', 'opus', {}, '2026-04-01T00:00:00.000Z'),
      record('new', 'opus'),
    ]);
    writeJsonl(
      join(projects, 'stale.jsonl'),
      [record('stale', 'opus')],
      new Date(NOW.getTime() - 40 * DAY),
    );
    const result = await read(h, 30);
    assert.equal(result.files, 1);
    assert.equal(result.root.total, 100);
  });

  it('counts malformed lines as errors without throwing', async () => {
    const h = home();
    writeJsonl(join(h, '.claude', 'projects', 'p', 's.jsonl'), [
      '{not json',
      record('a', 'opus'),
      '[1,2]',
    ]);
    const result = await read(h);
    assert.equal(result.errors, 2);
    assert.equal(result.root.total, 100);
  });

  it('reports no-data when files exist but hold no usage', async () => {
    const h = home();
    writeJsonl(join(h, '.claude', 'projects', 'p', 's.jsonl'), [{ type: 'user' }]);
    const result = await read(h);
    assert.equal(result.state, 'no-data');
    assert.equal(result.files, 1);
  });

  it('reports unavailable when listing fails', async () => {
    const result = await readClaudeUsage({
      home: '/x',
      env: {},
      now: NOW,
      fs: {
        ...testUsageLog,
        listJsonl: async () => {
          throw new Error('denied');
        },
      },
    });
    assert.equal(result.state, 'unavailable');
  });
});
