import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import {
  commandResult,
  toEnvelope,
  aggregateEvents,
  harnessId,
  providerId,
  type CliEnvelope,
  type DoctorReport,
  type MetricsReport,
  type PlanReport,
  type PlannedAction,
} from '@token-harness/core';
import {
  GuideService,
  GuideError,
  savingsView,
  explainGuideIssue,
  type GuideCall,
} from '../src/guided.js';
import { createGuideHandler } from '../src/guided-http.js';
import { GUIDE_JS, GUIDE_HTML } from '../src/guided-assets.js';

const platform = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;
function envelope<T>(command: string, data: T, exitCode: 0 | 5 = 0): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode }), 'test');
}
function inventory(ids = ['claude', 'codex']): DoctorReport {
  return {
    platform,
    problemCount: 0,
    providers: [],
    harnesses: ids.map((id) => ({
      harnessId: harnessId(id),
      state: 'configured',
      version: '2.1.261',
      versionVerdict: 'in-range',
      configPath: '/private/settings.json',
      declaredVerificationTier: 'config-only',
      evidence: [],
      warnings: [],
    })),
  };
}
function plan(id: string): PlanReport {
  const action: PlannedAction = {
    kind: 'merge-json',
    id: 'effort',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: ['/private/settings.json'],
    affectedProcesses: ['claude'],
    preconditions: [],
    postconditions: [],
    rollbackData: 'file-snapshot',
    explanation: 'not for display',
    path: '/private/settings.json',
    ownedPointers: ['effortLevel'],
    createIfMissing: true,
    operations: [{ kind: 'set', pointer: 'effortLevel', value: 'low', expectedValueDigest: null }],
  };
  return {
    planId: id,
    profile: 'safe',
    harness: harnessId('claude'),
    projectRoot: '/private/project',
    projectId: 'p_1',
    pipelineId: null,
    ownership: [],
    exclusions: [],
    actions: [action],
    conflicts: [],
    network: [],
    elevation: [],
    backups: { files: 1 },
    persisted: true,
  };
}
function fixture(input: { failSecond?: boolean; ids?: string[] } = {}) {
  const calls: string[][] = [];
  let clock = 0,
    sequence = 0,
    writes = 0;
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    let data: unknown = null;
    const command = args[0] ?? '';
    if (command === 'doctor') data = inventory(input.ids);
    if (command === 'context') data = { harnesses: [], instructions: [] };
    if (command === 'budget') data = { harnesses: [] };
    if (command === 'status') data = { problemCount: 0 };
    if (command === 'plan') data = plan('abc0000' + ++sequence);
    if (command === 'apply' || command === 'rollback') {
      writes++;
      if (input.failSecond && writes === 2) return envelope(command, null, 5) as CliEnvelope<T>;
      data = { outcome: command === 'rollback' ? 'rolled-back' : 'committed' };
    }
    if (command === 'verify') data = { healthyAtDeclaredTier: true };
    return envelope(command, data as T);
  };
  const service = new GuideService(
    call,
    () => clock,
    () => 'ticket-' + sequence,
  );
  return {
    service,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('guided workflow', () => {
  it('previews readable settings, requires approval, and replays only stored plans', async () => {
    const { service, calls } = fixture();
    const preview = await service.preview({
      action: 'effort',
      harness: 'claude',
      task: 'mechanical',
    });
    assert.equal(preview.changes[0]?.title, 'Claude Code: set reasoning to low');
    assert.match(preview.changes[0]?.description ?? '', /stays in effect/);
    assert.ok(!JSON.stringify(preview).includes('/private'));
    assert.ok(calls.every((args) => args[0] !== 'apply'));
    assert.deepEqual(
      calls.find((args) => args[0] === 'plan'),
      [
        'plan',
        '--harness',
        'claude',
        '--provider',
        'none',
        '--native-policy',
        '--task',
        'mechanical',
        '--profile',
        'economy',
      ],
    );
    const result = await service.apply({ ticket: preview.ticket });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.at(-1), ['apply', '--plan', 'abc00001', '--yes']);
    await assert.rejects(service.apply({ ticket: preview.ticket }), /already used/);
  });
  it('rejects expired tickets, replacement previews, arbitrary commands and extra fields', async () => {
    const { service, advance } = fixture();
    const p = await service.preview({ action: 'setup' });
    advance(600_001);
    await assert.rejects(service.apply({ ticket: p.ticket }), /expired/);
    const p2 = await service.preview({ action: 'setup' });
    await service.preview({ action: 'effort', harness: 'claude', task: 'hard' });
    await assert.rejects(service.apply({ ticket: p2.ticket }), /expired/);
    for (const data of [
      { action: 'shell' },
      { action: 'setup', command: 'evil' },
      { action: 'effort', harness: 'claude' },
      { action: 'setup', harness: '../../evil' },
    ])
      await assert.rejects(service.preview(data), GuideError);
    await assert.rejects(service.apply({ ticket: 'x', plan: 'other' }), GuideError);
  });
  it('reports partial multi-agent success and does not retry', async () => {
    const { service, calls } = fixture({ failSecond: true });
    const p = await service.preview({ action: 'setup' });
    const result = await service.apply({ ticket: p.ticket });
    assert.equal(result.ok, false);
    assert.equal(result.appliedPlans, 1);
    assert.match(result.title, /Some changes/);
    assert.equal(calls.filter((args) => args[0] === 'apply').length, 2);
  });
  it('undo requires a new review and is guarded by the exact last applied plan', async () => {
    const { service, calls } = fixture({ ids: ['claude'] });
    await assert.rejects(service.preview({ action: 'undo' }), /no change/);
    const setup = await service.preview({ action: 'setup' });
    await service.apply({ ticket: setup.ticket });
    const undo = await service.preview({ action: 'undo' });
    assert.match(undo.changes[0]?.description ?? '', /manual edits/);
    assert.equal(service.status().canUndo, true);
    const result = await service.apply({ ticket: undo.ticket });
    assert.equal(result.ok, true);
    assert.equal(service.status().canUndo, false);
    assert.deepEqual(calls.at(-1), ['rollback', '--plan', 'abc00001', '--yes']);
  });
  it('does not treat an absent second agent as a failed integration', async () => {
    const { service, calls } = fixture({ ids: ['claude'] });
    assert.equal((await service.verify()).ok, true);
    assert.ok(calls.every((args) => !args.includes('codex')));
  });
  it('empty savings are missing, not zero; raw diagnostic text never enters friendly errors', async () => {
    assert.deepEqual(savingsView(null, 'all').rows, []);
    const { service } = fixture();
    const overview = await service.overview();
    assert.deepEqual(overview.savings.rows, []);
    assert.ok(!JSON.stringify(overview).includes('/private'));
    const diagnostic = {
      severity: 'error',
      code: 'foreign',
      message: 'token=secret',
      subject: null,
      path: null,
      remediation: null,
    } as const;
    assert.equal(explainGuideIssue([diagnostic], 'Cannot read'), 'Cannot read');
  });
  it('keeps negative output, different units and measurement classes separate', () => {
    const report: MetricsReport = {
      ...aggregateEvents({ events: [], windowStart: '2026-09-01', windowEnd: '2026-09-05' }),
      providers: [
        {
          providerId: providerId('rtk'),
          class: 'exact-local',
          saved: -5,
          before: 10,
          after: 15,
          unit: 'tokens',
          operations: 1,
          harnesses: [],
          managedByTokenHarness: false,
          adapterMode: null,
        },
        {
          providerId: providerId('harnesstrim'),
          class: 'estimated-local',
          saved: 30,
          unit: 'chars',
          operations: 2,
          harnesses: [],
          managedByTokenHarness: false,
          adapterMode: null,
        },
        {
          providerId: providerId('harnesstrim'),
          class: 'counterfactual',
          saved: 999999,
          unit: 'tokens',
          operations: 1,
          harnesses: [],
          managedByTokenHarness: false,
          adapterMode: null,
        },
      ],
      errors: 0,
      inflatedOperations: 1,
    };
    const view = savingsView(report, 'all');
    assert.equal(view.rows.length, 2);
    assert.equal(view.rows[0]?.saved, -5);
    assert.equal(view.rows[1]?.unit, 'characters');
    assert.equal(view.rows[1]?.measurement, 'Local estimate');
    assert.ok(!('total' in view));
  });
  it('serializes concurrent approvals before any asynchronous observation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new GuideService(
      async <T>() => {
        await gate;
        return envelope('doctor', inventory() as T);
      },
      () => 0,
      () => 'a',
    );
    const running = service.verify();
    await assert.rejects(service.preview({ action: 'setup' }), /Another operation/);
    release();
    await running;
  });
});

describe('guided browser security and assets', () => {
  it('accepts only the local same-origin authenticated review/apply path', async () => {
    const { service, calls } = fixture();
    let authority = '';
    const token = 'a'.repeat(64);
    const server = createServer(createGuideHandler({ service, token, authority: () => authority }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    authority = '127.0.0.1:' + address.port;
    const origin = 'http://' + authority;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(origin + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'X-Token-Harness-CSRF': token,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    try {
      const home = await fetch(origin);
      assert.equal(home.status, 200);
      assert.match(home.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
      assert.ok(!(await home.text()).includes(token));
      assert.equal(
        (await fetch(origin + '/api/session', { headers: { Origin: 'http://evil.invalid' } }))
          .status,
        403,
      );
      const hostileHost = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          origin + '/api/session',
          { headers: { Host: 'evil.invalid' } },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
      assert.equal(hostileHost, 403);
      assert.equal(
        (await fetch(origin + '/api/session', { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
          .status,
        403,
      );
      assert.equal(
        (await post('/api/preview', { action: 'setup' }, { 'X-Token-Harness-CSRF': 'bad' })).status,
        403,
      );
      assert.equal(
        (await post('/api/preview', { action: 'setup' }, { Origin: 'http://evil.invalid' })).status,
        403,
      );
      assert.equal(
        (await post('/api/preview', { action: 'setup' }, { 'Content-Type': 'text/plain' })).status,
        415,
      );
      assert.equal(
        (await post('/api/preview', { action: 'setup', padding: 'x'.repeat(9000) })).status,
        413,
      );
      assert.equal((await fetch(origin + '/api/apply')).status, 404);
      assert.equal((await post('/api/preview', { action: 'setup', argv: ['evil'] })).status, 400);
      assert.equal((await fetch(origin + '/api/overview?period=wrong')).status, 400);
      const previewResponse = await post('/api/preview', {
        action: 'effort',
        harness: 'claude',
        task: 'mechanical',
      });
      const preview = (await previewResponse.json()) as { ticket: string };
      assert.equal(previewResponse.status, 200);
      assert.equal((await post('/api/apply', { ticket: preview.ticket })).status, 200);
      assert.equal((await post('/api/apply', { ticket: preview.ticket })).status, 409);
      assert.equal(calls.filter((args) => args[0] === 'apply').length, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('has no inline executable code or control characters and preserves explicit approval', () => {
    assert.ok(
      [...GUIDE_JS].every((char) => char.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(char)),
    );
    assert.ok(!GUIDE_JS.includes('innerHTML'));
    assert.ok(GUIDE_HTML.includes('<dialog'));
    assert.ok(GUIDE_HTML.includes('Approve and apply'));
    assert.ok(!GUIDE_HTML.includes('onclick='));
  });
});
