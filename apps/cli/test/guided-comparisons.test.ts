import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { NodeFileSystem } from '@token-harness/platform';
import { type PlatformFacts, type ProcessRequest, type ProcessRunner } from '@token-harness/core';
import { createGuideCall, GuideService } from '../src/guided.js';
import {
  createGuideComparisonReader,
  parseGuideComparisonRequest,
} from '../src/guided-comparisons.js';
import type { RunOptions } from '../src/run.js';

const ROOT = mkdtempSync(join(tmpdir(), 'th-guided-pairs-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'fixture',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
let sequence = 0;
function fixture() {
  const root = join(ROOT, String(++sequence)),
    home = join(root, 'home'),
    stateRoot = join(root, 'state'),
    project = join(root, 'project');
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  const config = join(home, '.codex', 'config.toml'),
    original = 'user_setting = "keep"\r\n';
  writeFileSync(config, original);
  const fs = new NodeFileSystem(facts),
    requests: ProcessRequest[] = [];
  const runner: ProcessRunner = {
    async run(request) {
      requests.push(request);
      const found = request.executable === 'codex' && request.args[0] === '--version';
      return {
        displayCommand: request.executable,
        executablePath: found ? join(root, 'bin', 'codex') : null,
        interpreter: 'direct',
        exitCode: found ? 0 : null,
        signal: null,
        stdout: found ? 'codex-cli 0.160.0' : '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: found ? null : { reason: 'executable-not-found', message: 'fixture unavailable' },
      };
    },
  };
  let clock = Date.parse('2026-10-09T16:00:00Z'),
    serial = 0;
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
      projectIdFor: () => 'p_guided',
      paths: { home, state: stateRoot, config: home, data: home, cache: home },
    },
  };
  const read = createGuideComparisonReader({ fs, stateRoot, projectId: 'p_guided' });
  const reopen = () =>
    new GuideService(
      createGuideCall(base),
      () => clock,
      () => String(++serial).padStart(32, '0'),
      null,
      null,
      null,
      null,
      read,
    );
  const start = async () => {
    const service = reopen();
    const preview = await service.preview({
      action: 'comparison-new',
      harness: 'codex',
      task: 'mechanical',
    });
    const result = await service.apply({ ticket: preview.ticket });
    assert.equal(result.ok, true, JSON.stringify(result));
    const item = (await service.comparisons()).items[0]!;
    return { service, key: item.key };
  };
  const path = (key: string, file: string) => join(stateRoot, 'benchmarks', key, file);
  return {
    read,
    reopen,
    start,
    path,
    requests,
    stateRoot,
    fs,
    config,
    original,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
const outcome = (
  key: string,
  expected = 'finish-baseline',
  quality = 'passed',
  attempts = 1,
  failedAttempts = 0,
) => ({ action: 'comparison-step', key, expected, quality, attempts, failedAttempts });

describe('guided paired captures', () => {
  it('previews without writes, reopens all four steps and retains failed quality through the existing CLI', async () => {
    const f = fixture(),
      initial = f.reopen();
    const preview = await initial.preview({
      action: 'comparison-new',
      harness: 'codex',
      task: 'mechanical',
    });
    assert.equal(existsSync(join(f.stateRoot, 'benchmarks')), false);
    assert.equal(f.requests.length, 0);
    assert.ok(!JSON.stringify(preview).includes(f.stateRoot));
    assert.equal((await initial.apply({ ticket: preview.ticket })).ok, true);
    const baseline = f.reopen(),
      item = (await baseline.comparisons()).items[0]!;
    assert.equal(item.state, 'baseline-running');
    f.advance(60_000);
    const finish = await baseline.preview(outcome(item.key));
    assert.equal(existsSync(f.path(item.key, 'baseline.json')), false);
    assert.equal((await baseline.apply({ ticket: finish.ticket })).ok, true);
    assert.equal((await f.read()).report.items[0]?.state, 'optimized-ready');
    const optimized = f.reopen();
    await assert.rejects(
      optimized.preview({
        action: 'comparison-step',
        key: item.key,
        expected: 'start-optimized',
        acknowledged: false,
      }),
      /valid check results/,
    );
    const start = await optimized.preview({
      action: 'comparison-step',
      key: item.key,
      expected: 'start-optimized',
      acknowledged: true,
    });
    assert.equal((await optimized.apply({ ticket: start.ticket })).ok, true);
    assert.equal((await f.read()).report.items[0]?.state, 'optimized-running');
    f.advance(60_000);
    const final = f.reopen(),
      result = await final.preview(outcome(item.key, 'finish-optimized', 'failed', 2, 2));
    assert.equal((await final.apply({ ticket: result.ticket })).ok, true);
    const report = await f.reopen().comparisons();
    assert.equal(report.items[0]?.state, 'complete');
    assert.equal(report.items[0]?.baselineQuality, 'passed');
    assert.equal(report.items[0]?.optimizedQuality, 'failed');
    const receipt = JSON.parse(readFileSync(f.path(item.key, 'optimized.json'), 'utf8'));
    assert.equal(receipt.outcome.qualityGate, 'failed');
    assert.deepEqual(
      receipt.outcome.qualityEvidence,
      { source: 'user-recorded' },
      'manual provenance is preserved',
    );
    assert.equal(receipt.localUsage, null, 'unavailable local usage is not fabricated');
    assert.deepEqual(receipt.usageBefore, []);
    assert.equal(readFileSync(f.config, 'utf8'), f.original);
    assert.ok(!JSON.stringify(report).includes(f.stateRoot));
    assert.ok(!JSON.stringify(report).includes('user_setting'));
    assert.ok(
      f.requests.every(
        (request) => !request.args.includes('install') && request.executable !== 'test-check',
      ),
    );
  });

  it('rejects altered state, expired tickets and replays without overwriting evidence', async () => {
    const f = fixture(),
      { service, key } = await f.start();
    const preview = await service.preview(outcome(key));
    const path = f.path(key, 'baseline.capture.json'),
      capture = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...capture, model: 'changed-model' }));
    await assert.rejects(service.apply({ ticket: preview.ticket }), /state changed/i);
    assert.equal(existsSync(f.path(key, 'baseline.json')), false);
    const fresh = await service.preview(outcome(key));
    f.advance(10 * 60_000 + 1);
    await assert.rejects(service.apply({ ticket: fresh.ticket }), /expired/);
    const reviewed = await service.preview(outcome(key));
    assert.equal((await service.apply({ ticket: reviewed.ticket })).ok, true);
    const saved = readFileSync(f.path(key, 'baseline.json'));
    await assert.rejects(service.apply({ ticket: reviewed.ticket }), /expired|already used/);
    assert.deepEqual(readFileSync(f.path(key, 'baseline.json')), saved);
  });

  it('refuses steps outside the current project or with automated/factorial capture data', async () => {
    const f = fixture(),
      { service, key } = await f.start();
    const other = createGuideComparisonReader({
      fs: f.fs,
      stateRoot: f.stateRoot,
      projectId: 'p_other',
    });
    assert.deepEqual((await other()).report.items, []);
    const path = f.path(key, 'baseline.capture.json'),
      raw = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...raw, projectId: 'p_other' }));
    await assert.rejects(service.preview(outcome(key)), /state changed/);
    writeFileSync(
      path,
      JSON.stringify({
        ...raw,
        qualityCheck: { executable: 'test-check', args: [], timeoutMs: 1000 },
      }),
    );
    await assert.rejects(service.preview(outcome(key)), /state changed/);
    assert.equal(existsSync(f.path(key, 'baseline.json')), false);
    for (const value of [
      { ...raw, schemaVersion: 99 },
      { ...raw, experiment: { design: 'factorial-2x2' } },
    ]) {
      writeFileSync(path, JSON.stringify(value));
      assert.deepEqual((await f.read()).report.items, []);
    }
    assert.ok(f.requests.every((request) => request.executable !== 'test-check'));
  });

  it('refuses unexpected step ordering and concurrent/replaced approvals', async () => {
    const f = fixture(),
      { service, key } = await f.start();
    await assert.rejects(service.preview(outcome(key, 'finish-optimized')), /state changed/);
    const earlier = await service.preview(outcome(key));
    const later = await service.preview(outcome(key, 'finish-baseline', 'failed', 1, 1));
    await assert.rejects(service.apply({ ticket: earlier.ticket }), /expired/);
    const attempts = await Promise.allSettled([
      service.apply({ ticket: later.ticket }),
      service.apply({ ticket: later.ticket }),
    ]);
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal((await f.read()).report.items[0]?.baselineQuality, 'failed');
  });

  it('rejects path/command fields, array-coerced enums and inconsistent attempt counts', async () => {
    const valid = outcome('guided-pair-example');
    assert.ok(parseGuideComparisonRequest(valid));
    for (const extra of [
      { path: '/private' },
      { command: 'node' },
      { check: ['test-check'] },
      { args: [] },
      { projectId: 'p_other' },
    ])
      assert.equal(parseGuideComparisonRequest({ ...valid, ...extra }), null);
    for (const extra of [
      { quality: ['passed'] },
      { expected: ['finish-baseline'] },
      { attempts: 0 },
      { attempts: 1.5 },
      { attempts: Number.MAX_SAFE_INTEGER + 1 },
      { attempts: '1' },
      { failedAttempts: 2 },
      { failedAttempts: -1 },
      { failedAttempts: 1 },
      { quality: 'unknown' },
    ])
      assert.equal(parseGuideComparisonRequest({ ...valid, ...extra }), null);
    assert.equal(
      parseGuideComparisonRequest({
        action: 'comparison-new',
        harness: ['codex'],
        task: 'standard',
      }),
      null,
    );
    assert.equal(
      parseGuideComparisonRequest({
        action: 'comparison-new',
        harness: 'codex',
        task: ['standard'],
      }),
      null,
    );
    assert.equal(parseGuideComparisonRequest({ ...valid, key: '../../outside' }), null);
    assert.equal(parseGuideComparisonRequest({ ...valid, key: 'external-cli-id' }), null);
  });

  it('blocks recording while a benchmark lease is active and fails closed on unavailable readers', async () => {
    const f = fixture(),
      { service, key } = await f.start();
    writeFileSync(
      join(f.stateRoot, 'mutation-lease.json'),
      JSON.stringify({
        schemaVersion: 1,
        transactionId: 'factorial-' + 'a'.repeat(24),
        benchmarkId: 'fixture',
        variant: 'combined',
        projectId: 'p_guided',
        acquiredAt: '2026-10-09T16:00:00Z',
      }),
    );
    assert.equal((await f.read()).report.blocked, true);
    await assert.rejects(service.preview(outcome(key)), /temporary configuration/);
    const missing = createGuideComparisonReader({ fs: null, stateRoot: null, projectId: null });
    assert.equal((await missing()).report.available, false);
  });
});
