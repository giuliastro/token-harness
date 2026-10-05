/** Temporary homes and fake processes exercise real provider/harness planning and recovery. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { NodeFileSystem } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';
import { nativePromptRoutingHookEntries } from '@token-harness/adapters';
import {
  digestText,
  harnessId,
  type CliEnvelope,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type TaskBenchmarkCaptureStartReport,
  type TaskBenchmarkCaptureFinishResult,
} from '@token-harness/core';
import type { BenchmarkPrepareReport } from '../src/commands/benchmark-prepare.js';
import { recordNativePromptRoutingHook } from '../src/prompt-router.js';

const ROOT = mkdtempSync(join(tmpdir(), 'th-preparation-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'fixture',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
let serial = 0;
function world(harness: 'claude' | 'codex' = 'claude', empty = false) {
  const root = join(ROOT, String(++serial)),
    home = join(root, 'home'),
    project = join(root, 'project'),
    state = join(root, 'state');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(state, { recursive: true });
  const config = join(home, '.' + harness, harness === 'claude' ? 'settings.json' : 'hooks.json');
  const original =
    '{\r\n  "permissions": {"allow": ["Read"]},\r\n  "hooks": {"PreToolUse": [{"matcher":"Read","hooks":[{"type":"command","command":"user-hook"}]}]}\r\n}\r\n';
  if (!empty) {
    mkdirSync(join(home, '.' + harness), { recursive: true });
    writeFileSync(config, original);
  }
  let now = Date.parse('2026-10-05T09:00:00Z');
  const calls: ProcessRequest[] = [];
  let checkExit = 0,
    checkFailure: ProcessOutcome['failure'] = null;
  let checkMutation: (() => void) | null = null;
  let htCapabilities: string | null = null;
  let rtkVersion: string | null = '0.51.0';
  let harnessVersion = harness === 'claude' ? '2.1.288' : '0.160.0';
  const outcome = (r: ProcessRequest, text: string | null): ProcessOutcome => ({
    displayCommand: r.executable,
    executablePath: text === null ? null : join(root, 'bin', r.executable),
    interpreter: 'direct',
    exitCode: text === null ? null : 0,
    signal: null,
    stdout: text ?? '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: text === null ? { reason: 'executable-not-found', message: 'fixture absent' } : null,
  });
  const runner: ProcessRunner = {
    async run(r) {
      calls.push(r);
      if (r.executable === 'harnesstrim' && htCapabilities !== null)
        return outcome(r, r.args[0] === 'capabilities' ? htCapabilities : '0.3.1');
      if (r.executable === 'fixture-check') {
        checkMutation?.();
        return {
          ...outcome(r, 'check complete'),
          exitCode: checkFailure === null ? checkExit : null,
          failure: checkFailure,
          timedOut: checkFailure?.reason === 'timed-out',
          outputEvidence: {
            stdout: { sha256: 'a'.repeat(64), bytes: 14, tail: 'check complete' },
            stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' },
          },
        };
      }
      if (r.executable === 'rtk' && r.args[0] === '--version')
        return outcome(r, rtkVersion === null ? null : 'rtk ' + rtkVersion);
      if (r.executable === harness && r.args[0] === '--version')
        return outcome(
          r,
          harness === 'claude' ? harnessVersion + ' (Claude Code)' : 'codex-cli ' + harnessVersion,
        );
      if (r.executable === 'token-harness' && r.args.at(-1) === '--check')
        return outcome(
          r,
          r.args[0] === '__internal-rtk-hook'
            ? 'token-harness-rtk-hook-proxy-v1'
            : 'token-harness-prompt-router-v1',
        );
      return outcome(r, null);
    },
  };
  const fs = new NodeFileSystem(FACTS);
  const options: Omit<RunOptions, 'argv' | 'streams'> = {
    platform: FACTS,
    cwd: project,
    home,
    stateRoot: state,
    now: () => new Date(now).toISOString(),
    toolVersion: 'fixture',
    adapters: {
      fs,
      runner,
      localDatabase: null,
      paths: {
        home,
        config: join(home, '.config'),
        data: join(home, '.local', 'share'),
        state,
        cache: join(home, '.cache'),
      },
      projectIdFor: () => 'p_preparation',
    },
  };
  const invoke = async <T>(args: string[]): Promise<CliEnvelope<T>> => {
    let stdout = '',
      stderr = '';
    const exit = await run({
      ...options,
      argv: [...args, '--json'],
      streams: { out: (t) => (stdout += t), err: (t) => (stderr += t) },
    });
    assert.equal(stderr, '');
    const envelope = JSON.parse(stdout) as CliEnvelope<T>;
    assert.equal(envelope.exitCode, exit);
    return envelope;
  };
  const prepare = (id: string, arm: string, yes = false, extra: string[] = []) =>
    invoke<BenchmarkPrepareReport>([
      'benchmark-prepare',
      '--benchmark-id',
      id,
      '--variant',
      arm,
      '--starting-state',
      'tree-initial',
      '--task',
      'standard',
      '--harness',
      harness,
      ...(yes ? ['--yes'] : []),
      ...extra,
    ]);
  const restore = (id: string, arm: string, yes = true) =>
    invoke([
      'benchmark-restore',
      '--benchmark-id',
      id,
      '--variant',
      arm,
      ...(yes ? ['--yes'] : []),
    ]);
  const finish = (id: string, arm: string, extra: string[] = []) =>
    invoke<TaskBenchmarkCaptureFinishResult>([
      'benchmark-finish',
      '--benchmark-id',
      id,
      '--variant',
      arm,
      '--attempts',
      '1',
      '--failed-attempts',
      '0',
      ...extra,
    ]);
  return {
    fs,
    config,
    original,
    home,
    project,
    state,
    runner,
    invoke,
    prepare,
    restore,
    finish,
    calls,
    setVersions: (rtk: string | null, agent: string) => {
      rtkVersion = rtk;
      harnessVersion = agent;
    },
    enableHarnessTrim: (capabilities: string) => {
      htCapabilities = capabilities;
      mkdirSync(join(root, 'bin'), { recursive: true });
      writeFileSync(join(root, 'bin', 'harnesstrim'), 'fake executable; never invoked');
    },
    tick: () => (now += 1000),
    setCheck: (exit: number, failure: ProcessOutcome['failure'] = null) => {
      checkExit = exit;
      checkFailure = failure;
    },
    mutateCheck: (f: () => void) => (checkMutation = f),
    now: () => new Date(now).toISOString(),
  };
}

describe('managed factorial preparation', () => {
  it('previews without writes; reviews an exact digest; applies real config and restores byte-for-byte on finish', async () => {
    const w = world();
    const preview = await w.prepare('managed', 'combined');
    assert.equal(preview.exitCode, 0, JSON.stringify(preview.diagnostics));
    assert.equal(preview.data!.status, 'planned');
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal(existsSync(join(w.state, 'benchmarks')), false);
    const changed = await w.prepare('managed', 'combined', true, ['--plan', 'deadbeef']);
    assert.equal(changed.exitCode, 5);
    const prepared = await w.prepare('managed', 'combined', true, ['--plan', preview.data!.planId]);
    assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
    assert.equal(prepared.data!.verificationTier, 'config-only');
    const installed = readFileSync(w.config, 'utf8');
    assert.match(installed, /__internal-rtk-hook/);
    assert.match(installed, /__internal-prompt-router/);
    assert.match(installed, /user-hook/);
    assert.equal(
      prepared.data!.capture!.capture.experiment!.configuration!.source,
      'managed-config-only',
    );
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), true);
    assert.ok(!w.calls.some((c) => c.args.includes('install')));
    const other = await w.prepare('second', 'baseline', true);
    assert.equal(other.exitCode, 5);
    const blocked = await w.invoke([
      'apply',
      '--harness',
      'claude',
      '--provider',
      'rtk',
      '--disable-agent-routing',
      '--yes',
    ]);
    assert.equal(blocked.exitCode, 5);
    const manual = await w.invoke<TaskBenchmarkCaptureStartReport>([
      'benchmark-start',
      '--benchmark-id',
      'manual',
      '--variant',
      'baseline',
      '--task',
      'standard',
      '--harness',
      'claude',
    ]);
    assert.equal(manual.exitCode, 5);
    const matrix = await w.invoke<{ pendingConfiguration: { state: string } }>([
      'benchmark-matrix',
    ]);
    assert.equal(matrix.data!.pendingConfiguration.state, 'active');
    const plannedRestore = await w.restore('managed', 'combined', false);
    assert.equal(plannedRestore.exitCode, 0);
    assert.equal(readFileSync(w.config, 'utf8'), installed);
    w.tick();
    const finished = await w.finish('managed', 'combined', ['--quality', 'passed']);
    assert.equal(finished.exitCode, 0, JSON.stringify(finished.diagnostics));
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
    assert.ok(finished.diagnostics.some((d) => d.code === 'benchmark-configuration-restored'));
    const repeated = await w.restore('managed', 'combined');
    assert.equal(repeated.exitCode, 0);
  });

  it('prepares all four arms from the same owned ON configuration and keeps runtime attribution separate', async () => {
    const w = world();
    const setup = await w.invoke([
      'apply',
      '--harness',
      'claude',
      '--provider',
      'rtk',
      '--agent-routing',
      '--yes',
    ]);
    assert.equal(setup.exitCode, 0, JSON.stringify(setup.diagnostics));
    const original = readFileSync(w.config);
    const identities: string[] = [];
    for (const arm of ['baseline', 'compression-only', 'routing-only', 'combined']) {
      w.tick();
      const prepared = await w.prepare('four-managed', arm, true);
      assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
      identities.push(prepared.data!.initialConfigurationId);
      const bytes = readFileSync(w.config, 'utf8');
      assert.equal(
        bytes.includes('__internal-rtk-hook'),
        arm === 'compression-only' || arm === 'combined',
      );
      assert.equal(
        bytes.includes('__internal-prompt-router'),
        arm === 'routing-only' || arm === 'combined',
      );
      w.tick();
      const finished = await w.finish('four-managed', arm, ['--quality', 'passed']);
      assert.equal(finished.exitCode, 0, JSON.stringify(finished.diagnostics));
      assert.deepEqual(readFileSync(w.config), original);
    }
    assert.equal(new Set(identities).size, 1);
    const report = await w.invoke<{ status: string; configurationEvidence: string }>([
      'benchmark-factorial',
      '--benchmark-id',
      'four-managed',
    ]);
    assert.equal(report.data!.configurationEvidence, 'managed-config-only');
    assert.equal(report.data!.status, 'routing-unverified');
  });

  it('removes originally absent files and empty implicit parent directories on both Claude and Codex', async () => {
    for (const harness of ['claude', 'codex'] as const) {
      const w = world(harness, true);
      const prepared = await w.prepare('absence', 'combined', true);
      assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
      assert.equal(existsSync(w.config), true);
      assert.equal((await w.restore('absence', 'combined')).exitCode, 0);
      assert.equal(existsSync(join(w.home, '.' + harness)), false);
    }
  });

  it('previews checks without restoring, then restores failed and unknown checks after recording quality', async () => {
    for (const failure of [null, { reason: 'timed-out' as const, message: 'fixture timeout' }]) {
      const w = world();
      w.setCheck(9, failure);
      const prepared = await w.prepare('check', 'combined', true, [
        '--check-command',
        '["fixture-check"]',
      ]);
      assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
      const preview = await w.finish('check', 'combined');
      assert.equal(preview.exitCode, 0);
      assert.ok(preview.data && 'status' in preview.data);
      assert.equal(preview.data.status, 'check-planned');
      assert.equal(preview.data.checkExecuted, false);
      assert.equal(preview.data.receiptFinalized, false);
      assert.equal(existsSync(join(w.state, 'mutation-lease.json')), true);
      assert.equal(w.calls.filter((c) => c.executable === 'fixture-check').length, 0);
      w.tick();
      const finish = await w.finish('check', 'combined', ['--yes']);
      assert.equal(finish.exitCode, 0, JSON.stringify(finish.diagnostics));
      assert.ok(finish.data && 'receipt' in finish.data);
      assert.equal(
        finish.data!.receipt.outcome.qualityGate,
        failure === null ? 'failed' : 'unknown',
      );
      assert.equal(readFileSync(w.config, 'utf8'), w.original);
    }
  });

  it('preserves edits made during checks, retains the receipt and lease, and recovers after the edit is resolved', async () => {
    const w = world();
    assert.equal(
      (await w.prepare('edited', 'combined', true, ['--check-command', '["fixture-check"]']))
        .exitCode,
      0,
    );
    const prepared = readFileSync(w.config, 'utf8');
    w.mutateCheck(() => writeFileSync(w.config, prepared + '\nuser changed this\n'));
    w.tick();
    const finished = await w.finish('edited', 'combined', ['--yes']);
    assert.equal(finished.exitCode, 7);
    assert.equal(existsSync(join(w.state, 'benchmarks', 'edited', 'combined.json')), true);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), true);
    const drift = await w.restore('edited', 'combined');
    assert.equal(drift.exitCode, 5);
    assert.match(readFileSync(w.config, 'utf8'), /user changed/);
    writeFileSync(w.config, prepared);
    assert.equal((await w.restore('edited', 'combined')).exitCode, 0);
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
  });

  it('blocks deletion of user-added files beneath newly created configuration directories', async () => {
    const w = world('codex', true);
    assert.equal((await w.prepare('extra', 'combined', true)).exitCode, 0);
    const extra = join(w.home, '.codex', 'my-file');
    writeFileSync(extra, 'user data');
    assert.equal((await w.restore('extra', 'combined')).exitCode, 5);
    assert.equal(readFileSync(extra, 'utf8'), 'user data');
    rmSync(extra);
    assert.equal((await w.restore('extra', 'combined')).exitCode, 0);
  });

  it('refuses identical-looking brownfield provider or routing configuration without an ownership journal', async () => {
    for (const provider of ['rtk', 'router']) {
      const w = world();
      if (provider === 'rtk') {
        assert.equal(
          (await w.invoke(['apply', '--harness', 'claude', '--provider', 'rtk', '--yes'])).exitCode,
          0,
        );
        rmSync(join(w.state, 'journals'), { recursive: true });
      } else {
        const hooks = Object.fromEntries(
          nativePromptRoutingHookEntries(harnessId('claude'), 'token-harness', FACTS.os).map(
            (e) => [e.eventName, [e.value]],
          ),
        );
        writeFileSync(w.config, JSON.stringify({ hooks }));
      }
      const initial = readFileSync(w.config);
      const result = await w.prepare('brownfield', 'baseline', true);
      assert.equal(result.exitCode, 5, JSON.stringify(result.diagnostics));
      assert.deepEqual(readFileSync(w.config), initial);
      assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
    }
  });

  it('detects corrupt checkpoints and all backups before any restore write', async () => {
    const w = world();
    const prepared = await w.prepare('corrupt', 'combined', true);
    assert.equal(prepared.exitCode, 0);
    const initial = readFileSync(w.config);
    const sessionPath = join(w.state, 'benchmarks', 'corrupt', 'combined.session.json');
    const saved = readFileSync(sessionPath, 'utf8');
    writeFileSync(sessionPath, saved.replace('"schemaVersion": 1', '"schemaVersion": 99'));
    assert.equal((await w.restore('corrupt', 'combined')).exitCode, 5);
    assert.deepEqual(readFileSync(w.config), initial);
    writeFileSync(sessionPath, saved);
    const session = JSON.parse(saved) as {
      transactionId: string;
      snapshots: Array<{ contentRef: string | null }>;
    };
    const backup = join(
      w.state,
      'backups',
      session.transactionId,
      session.snapshots.find((s) => s.contentRef !== null)!.contentRef!,
    );
    const good = readFileSync(backup);
    writeFileSync(backup, 'corrupt backup');
    assert.equal((await w.restore('corrupt', 'combined')).exitCode, 7);
    assert.deepEqual(readFileSync(w.config), initial);
    writeFileSync(backup, good);
    assert.equal((await w.restore('corrupt', 'combined')).exitCode, 0);
  });

  it('recovers an interrupted apply from a persisted action prefix and resumes an interrupted restore', async () => {
    const w = world();
    assert.equal((await w.prepare('interrupted', 'combined', true)).exitCode, 0);
    const file = join(w.state, 'benchmarks', 'interrupted', 'combined.session.json');
    const session = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    // Simulate process death just after the last applied action, before the ready checkpoint.
    delete session['checkpointDigest'];
    session['status'] = 'applying';
    writeFileSync(
      file,
      JSON.stringify({ ...session, checkpointDigest: digestText(JSON.stringify(session)) }),
    );
    const failedFs = w.fs;
    const remove = failedFs.remove.bind(failedFs);
    let fail = true;
    failedFs.remove = async (path) => {
      if (path.endsWith('mutation-lease.json') && fail) {
        fail = false;
        throw new Error('fixture interrupted cleanup');
      }
      return remove(path);
    };
    assert.equal((await w.restore('interrupted', 'combined')).exitCode, 7);
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal((await w.restore('interrupted', 'combined')).exitCode, 0);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
  });

  it('requires the same initial configuration identity across managed arms before mutations', async () => {
    const w = world();
    assert.equal((await w.prepare('identity', 'baseline', true)).exitCode, 0);
    w.tick();
    assert.equal((await w.finish('identity', 'baseline', ['--quality', 'passed'])).exitCode, 0);
    writeFileSync(w.config, w.original + ' ');
    const changed = readFileSync(w.config);
    const next = await w.prepare('identity', 'combined', true);
    assert.equal(next.exitCode, 5);
    assert.deepEqual(readFileSync(w.config), changed);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
  });

  it('records actual controlled callback fixtures before restoration and excludes configuration alone', async () => {
    const w = world();
    assert.equal((await w.prepare('callbacks', 'combined', true)).exitCode, 0);
    w.tick();
    for (const event of ['prompt-submit', 'subagent-start'] as const)
      await recordNativePromptRoutingHook({
        fs: w.fs,
        stateRoot: w.state,
        harness: 'claude',
        event,
        projectId: 'p_preparation',
        now: w.now(),
        hookInput: null,
      });
    w.tick();
    const finish = await w.finish('callbacks', 'combined', ['--quality', 'passed']);
    assert.equal(finish.exitCode, 0);
    assert.ok(finish.data && 'receipt' in finish.data);
    assert.equal(finish.data!.receipt.nativeRoutingAtFinish!.configured, true);
    assert.equal(finish.data!.receipt.nativeRoutingAtFinish!.subagentsStarted, 1);
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
  });

  it('toggles an owned RTK/HarnessTrim stack using local actions, preserving matching skills without an installer', async () => {
    const w = world();
    const skill = '# Fixture HarnessTrim skill\n';
    w.setVersions('0.50.0', '2.1.274');
    const skillPath = join(w.project, '.claude', 'skills', 'latest', 'SKILL.md');
    mkdirSync(join(w.project, '.claude', 'skills', 'latest'), { recursive: true });
    writeFileSync(skillPath, skill);
    w.enableHarnessTrim(
      JSON.stringify({
        version: '0.3.1',
        harnesses: {
          claude: {
            adapter: '@harnesstrim/adapter-claude',
            surfaces: ['PostToolUse Bash hook — deterministic reduction of Bash output'],
            writeSet: [
              '.claude/skills/',
              '.claude/settings.json',
              'CLAUDE.md (marker-guarded snippet)',
            ],
            narrowing: [
              { flag: '--no-hook', produces: 'skills + instructions only' },
              { flag: '--no-instructions', produces: 'skills + hook only' },
            ],
          },
        },
        digests: { claude: { '.claude/skills/latest/SKILL.md': digestText(skill).slice(7) } },
      }),
    );
    mkdirSync(join(w.state, 'journals'), { recursive: true });
    writeFileSync(
      join(w.state, 'journals', 'fixture-skills.json'),
      JSON.stringify({
        schemaVersion: 1,
        transactionId: 'fixture-skills',
        planId: '12345678',
        projectId: 'p_preparation',
        projectRoot: w.project,
        startedAt: '2026-10-05T08:00:00Z',
        finishedAt: '2026-10-05T08:00:01Z',
        outcome: 'committed',
        entries: [],
        ownership: [{ kind: 'owned-file', path: skillPath, digest: digestText(skill), mode: null }],
        pinned: false,
        diagnostics: [],
      }),
    );
    if (FACTS.os !== 'linux') {
      const conflict = await w.prepare('unsupported-stack', 'baseline', true);
      assert.equal(conflict.exitCode, 4);
      assert.equal(readFileSync(skillPath, 'utf8'), skill);
      w.setVersions(null, '2.1.274');
    }
    const prepared = await w.prepare('stack', 'baseline', true);
    assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
    assert.deepEqual(
      prepared.data!.providers,
      FACTS.os === 'linux' ? ['rtk', 'harnesstrim'] : ['harnesstrim'],
    );
    assert.equal(existsSync(skillPath), false);
    assert.equal(
      prepared.data!.actions.some((a) => a.kind === 'delegated-provider-install'),
      false,
    );
    assert.equal((await w.restore('stack', 'baseline')).exitCode, 0);
    assert.equal(readFileSync(skillPath, 'utf8'), skill);
    w.tick();
    const on = await w.prepare('stack', 'combined', true);
    assert.equal(on.exitCode, 0, JSON.stringify(on.diagnostics));
    assert.match(readFileSync(w.config, 'utf8'), /harnesstrim.*hook/);
    assert.equal(readFileSync(skillPath, 'utf8'), skill);
    assert.equal(
      on.data!.actions.some((a) => a.kind === 'delegated-provider-install'),
      false,
    );
    assert.equal((await w.restore('stack', 'combined')).exitCode, 0);
    assert.ok(!w.calls.some((c) => c.args[0] === 'install'));
  });

  it('recovers a truncated transaction journal from the intact checkpoint and preserves the interrupted bytes', async () => {
    const w = world();
    const prepared = await w.prepare('journal', 'combined', true);
    assert.equal(prepared.exitCode, 0);
    const transactionId = prepared.data!.capture!.capture.experiment!.configuration!.transactionId;
    writeFileSync(join(w.state, 'journals', transactionId + '.json'), '{"schemaVersion":');
    assert.equal((await w.restore('journal', 'combined')).exitCode, 0);
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal(
      readFileSync(join(w.state, 'backups', transactionId, 'interrupted-journal.content'), 'utf8'),
      '{"schemaVersion":',
    );
  });

  it('verifies the original snapshot once after a mid-apply failure with several actions on the same file', async () => {
    const w = world();
    const write = w.fs.writeFile.bind(w.fs);
    let writes = 0;
    w.fs.writeFile = async (path, bytes, mode) => {
      await write(path, bytes, mode);
      if (path === w.config && ++writes === 2) throw new Error('fixture mid-apply failure');
    };
    const result = await w.prepare('failure', 'combined', true);
    assert.equal(result.exitCode, 6, JSON.stringify(result.diagnostics));
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
    assert.equal(
      existsSync(join(w.state, 'benchmarks', 'failure', 'combined.capture.json')),
      false,
    );
  });

  it('keeps the first concurrent finish receipt immutable and avoids stale-session recovery failures', async () => {
    const w = world();
    const execute = w.runner.run.bind(w.runner);
    let check = 0;
    w.runner.run = async (request) => {
      const label = request.executable === 'fixture-check' ? `concurrent-${++check}` : null;
      const outcome = await execute(request);
      return label === null
        ? outcome
        : {
            ...outcome,
            stdout: label,
            outputEvidence: {
              stdout: {
                sha256: digestText(label).slice(7),
                bytes: Buffer.byteLength(label),
                tail: label,
              },
              stderr: { sha256: digestText('').slice(7), bytes: 0, tail: '' },
            },
          };
    };
    assert.equal(
      (await w.prepare('concurrent', 'combined', true, ['--check-command', '["fixture-check"]']))
        .exitCode,
      0,
    );
    w.tick();
    const results = await Promise.all([
      w.finish('concurrent', 'combined', ['--yes']),
      w.finish('concurrent', 'combined', ['--yes']),
    ]);
    assert.deepEqual(results.map((r) => r.exitCode).sort(), [0, 5], JSON.stringify(results));
    const receipt = readFileSync(
      join(w.state, 'benchmarks', 'concurrent', 'combined.json'),
      'utf8',
    );
    const tail = JSON.parse(
      readFileSync(join(w.state, 'benchmarks', 'concurrent', 'combined.check-output.json'), 'utf8'),
    ) as { stdout: string };
    const recorded = JSON.parse(receipt) as {
      outcome: { qualityEvidence: { output: { stdout: { sha256: string } } } };
    };
    assert.equal(
      digestText(tail.stdout).slice(7),
      recorded.outcome.qualityEvidence.output.stdout.sha256,
    );
    assert.equal(readFileSync(w.config, 'utf8'), w.original);
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), false);
    assert.equal((await w.finish('concurrent', 'combined', ['--yes'])).exitCode, 5);
    assert.equal(
      readFileSync(join(w.state, 'benchmarks', 'concurrent', 'combined.json'), 'utf8'),
      receipt,
    );
  });

  it('keeps a broken integration of another harness outside this preparation scope', async () => {
    const w = world();
    w.setVersions('0.49.0', '2.1.288');
    const other = join(w.home, '.codex', 'hooks.json');
    mkdirSync(join(w.home, '.codex'), { recursive: true });
    const original = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: '^Bash$', hooks: [{ type: 'command', command: 'rtk hook codex' }] },
        ],
      },
    });
    writeFileSync(other, original);
    const prepared = await w.prepare('scoped', 'combined', true);
    assert.equal(prepared.exitCode, 0, JSON.stringify(prepared.diagnostics));
    assert.equal((await w.restore('scoped', 'combined')).exitCode, 0);
    assert.equal(readFileSync(other, 'utf8'), original);
  });

  it('retains unknown partial writes during apply instead of rolling them over with the original snapshot', async () => {
    const w = world();
    const write = w.fs.writeFile.bind(w.fs);
    let failed = false;
    w.fs.writeFile = async (path, bytes, mode) => {
      if (path === w.config && !failed) {
        failed = true;
        await write(path, new TextEncoder().encode('unknown partial bytes'));
        throw new Error('fixture partial write');
      }
      return write(path, bytes, mode);
    };
    const result = await w.prepare('partial', 'combined', true);
    assert.equal(result.exitCode, 7, JSON.stringify(result.diagnostics));
    assert.equal(readFileSync(w.config, 'utf8'), 'unknown partial bytes');
    assert.equal(existsSync(join(w.state, 'mutation-lease.json')), true);
    writeFileSync(w.config, w.original);
    assert.equal((await w.restore('partial', 'combined')).exitCode, 0);
  });
});
