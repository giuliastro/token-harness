import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  FileJournalStore,
  TransactionSnapshotStore,
  executeTransaction,
  jsonValueDigest,
  type PlatformFacts,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { createGuideCall, GuideService } from '../src/guided.js';
import { createGuideOperationReader } from '../src/guided-operation-history.js';
import type { RunOptions } from '../src/run.js';
import { createGuideHandler } from '../src/guided-http.js';

const ROOT = mkdtempSync(join(tmpdir(), 'th-guided-history-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'fixture',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
let sequence = 0;
function fixture() {
  const root = join(ROOT, String(++sequence));
  const home = join(root, 'home'),
    stateRoot = join(root, 'state'),
    project = join(root, 'project');
  const config = join(home, '.claude', 'settings.json');
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const original = '{\r\n  "userSetting": "keep", "hooks": {"UserHook": []}\r\n}\r\n';
  writeFileSync(config, original);
  const fs = new NodeFileSystem(FACTS);
  const journals = new FileJournalStore({
    fs,
    journalRoot: join(stateRoot, 'journals'),
    backupRoot: join(stateRoot, 'backups'),
  });
  const runner: ProcessRunner = {
    async run() {
      throw new Error('Recovery must run no process');
    },
  };
  let time = Date.parse('2026-10-09T12:00:00.000Z'),
    tickets = 0;
  const base: Omit<RunOptions, 'argv' | 'streams'> = {
    platform: FACTS,
    cwd: project,
    home,
    stateRoot,
    now: () => new Date(time).toISOString(),
    adapters: {
      fs,
      runner,
      localDatabase: null,
      projectIdFor: () => 'p_history',
      paths: { home, config: join(home, '.config'), state: stateRoot, data: home, cache: home },
    },
  };
  const read = createGuideOperationReader({ fs, stateRoot, projectRoot: project });
  const reopen = () =>
    new GuideService(
      createGuideCall(base),
      () => time,
      () => 'ticket-' + ++tickets,
      null,
      null,
      null,
      read,
    );
  const commit = async (id: string) => {
    time += 1000;
    const snapshots = TransactionSnapshotStore.create({
      fs,
      backupRoot: join(stateRoot, 'backups'),
      transactionId: id,
      projectRoot: project,
      now: base.now!,
    });
    assert.ok(snapshots.ok);
    const current = JSON.parse(readFileSync(config, 'utf8')) as { fixtureSetting?: string };
    const result = await executeTransaction({
      transactionId: id,
      planId: null,
      projectId: 'p_history',
      projectRoot: project,
      fs,
      snapshots: snapshots.store,
      journal: journals,
      runner,
      now: base.now!,
      actions: [
        {
          id: 'fixture-setting',
          kind: 'merge-json',
          riskClass: 'reversible',
          requiresNetwork: false,
          requiresElevation: false,
          affectedPaths: [config],
          affectedProcesses: [],
          preconditions: [],
          postconditions: [],
          rollbackData: 'file-snapshot',
          explanation: 'Update fixture',
          path: config,
          createIfMissing: false,
          ownedPointers: ['fixtureSetting'],
          operations: [
            {
              kind: 'set',
              pointer: 'fixtureSetting',
              value: id,
              expectedValueDigest:
                current.fixtureSetting === undefined
                  ? null
                  : jsonValueDigest(current.fixtureSetting),
            },
          ],
        },
      ],
    });
    assert.equal(result.exitCode, 0);
    return result.journal;
  };
  return {
    read,
    reopen,
    commit,
    journals,
    config,
    original,
    project,
    stateRoot,
    fs,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('retained guided operation history', () => {
  it('keeps history and recovery behind the guided Host/Origin/CSRF boundary', async (t) => {
    const f = fixture();
    await f.commit('http-target');
    const changed = readFileSync(f.config);
    let authority = '';
    const server = createServer(
      createGuideHandler({
        service: f.reopen(),
        token: 'history-csrf',
        authority: () => authority,
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    authority = '127.0.0.1:' + address.port;
    const origin = 'http://' + authority;
    const read = await fetch(origin + '/api/operations');
    assert.equal(read.status, 200);
    assert.equal(
      ((await read.json()) as { operations: Array<{ canRestore: boolean }> }).operations[0]
        ?.canRestore,
      true,
    );
    assert.equal((await fetch(origin + '/api/operations?transaction=http-target')).status, 400);
    assert.equal(
      (await fetch(origin + '/api/operations', { headers: { Origin: 'https://foreign.example' } }))
        .status,
      403,
    );
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/operations',
          headers: { Host: 'foreign.example' },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        },
      );
      request.once('error', reject);
      request.end();
    });
    assert.equal(foreignHost, 403);
    const payload = {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore-latest' }),
    };
    assert.equal((await fetch(origin + '/api/preview', payload)).status, 403);
    const preview = await fetch(origin + '/api/preview', {
      ...payload,
      headers: { ...payload.headers, 'X-Token-Harness-CSRF': 'history-csrf' },
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(readFileSync(f.config), changed);
    assert.ok(!(await preview.text()).includes('http-target'));
  });
  it('restores byte-for-byte after reopening through preview, single-use approval and the real rollback engine', async () => {
    const f = fixture();
    await f.commit('previous-session');
    const service = f.reopen();
    assert.equal(service.status().canUndo, false, 'session undo remains a separate shortcut');
    const history = await service.operations();
    assert.equal(history.operations[0]?.canRestore, true);
    assert.equal(history.operations[0]?.files, 1);
    assert.ok(!JSON.stringify(history).includes(f.config));
    assert.ok(!JSON.stringify(history).includes('previous-session'));
    const changed = readFileSync(f.config);
    const preview = await service.preview({ action: 'restore-latest' });
    assert.match(preview.changes[0]!.description, /manual edits/);
    assert.equal(preview.changes[0]!.files, 1);
    assert.equal(preview.network, false);
    assert.deepEqual(readFileSync(f.config), changed, 'preview writes no configuration');
    assert.ok(!JSON.stringify(preview).includes(f.config));
    assert.ok(!JSON.stringify(preview).includes('previous-session'));
    const result = await service.apply({ ticket: preview.ticket });
    assert.equal(result.ok, true);
    assert.equal(readFileSync(f.config, 'utf8'), f.original);
    await assert.rejects(service.apply({ ticket: preview.ticket }), /expired|review|approval/i);
    const reopened = await f.reopen().operations();
    assert.equal(reopened.operations[0]?.outcome, 'rolled-back');
    assert.equal(reopened.operations[0]?.canRestore, false);
  });

  it('refuses stale and expired approvals without overwriting a later configuration', async () => {
    const f = fixture();
    await f.commit('old');
    const service = f.reopen();
    const preview = await service.preview({ action: 'restore-latest' });
    await f.commit('new');
    const latest = readFileSync(f.config);
    await assert.rejects(service.apply({ ticket: preview.ticket }), /history changed/i);
    assert.deepEqual(readFileSync(f.config), latest);
    const fresh = await service.preview({ action: 'restore-latest' });
    f.advance(10 * 60_000 + 1);
    await assert.rejects(service.apply({ ticket: fresh.ticket }), /expired/i);
    assert.deepEqual(readFileSync(f.config), latest);
  });

  it('offers only the machine history tip and does not cross project boundaries', async () => {
    const f = fixture();
    await f.commit('older');
    const latest = await f.commit('other-project');
    await f.journals.write({ ...latest, projectRoot: join(f.project, 'different') });
    const history = await f.reopen().operations();
    assert.equal(history.operations.length, 1);
    assert.equal(history.operations[0]?.canRestore, false);
    assert.equal((await f.read()).target, null);
    await assert.rejects(f.reopen().preview({ action: 'restore-latest' }), /latest committed/i);
  });

  it('rejects browser-supplied transaction, agent, provider, task and path selectors', async () => {
    const f = fixture();
    await f.commit('target');
    for (const extra of [
      { transactionId: 'target' },
      { path: f.config },
      { harness: 'claude' },
      { provider: 'rtk' },
      { task: 'standard' },
    ]) {
      await assert.rejects(
        f.reopen().preview({ action: 'restore-latest', ...extra }),
        /selection|supported agent and action/i,
      );
    }
  });

  it('blocks recovery for unfinished journals, package operations and missing state', async () => {
    const f = fixture();
    const journal = await f.commit('configuration');
    for (const outcome of ['dirty', 'in-progress'] as const) {
      await f.journals.write({
        ...journal,
        transactionId: 'pending',
        startedAt: '2026-10-09T12:01:00.000Z',
        outcome,
      });
      const observation = await f.read();
      assert.equal(observation.target, null);
      assert.match(observation.history.note, /unfinished/i);
    }
    await f.fs.remove(join(f.stateRoot, 'journals', 'pending.json'));
    await f.journals.write({
      ...journal,
      entries: [{ ...journal.entries[0]!, kind: 'package-manager-install' }],
    });
    assert.equal((await f.read()).target, null);
    writeFileSync(
      join(f.stateRoot, 'journals', 'configuration.json'),
      JSON.stringify({ ...journal, entries: [{ ...journal.entries[0]!, kind: 'toString' }] }),
    );
    const unknown = await f.read();
    assert.equal(unknown.target, null);
    assert.deepEqual(unknown.history.operations[0]?.actions, ['Managed operation']);
    const missing = createGuideOperationReader({
      fs: null,
      stateRoot: null,
      projectRoot: f.project,
    });
    assert.equal((await missing()).history.state, 'unavailable');
  });

  it('does not expose an older recovery target when a future or corrupt journal exists', async () => {
    const f = fixture();
    await f.commit('older');
    const path = join(f.stateRoot, 'journals', 'future.json');
    for (const text of [
      '{"schemaVersion":2}',
      '{broken',
      '{"schemaVersion":1,"transactionId":"future"}',
    ]) {
      writeFileSync(path, text);
      const observed = await f.read();
      assert.equal(observed.history.state, 'unavailable');
      assert.equal(observed.target, null);
    }
  });

  it('retains a bounded history and blocks recovery while a prepared benchmark holds its lease', async () => {
    const f = fixture();
    const journal = await f.commit('first');
    for (let index = 0; index < 24; index++) {
      await f.journals.write({
        ...journal,
        transactionId: 'record-' + index,
        startedAt: new Date(Date.parse(journal.startedAt) + 1000 * (index + 1)).toISOString(),
      });
    }
    assert.equal((await f.read()).history.operations.length, 20);
    writeFileSync(
      join(f.stateRoot, 'mutation-lease.json'),
      JSON.stringify({
        schemaVersion: 1,
        transactionId: 'factorial-' + 'a'.repeat(24),
        benchmarkId: 'fixture',
        variant: 'combined',
        projectId: 'p_history',
        acquiredAt: journal.startedAt,
      }),
    );
    const observed = await f.read();
    assert.equal(observed.target, null);
    assert.match(observed.history.note, /benchmark.*temporary/i);
  });
});
