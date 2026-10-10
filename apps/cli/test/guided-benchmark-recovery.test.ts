/** Real preparation/restoration against temporary homes, without real processes or installs. */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  digestText,
  fileFingerprint,
  type PlatformFacts,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { createGuideCall, GuideService } from '../src/guided.js';
import { createGuideBenchmarkRecoveryReader } from '../src/guided-benchmark-recovery.js';
import { createGuideHandler } from '../src/guided-http.js';
import type { RunOptions } from '../src/run.js';
import type { BenchmarkPrepareReport } from '../src/commands/benchmark-prepare.js';

const ROOT = mkdtempSync(join(tmpdir(), 'th-guided-recovery-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'fixture',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
let sequence = 0;
function fixture(empty = false) {
  const root = join(ROOT, String(++sequence)),
    home = join(root, 'home'),
    project = join(root, 'project'),
    stateRoot = join(root, 'state');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  const config = join(home, '.codex', 'hooks.json');
  const original =
    '{\r\n  "userSetting": "keep", "hooks": {"PreToolUse": [{"matcher":"Read","hooks":[{"type":"command","command":"user-hook"}]}]}\r\n}\r\n';
  if (!empty) {
    mkdirSync(join(home, '.codex'));
    writeFileSync(config, original);
  }
  const fs = new NodeFileSystem(facts),
    requests: ProcessRequest[] = [];
  const runner: ProcessRunner = {
    async run(request) {
      requests.push(request);
      const text =
        request.executable === 'rtk' && request.args[0] === '--version'
          ? 'rtk 0.51.0'
          : request.executable === 'codex' && request.args[0] === '--version'
            ? 'codex-cli 0.160.0'
            : request.executable === 'token-harness' && request.args.at(-1) === '--check'
              ? request.args[0] === '__internal-rtk-hook'
                ? 'token-harness-rtk-hook-proxy-v1'
                : 'token-harness-prompt-router-v1'
              : null;
      return {
        displayCommand: request.executable,
        executablePath: text === null ? null : join(root, 'bin', request.executable),
        interpreter: 'direct',
        exitCode: text === null ? null : 0,
        signal: null,
        stdout: text ?? '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure:
          text === null ? { reason: 'executable-not-found', message: 'fixture unavailable' } : null,
      };
    },
  };
  let clock = Date.parse('2026-10-10T10:00:00Z'),
    tickets = 0;
  const base: Omit<RunOptions, 'argv' | 'streams'> = {
    platform: facts,
    cwd: project,
    home,
    stateRoot,
    now: () => new Date(clock).toISOString(),
    adapters: {
      fs,
      runner,
      localDatabase: null,
      projectIdFor: () => 'p_recovery',
      paths: { home, state: stateRoot, config: home, data: home, cache: home },
    },
  };
  const call = createGuideCall(base);
  const reader = (projectId = 'p_recovery') =>
    createGuideBenchmarkRecoveryReader({ fs, stateRoot, home, projectRoot: project, projectId });
  const reopen = (projectId = 'p_recovery') =>
    new GuideService(
      call,
      () => clock,
      () => 'ticket-' + ++tickets,
      null,
      null,
      null,
      null,
      null,
      reader(projectId),
    );
  const prepare = async () => {
    const result = await call<BenchmarkPrepareReport>([
      'benchmark-prepare',
      '--benchmark-id',
      'recovery',
      '--variant',
      'combined',
      '--starting-state',
      'fixture-tree',
      '--harness',
      'codex',
      '--task',
      'standard',
      '--check-command',
      '["fixture-check"]',
      '--yes',
    ]);
    assert.equal(result.exitCode, 0, JSON.stringify(result.diagnostics));
    assert.equal(result.data?.verificationTier, 'config-only');
  };
  const checkpoint = join(stateRoot, 'benchmarks', 'recovery', 'combined.session.json'),
    capture = join(stateRoot, 'benchmarks', 'recovery', 'combined.capture.json'),
    receipt = join(stateRoot, 'benchmarks', 'recovery', 'combined.json'),
    lease = join(stateRoot, 'mutation-lease.json');
  const editCheckpoint = (edit: (data: Record<string, unknown>) => void) => {
    const raw = JSON.parse(readFileSync(checkpoint, 'utf8')) as Record<string, unknown>;
    delete raw['checkpointDigest'];
    edit(raw);
    writeFileSync(
      checkpoint,
      JSON.stringify({ ...raw, checkpointDigest: digestText(JSON.stringify(raw)) }),
    );
  };
  return {
    fs,
    root,
    config,
    original,
    home,
    stateRoot,
    call,
    reader,
    reopen,
    prepare,
    requests,
    checkpoint,
    capture,
    receipt,
    lease,
    editCheckpoint,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      result[child] = entry.isDirectory() ? 'directory' : readFileSync(child).toString('base64');
      if (entry.isDirectory()) visit(child);
    }
  }
  visit(root);
  return result;
}

describe('guided prepared benchmark recovery', () => {
  it('reopens, previews without any writes, restores exact bytes/modes and retains capture evidence without checks', async () => {
    const f = fixture(),
      before = await fileFingerprint(f.fs, f.config);
    assert.equal((await f.reopen().benchmarkRecovery()).state, 'none');
    await f.prepare();
    const service = f.reopen(),
      saved = tree(f.root),
      calls = f.requests.length;
    const report = await service.benchmarkRecovery();
    assert.equal(report.state, 'pending');
    assert.equal(report.benchmarkId, 'recovery');
    assert.ok(!JSON.stringify(report).includes(f.home));
    assert.ok(!JSON.stringify(report).includes('user-hook'));
    const preview = await service.preview({ action: 'benchmark-recover' });
    assert.deepEqual(
      tree(f.root),
      saved,
      'preview and cancel write nothing, including retained state',
    );
    assert.equal(preview.network, false);
    assert.ok(!JSON.stringify(preview).includes(f.home));
    const capture = readFileSync(f.capture);
    const result = await service.apply({ ticket: preview.ticket });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readFileSync(f.config, 'utf8'), f.original);
    assert.deepEqual(
      await fileFingerprint(f.fs, f.config),
      before,
      'mode is a restored platform property',
    );
    assert.deepEqual(readFileSync(f.capture), capture);
    assert.equal(existsSync(f.receipt), false);
    assert.equal(existsSync(f.lease), false);
    assert.equal(f.requests.length, calls, 'no process runs during recovery');
    assert.equal((await f.reopen().benchmarkRecovery()).state, 'none');
    await assert.rejects(service.apply({ ticket: preview.ticket }), /expired|already used/);
  });

  it('restores original absence and empty parent directories, while keeping user-added files', async () => {
    const f = fixture(true);
    await f.prepare();
    const s = f.reopen(),
      preview = await s.preview({ action: 'benchmark-recover' });
    assert.equal((await s.apply({ ticket: preview.ticket })).ok, true);
    assert.equal(existsSync(join(f.home, '.codex')), false);
    const edited = fixture(true);
    await edited.prepare();
    const userFile = join(edited.home, '.codex', 'user-file');
    writeFileSync(userFile, 'keep');
    await assert.rejects(
      edited.reopen().preview({ action: 'benchmark-recover' }),
      /could not be planned safely/,
    );
    assert.equal(readFileSync(userFile, 'utf8'), 'keep');
    assert.equal(existsSync(edited.lease), true);
  });

  it('preserves manual edits made before or after preview and burns a refused approval', async () => {
    const f = fixture();
    await f.prepare();
    const service = f.reopen(),
      preview = await service.preview({ action: 'benchmark-recover' });
    const manual = readFileSync(f.config, 'utf8') + '\nmanual edit\n';
    writeFileSync(f.config, manual);
    assert.equal((await service.apply({ ticket: preview.ticket })).ok, false);
    assert.equal(readFileSync(f.config, 'utf8'), manual);
    assert.equal(existsSync(f.lease), true);
    await assert.rejects(service.apply({ ticket: preview.ticket }), /expired|already used/);
    await assert.rejects(
      f.reopen().preview({ action: 'benchmark-recover' }),
      /could not be planned safely/,
    );
    assert.equal(readFileSync(f.config, 'utf8'), manual);
  });

  it('rejects changed lease/checkpoint and expired approvals before mutating configuration', async () => {
    for (const kind of ['lease', 'checkpoint', 'expiry']) {
      const f = fixture();
      await f.prepare();
      const s = f.reopen(),
        preview = await s.preview({ action: 'benchmark-recover' }),
        prepared = readFileSync(f.config);
      if (kind === 'lease') {
        const lease = JSON.parse(readFileSync(f.lease, 'utf8')) as Record<string, unknown>;
        lease['acquiredAt'] = '2026-10-10T10:01:00Z';
        writeFileSync(f.lease, JSON.stringify(lease));
      } else if (kind === 'checkpoint')
        f.editCheckpoint((data) => {
          data['status'] = 'restoring';
        });
      else f.advance(10 * 60_000);
      await assert.rejects(s.apply({ ticket: preview.ticket }), /changed|expired/);
      assert.deepEqual(readFileSync(f.config), prepared);
      assert.equal(existsSync(f.lease), true);
    }
  });

  it('fails closed for other projects, missing/future/corrupt checkpoints and mismatched lease identities', async () => {
    for (const kind of ['other', 'missing', 'future', 'corrupt', 'mismatch', 'future-lease']) {
      const f = fixture();
      await f.prepare();
      const saved = readFileSync(f.config);
      if (kind === 'missing') rmSync(f.checkpoint);
      if (kind === 'future')
        f.editCheckpoint((data) => {
          data['schemaVersion'] = 99;
        });
      if (kind === 'corrupt') writeFileSync(f.checkpoint, '{');
      if (kind === 'mismatch')
        f.editCheckpoint((data) => {
          data['transactionId'] = 'factorial-' + 'e'.repeat(24);
        });
      if (kind === 'future-lease') {
        const lease = JSON.parse(readFileSync(f.lease, 'utf8')) as Record<string, unknown>;
        lease['schemaVersion'] = 99;
        writeFileSync(f.lease, JSON.stringify(lease));
      }
      const service = f.reopen(kind === 'other' ? 'p_other' : 'p_recovery');
      assert.equal(
        (await service.benchmarkRecovery()).state,
        kind === 'other' ? 'other-project' : 'unavailable',
      );
      await assert.rejects(service.preview({ action: 'benchmark-recover' }), /project|checkpoint/);
      assert.deepEqual(readFileSync(f.config), saved);
      assert.equal(existsSync(f.lease), true);
    }
    const unavailable = new GuideService(
      fixture().call,
      () => 0,
      () => 'ticket',
    );
    await assert.rejects(unavailable.preview({ action: 'benchmark-recover' }), /checkpoint/);
  });

  it('blocks corrupt backups before restoring any file and keeps the lease and prepared configuration', async () => {
    const f = fixture();
    await f.prepare();
    const s = f.reopen(),
      preview = await s.preview({ action: 'benchmark-recover' });
    const session = JSON.parse(readFileSync(f.checkpoint, 'utf8')) as {
      transactionId: string;
      snapshots: Array<{ contentRef: string | null }>;
    };
    const content = session.snapshots.find((snapshot) => snapshot.contentRef !== null)!.contentRef!;
    writeFileSync(join(f.stateRoot, 'backups', session.transactionId, content), 'corrupt backup');
    const prepared = readFileSync(f.config);
    assert.equal((await s.apply({ ticket: preview.ticket })).ok, false);
    assert.deepEqual(readFileSync(f.config), prepared);
    assert.equal(existsSync(f.lease), true);
    assert.equal(existsSync(f.receipt), false);
  });

  it('recovers after interruption at lease removal, without retrying automatically or finishing captures', async () => {
    const f = fixture();
    await f.prepare();
    const originalRemove = f.fs.remove.bind(f.fs);
    f.fs.remove = async (path) => {
      if (path === f.lease) throw new Error('fixture interruption');
      return originalRemove(path);
    };
    const s = f.reopen(),
      preview = await s.preview({ action: 'benchmark-recover' });
    assert.equal((await s.apply({ ticket: preview.ticket })).ok, false);
    assert.equal(readFileSync(f.config, 'utf8'), f.original);
    assert.equal(existsSync(f.lease), true);
    assert.equal(existsSync(f.receipt), false);
    f.fs.remove = originalRemove;
    const reopened = f.reopen(),
      retry = await reopened.preview({ action: 'benchmark-recover' });
    assert.equal((await reopened.apply({ ticket: retry.ticket })).ok, true);
    assert.equal(existsSync(f.lease), false);
    assert.equal(existsSync(f.receipt), false);
  });

  it('rejects browser selectors and keeps summary/preview/apply within Origin and CSRF checks', async (t) => {
    const f = fixture();
    await f.prepare();
    const service = f.reopen();
    for (const extra of [
      { benchmarkId: 'recovery' },
      { variant: 'combined' },
      { transactionId: 'x' },
      { path: f.config },
      { command: 'node' },
      { harness: 'codex' },
      { project: f.root },
    ])
      await assert.rejects(service.preview({ action: 'benchmark-recover', ...extra }), /selection/);
    await assert.rejects(service.preview({ action: ['benchmark-recover'] }), /selection/);
    let authority = '';
    const server = createServer(
      createGuideHandler({ service, token: 'recovery-csrf', authority: () => authority }),
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
    assert.equal((await fetch(origin + '/api/benchmark-recovery')).status, 200);
    assert.equal(
      (await fetch(origin + '/api/benchmark-recovery?benchmarkId=recovery')).status,
      400,
    );
    assert.equal(
      (
        await fetch(origin + '/api/benchmark-recovery', {
          headers: { Origin: 'https://foreign.example' },
        })
      ).status,
      403,
    );
    const payload = {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'benchmark-recover' }),
    };
    assert.equal((await fetch(origin + '/api/preview', payload)).status, 403);
    const response = await fetch(origin + '/api/preview', {
      ...payload,
      headers: { ...payload.headers, 'X-Token-Harness-CSRF': 'recovery-csrf' },
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()) as { ticket: string };
    const apply = { ...payload, body: JSON.stringify({ ticket: preview.ticket }) };
    assert.equal((await fetch(origin + '/api/apply', apply)).status, 403);
    assert.equal(existsSync(f.lease), true);
  });
});
