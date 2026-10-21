import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { readCodexUsage } from '../src/index.js';
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
const meta = (payload: object): object => ({ type: 'session_meta', timestamp: RECENT, payload });
const turn = (model: string): object => ({
  type: 'turn_context',
  timestamp: RECENT,
  payload: { model, cwd: '/secret/path' },
});
const tokens = (last: object | null, timestamp = RECENT): object => ({
  type: 'event_msg',
  timestamp,
  payload: { type: 'token_count', info: last === null ? null : { last_token_usage: last } },
});
const USAGE = { input_tokens: 100, cached_input_tokens: 30, output_tokens: 5 };

function read(h: string, env: Record<string, string> = {}, days?: number) {
  return readCodexUsage({ home: h, env, now: NOW, days, fs: testUsageLog });
}

describe('readCodexUsage', () => {
  it('reports no-data when the sessions directory is missing', async () => {
    const result = await read(home());
    assert.equal(result.state, 'no-data');
    assert.equal(result.files, 0);
  });

  it('splits input and cached input, and root from delegated', async () => {
    const h = home();
    const sessions = join(h, '.codex', 'sessions', '2026', '06', '29');
    writeJsonl(join(sessions, 'root.jsonl'), [meta({ id: 'a' }), turn('gpt-5'), tokens(USAGE)]);
    writeJsonl(join(sessions, 'parent.jsonl'), [
      meta({ parent_thread_id: 'a' }),
      turn('gpt-mini'),
      tokens(USAGE),
    ]);
    writeJsonl(join(sessions, 'source.jsonl'), [
      meta({ source: { subagent: { thread_spawn: {} } } }),
      turn('gpt-mini'),
      tokens({ ...USAGE, cache_write_input_tokens: 7 }),
    ]);
    const result = await read(h);
    assert.equal(result.state, 'observed');
    assert.equal(result.files, 3);
    assert.deepEqual(result.root.byModel, [
      { model: 'gpt-5', input: 70, cacheWrite: 0, cacheRead: 30, output: 5, total: 105 },
    ]);
    assert.deepEqual(result.delegated.byModel, [
      { model: 'gpt-mini', input: 140, cacheWrite: 7, cacheRead: 60, output: 10, total: 217 },
    ]);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });

  it('attributes usage to the latest turn_context model across a mid-file switch', async () => {
    const h = home();
    writeJsonl(join(h, '.codex', 'sessions', 's.jsonl'), [
      meta({}),
      turn('gpt-5'),
      tokens(USAGE),
      tokens(null),
      turn('gpt-mini'),
      tokens(USAGE),
      tokens(USAGE),
    ]);
    const result = await read(h);
    const byModel = Object.fromEntries(result.root.byModel.map((row) => [row.model, row.total]));
    assert.deepEqual(byModel, { 'gpt-5': 105, 'gpt-mini': 210 });
    assert.equal(result.root.byModel[0]?.model, 'gpt-mini');
  });

  it('filters by record timestamp and by file mtime', async () => {
    const h = home();
    const sessions = join(h, '.codex', 'sessions');
    writeJsonl(join(sessions, 'fresh.jsonl'), [
      meta({}),
      turn('gpt-5'),
      tokens(USAGE, '2026-04-01T00:00:00.000Z'),
      tokens(USAGE),
    ]);
    writeJsonl(
      join(sessions, 'stale.jsonl'),
      [meta({}), turn('gpt-5'), tokens(USAGE)],
      new Date(NOW.getTime() - 40 * DAY),
    );
    const result = await read(h);
    assert.equal(result.files, 1);
    assert.equal(result.root.total, 105);
  });

  it('counts malformed lines as errors without throwing', async () => {
    const h = home();
    writeJsonl(join(h, '.codex', 'sessions', 's.jsonl'), [
      meta({}),
      '{broken',
      turn('m'),
      tokens(USAGE),
    ]);
    const result = await read(h);
    assert.equal(result.errors, 1);
    assert.equal(result.root.total, 105);
  });

  it('honours CODEX_HOME over the home directory', async () => {
    const h = home();
    const elsewhere = home();
    writeJsonl(join(h, '.codex', 'sessions', 'ignored.jsonl'), [
      meta({}),
      turn('a'),
      tokens(USAGE),
    ]);
    writeJsonl(join(elsewhere, 'sessions', 'used.jsonl'), [meta({}), turn('b'), tokens(USAGE)]);
    const result = await read(h, { CODEX_HOME: elsewhere });
    assert.deepEqual(
      result.root.byModel.map((row) => row.model),
      ['b'],
    );
  });
});
