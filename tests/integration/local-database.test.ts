/**
 * `ChildLocalDatabase` — RFC 0005 §Importers, against a real database and a real child.
 *
 * This file exists for one assertion above all the others: that reading a provider's SQLite
 * database costs the user **nothing on stderr**. RFC 0001 and RFC 0005 rejected `node:sqlite`
 * because importing it emits `ExperimentalWarning`, and RFC 0006 permits nothing on stderr in
 * `--json` mode. The whole child-process arrangement is there to answer that objection, and
 * an arrangement whose central claim is untested is a claim, not a design.
 *
 * The database is built here with `node:sqlite` directly. Tests may: the architecture rule
 * restricting the driver applies to `src`, because what it protects is the shipped program's
 * streams. The schema is RTK 0.42.0's `commands` table, copied column for column.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';
import { ChildLocalDatabase, NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';

import { REPO_ROOT } from '../src/index.js';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

/** The same launcher the workspace runs, which is what the child re-enters. */
const LAUNCHER = join(REPO_ROOT, 'apps', 'cli', 'bin', 'token-harness.mjs');

let sandbox = '';
let databasePath = '';

const SCHEMA = `CREATE TABLE commands (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  original_cmd TEXT NOT NULL,
  rtk_cmd TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  saved_tokens INTEGER NOT NULL,
  savings_pct REAL NOT NULL,
  exec_time_ms INTEGER DEFAULT 0,
  project_path TEXT DEFAULT ''
)`;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-localdb-'));
  databasePath = join(sandbox, 'history.db');
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);
  const insert = db.prepare(
    'INSERT INTO commands (id, timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct, exec_time_ms, project_path) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  insert.run(
    2827,
    '2026-07-31T07:49:09.000000000+00:00',
    'git status',
    'rtk git status',
    88,
    17,
    71,
    80.68,
    25,
    '\\\\?\\C:\\Software\\TokenHarness',
  );
  insert.run(2829, '2026-07-31T07:49:10.162463300+00:00', 'ls', 'rtk ls', 40, 40, 0, 0, 25, '');
  db.close();
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function reader(): ChildLocalDatabase {
  const fs = new NodeFileSystem(FACTS);
  return new ChildLocalDatabase({
    runner: new NodeProcessRunner({
      facts: FACTS,
      env: process.env,
      // The subject here is the reader, not `PATH` handling, and the executable is already
      // an absolute path. Resolving it to itself keeps this test from depending on the
      // system probe, which no test is allowed to reach for.
      resolve: (name) => ({ requested: name, path: name, kind: 'native' }),
    }),
    nodeExecutable: process.execPath,
    entryScript: LAUNCHER,
    exists: async (path) => (await fs.stat(path)) !== null,
    databaseDirectory: sandbox,
  });
}

describe('reading a real database through a real child', () => {
  it('returns the rows', { timeout: 60_000 }, async () => {
    const result = await reader().query({
      path: databasePath,
      sql: 'SELECT id, timestamp, input_tokens, output_tokens, saved_tokens, exec_time_ms, project_path FROM commands WHERE id > ? ORDER BY id LIMIT ?',
      parameters: [0, 100],
    });

    assert.equal(result.failure, null);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.['id'], 2827);
    assert.equal(result.rows[0]?.['input_tokens'], 88);
    // The prefix RTK actually writes, surviving the JSON round trip through the child.
    assert.equal(result.rows[0]?.['project_path'], '\\\\?\\C:\\Software\\TokenHarness');
  });

  it('honours the parameters rather than returning everything', { timeout: 60_000 }, async () => {
    const result = await reader().query({
      path: databasePath,
      sql: 'SELECT id FROM commands WHERE id > ? ORDER BY id LIMIT ?',
      parameters: [2827, 100],
    });
    assert.deepEqual(
      result.rows.map((row) => row['id']),
      [2829],
    );
  });

  it('reads the aggregate the cursor generation is built from', { timeout: 60_000 }, async () => {
    const result = await reader().query({
      path: databasePath,
      sql: 'SELECT MIN(id) AS low, MAX(id) AS high, COUNT(*) AS total FROM commands',
      parameters: [],
    });
    assert.equal(result.rows[0]?.['low'], 2827);
    assert.equal(result.rows[0]?.['high'], 2829);
    assert.equal(result.rows[0]?.['total'], 2);
  });

  it('does not create the database it was asked to read', { timeout: 60_000 }, async () => {
    const missing = join(sandbox, 'absent.db');
    const result = await reader().query({ path: missing, sql: 'SELECT 1', parameters: [] });

    assert.equal(result.failure, 'not-found');
    // Opening read-write under WAL journaling would leave `-wal` and `-shm` beside a database
    // Token Harness does not own. Not spawning at all is what makes that impossible.
    const fs = new NodeFileSystem(FACTS);
    assert.equal(await fs.stat(missing), null);
  });

  it('reports a file that is not a database as unreadable', { timeout: 60_000 }, async () => {
    const bogus = join(sandbox, 'not-a-database.db');
    writeFileSync(bogus, 'this is not a database');
    const result = await reader().query({
      path: bogus,
      sql: 'SELECT 1 FROM commands',
      parameters: [],
    });
    assert.ok(
      result.failure === 'unreadable' || result.failure === 'query-failed',
      String(result.failure),
    );
    assert.equal(result.rows.length, 0);
  });

  it(
    'reports a statement the schema does not support as query-failed',
    { timeout: 60_000 },
    async () => {
      const result = await reader().query({
        path: databasePath,
        sql: 'SELECT nonexistent FROM commands',
        parameters: [],
      });
      // How an upstream schema change reaches us: as a failed read that is reported, never as
      // an empty result that would look like a source with nothing new in it.
      assert.equal(result.failure, 'query-failed');
    },
  );
});

/**
 * The assertion the design exists for.
 *
 * `--version` loads the whole program: `main.ts` imports the platform barrel, which imports
 * `sqlite-child.ts`. If that module's `node:sqlite` import were static — or if the bundler
 * hoisted it — the driver would load here, in the parent, where `--no-warnings` is not in
 * force, and `ExperimentalWarning` would land on the user's stderr.
 */
describe("the parent's streams", () => {
  async function runLauncher(
    args: readonly string[],
  ): Promise<{ code: number | null; stderr: string; stdout: string }> {
    const child = spawn(process.execPath, [LAUNCHER, ...args], { stdio: 'pipe' });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    const [code] = await once(child, 'exit');
    return { code: code as number | null, stderr, stdout };
  }

  it('carry no ExperimentalWarning when the program loads', { timeout: 60_000 }, async () => {
    const result = await runLauncher(['--version']);

    assert.equal(result.code, 0);
    // Zero bytes, not "no warning matching a pattern": RFC 0006 §Streams admits nothing here,
    // and a substring assertion would pass on a differently-worded future warning.
    assert.equal(result.stderr, '', `stderr should be empty, got: ${result.stderr}`);
  });

  it(
    'carry no ExperimentalWarning when the reader child itself runs',
    { timeout: 60_000 },
    async () => {
      // The child *does* load the driver. Its own stderr is where the warning would go, and
      // `--no-warnings` in `ChildLocalDatabase` is what keeps it empty. Run without that flag
      // and the warning appears — which is why the flag is not decoration.
      const request = JSON.stringify({
        path: databasePath,
        sql: 'SELECT id FROM commands ORDER BY id LIMIT 1',
        parameters: [],
      });
      const result = await runLauncher(['--internal-read-local-database', request]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /"id":2827/);
    },
  );

  it('emits one JSON document and no usage page in reader mode', { timeout: 60_000 }, async () => {
    const result = await runLauncher(['--internal-read-local-database', 'not json']);

    // A reader that printed a usage page would be indistinguishable from one that returned
    // no rows, so the internal mode bypasses argument parsing entirely.
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout) as { rows: unknown[]; failure: string | null };
    assert.deepEqual(parsed.rows, []);
    assert.equal(parsed.failure, 'query-failed');
  });
});
