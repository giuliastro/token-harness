import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';
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
  type HarnessContextObservation,
} from '@token-harness/core';
import {
  GuideService,
  GuideError,
  guideSetupTarget,
  savingsView,
  explainGuideIssue,
  reasoningView,
  type GuideCall,
} from '../src/guided.js';
import { createGuideHandler } from '../src/guided-http.js';
import { GUIDE_JS, GUIDE_HTML, GUIDE_CSS } from '../src/guided-assets.js';

const platform = {
  os: 'windows',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;
const linuxPlatform = {
  ...platform,
  os: 'linux',
  osDisplayName: 'Linux',
} as const;
function envelope<T>(command: string, data: T, exitCode: 0 | 5 = 0): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode }), 'test');
}
function inventory(
  ids = ['claude', 'codex'],
  options: {
    platform?: DoctorReport['platform'];
    configured?: Partial<Record<'rtk' | 'harnesstrim' | 'gitnexus', string[]>>;
    providerVersions?: Partial<Record<'rtk' | 'harnesstrim' | 'gitnexus', string>>;
    harnessVersions?: Partial<Record<'claude' | 'codex', string>>;
  } = {},
): DoctorReport {
  const configured = options.configured ?? {};
  const providerVersions = options.providerVersions ?? {};
  const harnessVersions = options.harnessVersions ?? {};
  const provider = (id: 'rtk' | 'harnesstrim' | 'gitnexus', assignableHarnesses: string[]) => {
    const configuredHarnesses = (configured[id] ?? []).map(harnessId);
    return {
      providerId: providerId(id),
      state: configuredHarnesses.length > 0 ? ('configured' as const) : ('installed' as const),
      version:
        providerVersions[id] ??
        (id === 'rtk' ? '0.44.0' : id === 'harnesstrim' ? '0.1.0' : '1.6.12'),
      executable: '/private/' + id,
      installationChannel: null,
      versionVerdict: 'in-range' as const,
      configuredHarnesses,
      unmanagedHarnessesConfigured: [],
      supportsUnmanagedHarnesses: id === 'harnesstrim',
      managedByTokenHarness: false,
      assignableHarnesses: assignableHarnesses.map(harnessId),
      evidence: [],
      warnings: [],
    };
  };
  return {
    platform: options.platform ?? platform,
    problemCount: 0,
    providers: [
      provider('rtk', ['claude', 'codex']),
      provider('harnesstrim', ['claude', 'codex']),
      provider('gitnexus', ['claude']),
    ],
    harnesses: ids.map((id) => ({
      harnessId: harnessId(id),
      state: 'configured',
      version:
        harnessVersions[id as 'claude' | 'codex'] ?? (id === 'claude' ? '2.1.220' : '0.146.0'),
      versionVerdict: 'in-range',
      configPath: '/private/settings.json',
      declaredVerificationTier: 'config-only',
      evidence: [],
      warnings: [],
    })),
  };
}
function verification() {
  return {
    receiptId: null,
    appliedAt: null,
    healthyAtDeclaredTier: true,
    results: [],
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
function fixture(input: { failSecond?: boolean; ids?: string[]; doctor?: DoctorReport } = {}) {
  const calls: string[][] = [];
  let clock = 0,
    sequence = 0,
    writes = 0;
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    let data: unknown = null;
    const command = args[0] ?? '';
    if (command === 'doctor') data = input.doctor ?? inventory(input.ids);
    if (command === 'context') data = { harnesses: [], instructions: [] };
    if (command === 'budget') data = { harnesses: [] };
    if (command === 'status') data = { problemCount: 0 };
    if (command === 'plan') data = plan('abc0000' + ++sequence);
    if (command === 'apply' || command === 'rollback') {
      writes++;
      if (input.failSecond && writes === 2) return envelope(command, null, 5) as CliEnvelope<T>;
      data = { outcome: command === 'rollback' ? 'rolled-back' : 'committed' };
    }
    if (command === 'verify') data = verification();
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
  it('exposes reviewed RTK and HarnessTrim setup for Codex', async () => {
    const doctor = inventory(['codex']);
    assert.equal(guideSetupTarget(doctor, 'codex', 'rtk').state, 'actionable');
    assert.equal(guideSetupTarget(doctor, 'codex', 'harnesstrim').state, 'actionable');

    const { service, calls } = fixture({ ids: ['codex'], doctor });
    const preview = await service.preview({
      action: 'setup',
      harness: 'codex',
      provider: 'rtk',
    });
    assert.notEqual(preview.ticket, null);
    assert.deepEqual(
      calls.filter((args) => args[0] === 'plan'),
      [['plan', '--harness', 'codex', '--provider', 'rtk']],
    );
  });

  it('keeps optional setup actionable on newer versions when the installed adapter exposes it', async () => {
    const doctor = inventory(['claude'], {
      platform: linuxPlatform,
      harnessVersions: { claude: '9.9.9' },
      providerVersions: { gitnexus: '9.9.9' },
    });
    assert.equal(guideSetupTarget(doctor, 'claude', 'gitnexus').state, 'actionable');

    const { service, calls } = fixture({ ids: ['claude'], doctor });
    const preview = await service.preview({
      action: 'setup',
      harness: 'claude',
      provider: 'gitnexus',
    });
    assert.notEqual(preview.ticket, null);
    assert.deepEqual(
      calls.find((args) => args[0] === 'plan'),
      ['plan', '--harness', 'claude', '--provider', 'gitnexus'],
    );
  });

  it('offers an absent optional provider when its reviewed installer can reach the agent', () => {
    const doctor = inventory(['claude']);
    const gitnexus = doctor.providers.find((item) => item.providerId === providerId('gitnexus'));
    assert.ok(gitnexus);
    gitnexus.state = 'absent';
    gitnexus.version = null;
    gitnexus.executable = null;
    gitnexus.installationChannel = 'npm';
    gitnexus.assignableHarnesses = [harnessId('claude')];

    const target = guideSetupTarget(doctor, 'claude', 'gitnexus');
    assert.equal(target.state, 'actionable');
    assert.match(target.reason, /automatic install/i);
  });

  it('shows the real missing installer prerequisite instead of a generic setup-surface message', () => {
    const doctor = inventory(['claude']);
    const gitnexus = doctor.providers.find((item) => item.providerId === providerId('gitnexus'));
    assert.ok(gitnexus);
    gitnexus.state = 'absent';
    gitnexus.version = null;
    gitnexus.executable = null;
    gitnexus.installationChannel = 'npm';
    gitnexus.assignableHarnesses = [];
    gitnexus.warnings = [
      {
        severity: 'warning',
        code: 'gitnexus-npm-unavailable',
        subject: 'gitnexus',
        message: 'GitNexus is not installed and npm is not available in this terminal',
        path: null,
        remediation: 'Make npm available on PATH, then refresh.',
      },
    ];

    const target = guideSetupTarget(doctor, 'claude', 'gitnexus');
    assert.equal(target.state, 'unavailable');
    assert.match(target.reason, /npm is not available/i);
    assert.doesNotMatch(target.reason, /No compatible automatic setup surface/i);
  });

  it('treats newer HarnessTrim/Codex tuples as actionable when the provider still declares Codex', () => {
    const doctor = inventory(['codex'], {
      platform: linuxPlatform,
      harnessVersions: { codex: '9.9.9' },
      providerVersions: { harnesstrim: '9.9.9' },
    });
    const target = guideSetupTarget(doctor, 'codex', 'harnesstrim');
    assert.equal(target.state, 'actionable');
    assert.match(target.reason, /transactionally/i);
    assert.doesNotMatch(target.reason, /reviewed|version combination/i);
  });

  it('moves Codex HarnessTrim from actionable to connected after apply', async () => {
    let connected = false;
    let sequence = 0;
    const calls: string[][] = [];
    const doctor = () =>
      inventory(['codex'], {
        platform: linuxPlatform,
        harnessVersions: { codex: '0.152.1' },
        providerVersions: { harnesstrim: '0.2.1' },
        configured: connected ? { harnesstrim: ['codex'] } : {},
      });
    const call: GuideCall = async <T>(args: readonly string[]) => {
      calls.push([...args]);
      const command = args[0] ?? '';
      let data: unknown = null;
      if (command === 'doctor') data = doctor();
      if (command === 'context') data = { harnesses: [], instructions: [] };
      if (command === 'budget') data = { harnesses: [] };
      if (command === 'status') data = { problemCount: 0, drift: [] };
      if (command === 'plan') {
        assert.deepEqual(args, ['plan', '--harness', 'codex', '--provider', 'harnesstrim']);
        data = plan('stateful-' + ++sequence);
      }
      if (command === 'apply') {
        connected = true;
        data = { outcome: 'committed' };
      }
      if (command === 'verify') data = verification();
      return envelope(command, data as T);
    };
    const service = new GuideService(
      call,
      () => 0,
      () => 'stateful-ticket',
    );

    const before = await service.overview('all', true);
    const beforeCodex = before.agents.find((agent) => agent.id === 'codex');
    assert.equal(
      beforeCodex?.setup.find((target) => target.providerId === 'rtk')?.state,
      'actionable',
    );
    assert.equal(
      beforeCodex?.setup.find((target) => target.providerId === 'harnesstrim')?.state,
      'actionable',
    );

    const preview = await service.preview({ action: 'setup', harness: 'codex', provider: 'harnesstrim' });
    assert.ok(preview.ticket);
    assert.equal(
      calls.some((args) => args[0] === 'plan' && args.includes('rtk')),
      false,
    );
    const applied = await service.apply({ ticket: preview.ticket });
    assert.equal(applied.ok, true);

    const after = await service.overview('all', true);
    const afterCodex = after.agents.find((agent) => agent.id === 'codex');
    assert.equal(
      afterCodex?.setup.find((target) => target.providerId === 'harnesstrim')?.state,
      'connected',
    );
    assert.equal(
      afterCodex?.setup.find((target) => target.providerId === 'rtk')?.state,
      'actionable',
    );
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
    const setup = await service.preview({
      action: 'setup',
      harness: 'claude',
      provider: 'rtk',
    });
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
      async <T>(args: readonly string[]) => {
        await gate;
        if (args[0] === 'verify') return envelope('verify', verification() as T);
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
    assert.ok(GUIDE_HTML.includes('id="modal-actions"'));
    assert.ok(GUIDE_HTML.includes('Nothing changes without your approval'));
    assert.ok(GUIDE_JS.includes('Apply recommended setup'));
    assert.ok(GUIDE_JS.includes("request('/api/apply', { ticket })"));
    assert.ok(!GUIDE_HTML.includes('onclick='));
  });
});

describe('reasoning explanations and contextual actions', () => {
  const observed = (native: Record<string, unknown>) =>
    ({
      harnessId: 'claude',
      nativeEffort: {
        current: 'low',
        preferenceState: 'configured',
        writable: false,
        harnessVersion: '2.1.999',
        reason: 'This version is not reviewed for changes.',
        ...native,
      },
    }) as unknown as HarnessContextObservation;
  it('shows readable preferences without implying write compatibility or active-session control', () => {
    const view = reasoningView('claude', observed({}));
    assert.equal(view.label, 'Low');
    assert.equal(view.action.kind, 'help');
    assert.equal(view.action.topic, 'claude-effort');
    assert.match(view.changeNote, /not reviewed/);
    assert.match(view.changeNote, /\/effort/);
    assert.match(view.observed, /2.1.999/);
    assert.ok(!view.observed.includes('Setup never'));
  });
  it('separates no preference from a failed read and offers a real next action', () => {
    const unset = reasoningView(
      'claude',
      observed({ current: null, preferenceState: 'unset', writable: true }),
    );
    assert.equal(unset.label, 'No saved preference');
    assert.equal(unset.action.kind, 'effort');
    assert.match(unset.description, /default or another/);
    const unreadable = reasoningView(
      'claude',
      observed({
        current: null,
        preferenceState: 'unreadable',
        preferenceReason: 'Settings could not be read.',
      }),
    );
    assert.equal(unreadable.state, 'unavailable');
    assert.equal(unreadable.description, 'Settings could not be read.');
    assert.equal(unreadable.action.topic, 'claude-effort');
  });
  it('does not pass raw values or private settings into the guided report', () => {
    const view = reasoningView(
      'claude',
      observed({
        current: 'private-unrecognized-value',
        path: '/private-home/settings.json',
        files: ['/private-file'],
      }),
    );
    assert.equal(view.value, null);
    assert.ok(!JSON.stringify(view).includes('private-'));
  });
  it('rejects inherited object keys as effort values', () => {
    for (const current of ['__proto__', 'toString', 'constructor']) {
      const view = reasoningView('claude', observed({ current }));
      assert.equal(view.value, null);
      assert.equal(view.state, 'unavailable');
      assert.equal(typeof view.label, 'string');
    }
  });
  it('keeps the UI grouped, keyboard-navigable, neutral and explicitly approved', () => {
    assert.equal((GUIDE_HTML.match(/data-view=/g) ?? []).length, 2);
    assert.ok(GUIDE_HTML.includes('aria-controls="view-dashboard"'));
    assert.ok(GUIDE_HTML.includes('aria-controls="view-results"'));
    assert.ok(!GUIDE_HTML.includes('aria-controls="view-setup"'));
    assert.ok(GUIDE_HTML.includes('aria-label="Appearance"'));
    assert.ok(!GUIDE_HTML.includes('Less setup. More useful work.'));
    assert.ok(!GUIDE_CSS.includes('radial-gradient'));
    assert.ok(!GUIDE_CSS.includes('--qe-'));
    assert.ok(GUIDE_CSS.includes('prefers-color-scheme:dark'));
    assert.ok(GUIDE_HTML.includes('<h2>Coding agents</h2>'));
    assert.ok(GUIDE_HTML.includes('<h2>Optimizers</h2>'));
    assert.ok(GUIDE_JS.includes('Inside Claude Code'));
    assert.ok(!GUIDE_JS.includes("['Evidence'"));
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });
});
