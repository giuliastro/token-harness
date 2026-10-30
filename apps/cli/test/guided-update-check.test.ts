import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

import {
  commandResult,
  harnessId,
  providerId,
  toEnvelope,
  type CliEnvelope,
  type DoctorReport,
  type UpdateReport,
} from '@token-harness/core';
import { GuideService, type GuideCall, type GuideOverview } from '../src/guided.js';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { observation, startGuidedBrowser } from './guided-browser-double.js';
import { createGuideHandler } from '../src/guided-http.js';

const platform = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;
const CLAUDE = harnessId('claude');
const RTK = providerId('rtk');

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('checks updates on demand and applies only after the returned approval ticket', async () => {
  const calls: string[][] = [];
  let providerVersion = '0.44.0';
  let applicationVersion = '0.1.21';
  const doctor = (): DoctorReport => ({
    platform,
    problemCount: 0,
    providers: [
      {
        providerId: RTK,
        state: 'configured',
        version: providerVersion,
        executable: '/tools/rtk',
        installationChannel: 'cargo',
        versionVerdict: 'in-range',
        configuredHarnesses: [CLAUDE],
        unmanagedHarnessesConfigured: [],
        supportsUnmanagedHarnesses: false,
        managedByTokenHarness: false,
        assignableHarnesses: [CLAUDE],
        evidence: [],
        warnings: [],
      },
    ],
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  });
  const update = (confirmed: boolean): UpdateReport => ({
    providers: [
      {
        providerId: RTK,
        installed: providerVersion,
        available: '0.45.0',
        channel: 'cargo',
        verdict: providerVersion === '0.44.0' ? 'upgradable' : 'current',
        pin: null,
      },
    ],
    application: {
      applicationId: 'token-harness',
      installed: applicationVersion,
      available: '0.1.22',
      channel: 'npm',
      verdict: applicationVersion === '0.1.21' ? 'upgradable' : 'current',
      ...(confirmed && applicationVersion === '0.1.22' ? { updated: true } : {}),
    },
    network: ['crates.io'],
    execution: confirmed
      ? {
          planId: null,
          transactionId: 'update-rtk',
          fromStoredPlan: false,
          outcome: 'committed',
          results: [
            {
              actionId: 'rtk-update',
              kind: 'provider-update',
              status: 'applied',
              path: '/tools/rtk',
            },
            {
              actionId: 'token-harness-update',
              kind: 'package-manager-install',
              status: 'applied',
              path: null,
            },
          ],
          unrestored: [],
          receiptId: 'update-rtk',
        }
      : {
          planId: null,
          transactionId: null,
          fromStoredPlan: false,
          outcome: providerVersion === '0.44.0' ? 'confirmation-required' : 'nothing-to-do',
          results: [],
          unrestored: [],
          receiptId: null,
        },
  });
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'verify')
      return envelope(command, {
        receiptId: null,
        appliedAt: null,
        results: [],
        healthyAtDeclaredTier: true,
      } as T);
    if (command === 'update') {
      const confirmed = args.includes('--yes');
      if (confirmed) {
        providerVersion = '0.45.0';
        applicationVersion = '0.1.22';
      }
      const report = update(confirmed);
      return envelope(command, report as T);
    }
    return envelope(command, null as T);
  };

  const service = new GuideService(
    call,
    () => 0,
    () => 'update-ticket',
    null,
    null,
    async () => 'http://127.0.0.1:56789/',
  );
  const token = 'a'.repeat(64);
  let authority = '';
  const server = createServer(createGuideHandler({ service, token, authority: () => authority }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    const first = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(first.status, 200);
    const initial = (await first.json()) as GuideOverview;
    assert.equal(initial.stack.components[0]?.update, 'not-checked');
    assert.equal(
      calls.filter((args) => args[0] === 'update').length,
      0,
      'opening the UI must not poll update channels',
    );

    const background = await fetch(`${origin}/api/update-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ period: 'all', background: true }),
    });
    assert.equal(background.status, 200);
    const passive = (await background.json()) as {
      ticket: string | null;
      updatesAvailable: boolean;
    };
    assert.equal(passive.ticket, null);
    assert.equal(passive.updatesAvailable, true);
    const invalidBackground = await fetch(`${origin}/api/update-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ background: 'true' }),
    });
    assert.equal(invalidBackground.status, 400);

    const checked = await fetch(`${origin}/api/update-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ period: 'all' }),
    });
    assert.equal(checked.status, 200);
    const result = (await checked.json()) as {
      ok: boolean;
      ticket?: string | null;
      stack?: GuideOverview['stack'];
      messages: string[];
    };
    assert.equal(result.ok, true);
    assert.equal(result.ticket, 'update-ticket');
    assert.equal(result.stack?.components[0]?.update, 'available');
    assert.equal(result.stack?.components[0]?.updateAvailableVersion, '0.45.0');
    assert.ok(
      result.messages.some((message) => message.includes('Token Harness: 0.1.21 → 0.1.22')),
    );
    assert.deepEqual(
      calls.filter((args) => args[0] === 'update'),
      [['update'], ['update']],
      'the channel check itself must remain read-only',
    );

    const applied = await fetch(`${origin}/api/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ ticket: 'update-ticket' }),
    });
    assert.equal(applied.status, 200);
    const appliedResult = (await applied.json()) as {
      ok: boolean;
      title: string;
      appliedPlans: number;
      messages: string[];
      restartRequired?: boolean;
    };
    assert.equal(appliedResult.ok, true);
    assert.equal(appliedResult.title, 'Token Harness updated');
    assert.equal(appliedResult.appliedPlans, 2);
    assert.equal(appliedResult.restartRequired, true);
    assert.ok(
      calls.some((args) => args[0] === 'verify' && args.includes('claude')),
      'updates automatically re-check health',
    );
    assert.ok(appliedResult.messages.includes('Health re-check completed automatically.'));
    assert.ok(appliedResult.messages.some((message) => message.includes('Restart and re-check')));
    assert.deepEqual(
      calls.filter((args) => args[0] === 'update'),
      [['update'], ['update'], ['update'], ['update', '--yes']],
      'apply must re-check the exact approved targets before mutating',
    );

    const refreshed = await fetch(`${origin}/api/overview?period=all&refresh=1`);
    assert.equal(refreshed.status, 200);
    const changed = (await refreshed.json()) as GuideOverview;
    assert.equal(changed.stack.components[0]?.version, '0.45.0');
    assert.equal(
      changed.stack.components[0]?.update,
      'not-checked',
      'update evidence must expire after the installed stack changes',
    );
    const restartRequest = () =>
      fetch(`${origin}/api/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'X-Token-Harness-CSRF': token,
        },
        body: '{}',
      });
    const restart = await restartRequest();
    assert.equal(restart.status, 200);
    assert.deepEqual(await restart.json(), { url: 'http://127.0.0.1:56789/' });
    assert.equal((await restartRequest()).status, 409, 'restart approval is single-use');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('never reports a green update when the approved version is still not active', async () => {
  let updateCalls = 0;
  const doctor = (): DoctorReport => ({
    platform,
    problemCount: 0,
    providers: [
      {
        providerId: RTK,
        state: 'configured',
        version: '0.44.0',
        executable: '/tools/rtk',
        installationChannel: 'cargo',
        versionVerdict: 'in-range',
        configuredHarnesses: [CLAUDE],
        unmanagedHarnessesConfigured: [],
        supportsUnmanagedHarnesses: false,
        managedByTokenHarness: false,
        assignableHarnesses: [CLAUDE],
        evidence: [],
        warnings: [],
      },
    ],
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  });
  const report = (confirmed: boolean): UpdateReport => ({
    providers: [
      {
        providerId: RTK,
        installed: '0.44.0',
        available: '0.45.0',
        channel: 'cargo',
        verdict: 'upgradable',
        pin: null,
      },
    ],
    network: ['crates.io'],
    execution: confirmed
      ? {
          planId: null,
          transactionId: null,
          fromStoredPlan: false,
          outcome: 'nothing-to-do',
          results: [],
          unrestored: [],
          receiptId: null,
        }
      : null,
  });
  const call: GuideCall = async <T>(args: readonly string[]) => {
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'update') {
      updateCalls += 1;
      return envelope(command, report(args.includes('--yes')) as T);
    }
    return envelope(command, null as T);
  };

  const service = new GuideService(
    call,
    () => 0,
    () => 'update-ticket',
  );
  const checked = await service.checkUpdates();
  assert.equal(checked.ok, true);
  assert.equal(checked.ticket, 'update-ticket');

  const applied = await service.apply({ ticket: 'update-ticket' });
  assert.equal(applied.ok, false);
  assert.equal(applied.title, 'Update was not verified');
  assert.match(applied.messages[0] ?? '', /0\.45\.0/);
  assert.doesNotMatch(applied.messages.join(' '), /Already up to date/i);
  assert.equal(updateCalls, 3, 'check, preflight and approved mutation all ran');
});

it('surfaces an RTK direct-release warning instead of claiming everything is up to date', async () => {
  const doctor = (): DoctorReport => ({
    platform,
    problemCount: 0,
    providers: [
      {
        providerId: RTK,
        state: 'configured',
        version: '0.44.0',
        executable: '/tools/rtk',
        installationChannel: 'cargo',
        versionVerdict: 'in-range',
        configuredHarnesses: [CLAUDE],
        unmanagedHarnessesConfigured: [],
        supportsUnmanagedHarnesses: false,
        managedByTokenHarness: false,
        assignableHarnesses: [CLAUDE],
        evidence: [],
        warnings: [],
      },
    ],
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  });
  const call: GuideCall = async <T>(args: readonly string[]) => {
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'update') {
      return toEnvelope(
        commandResult({
          command,
          exitCode: 0,
          data: {
            providers: [
              {
                providerId: RTK,
                installed: '0.44.0',
                available: null,
                channel: 'github-release',
                verdict: 'unavailable',
                pin: null,
              },
            ],
            network: ['api.github.com (rtk-ai/rtk release metadata)'],
            execution: {
              planId: null,
              transactionId: null,
              fromStoredPlan: false,
              outcome: 'nothing-to-do',
              results: [],
              unrestored: [],
              receiptId: null,
            },
          } satisfies UpdateReport,
          diagnostics: [
            {
              severity: 'warning',
              code: 'rtk-release-target-unresolved',
              subject: RTK,
              message:
                'The verified GitHub release update was not planned because no concrete RTK executable path could be resolved',
              path: null,
              remediation:
                'Make the intended RTK executable available on PATH, then re-run Check for updates',
            },
          ],
        }),
        'test',
      ) as CliEnvelope<T>;
    }
    return envelope(command, null as T);
  };

  const service = new GuideService(
    call,
    () => 0,
    () => 'unused-ticket',
  );
  const result = await service.checkUpdates();

  assert.equal(result.ok, true);
  assert.equal(result.title, 'Update check needs attention');
  assert.equal(result.ticket, null);
  assert.ok(
    result.messages.some((message) => /RTK: .*no concrete RTK executable path/i.test(message)),
  );
  assert.ok(
    result.messages.some((message) =>
      /Make the intended RTK executable available on PATH/i.test(message),
    ),
  );
  assert.doesNotMatch(result.messages.join(' '), /up to date/i);
});

it('presents updates as one complete check then install flow', () => {
  assert.match(GUIDE_HTML, /id="update-notice"/);
  assert.match(GUIDE_JS, /Check for updates/);
  assert.match(GUIDE_JS, /Install update/);
  assert.match(GUIDE_JS, /\/api\/update-check/);
  assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
  assert.match(GUIDE_JS, /Nothing changes during this check/);
  assert.match(GUIDE_JS, /Token Harness checks every update together/);
  assert.doesNotMatch(GUIDE_JS, /Check optimizer updates/);
});

const updateTicket = {
  ok: true,
  title: 'Updates ready',
  messages: ['RTK 0.44.0 can update to 0.45.0.'],
  updatesAvailable: true,
  ticket: 'update-ticket',
};

function withUpdates() {
  const data = observation();
  data.stack.components = [
    {
      providerId: 'rtk',
      configured: true,
      configuredHarnesses: ['codex'],
      installed: true,
      version: '0.44.0',
      update: 'available',
      updateAvailableVersion: '0.45.0',
    },
  ];
  return data;
}

it('checks once after the first overview and installs only after an explicit review and approval', async () => {
  const browser = await startGuidedBrowser({
    data: withUpdates(),
    respond: (path, body) =>
      path === '/api/update-check'
        ? (body as { background?: boolean }).background
          ? { ...updateTicket, ticket: null, stack: undefined }
          : updateTicket
        : undefined,
  });
  const { get, writes, reads, settle, button } = browser;
  // The background check ran once, after the overview, and only announces the update.
  const checks = writes.filter((write) => write.path === '/api/update-check');
  assert.deepEqual(
    checks.map((write) => write.body),
    [{ period: 'all', background: true }],
  );
  assert.ok(
    reads.indexOf('/api/update-check') >
      reads.findIndex((path) => path.startsWith('/api/overview')),
  );
  assert.equal(get('update-notice').hidden, false);
  assert.match(get('update-notice').textContent, /An update is available/);
  assert.ok(writes.every((write) => write.path !== '/api/apply'));
  assert.equal(get('modal').open, false, 'an available update never opens a dialog by itself');

  button(get('update-notice'), 'Review update').fire('click');
  await settle();
  assert.deepEqual(writes.filter((write) => write.path === '/api/update-check').at(-1)?.body, {
    period: 'all',
  });
  assert.match(get('modal-content').textContent, /RTK 0\.44\.0 can update to 0\.45\.0\./);
  assert.match(get('modal-content').textContent, /previous configuration can be restored/);
  assert.ok(
    writes.every((write) => write.path !== '/api/apply'),
    'reviewing is not installing',
  );
  assert.deepEqual(
    get('modal-actions')
      .querySelectorAll('button')
      .map((item) => item.textContent),
    ['Cancel', 'Install update'],
  );
  button(get('modal-actions'), 'Cancel').fire('click');
  assert.ok(writes.every((write) => write.path !== '/api/apply'));

  button(get('update-notice'), 'Review update').fire('click');
  await settle();
  button(get('modal-actions'), 'Install update').fire('click');
  await settle();
  assert.deepEqual(
    writes.filter((write) => write.path === '/api/apply'),
    [{ path: '/api/apply', body: { ticket: 'update-ticket' } }],
  );
});

it('reviews a single method update together with every other update, never one provider alone', async () => {
  const { get, writes, settle, button } = await startGuidedBrowser({
    data: withUpdates(),
    storage: {},
    respond: (path, body) =>
      path === '/api/update-check' && !(body as { background?: boolean }).background
        ? updateTicket
        : undefined,
  });
  get('tab-methods').fire('click');
  const rtk = get('methods-root')
    .querySelectorAll('article.method')
    .find((item) => item.dataset['method'] === 'rtk')!;
  assert.match(rtk.textContent, /Update available: v0\.44\.0 → v0\.45\.0/);
  button(rtk, 'Update').fire('click');
  await settle();
  assert.match(get('modal-title').textContent, /Update RTK/);
  const request = writes.filter((write) => write.path === '/api/update-check').at(-1)!;
  assert.deepEqual(request.body, { period: 'all' }, 'no provider selector is sent');
  assert.ok(writes.every((write) => write.path !== '/api/apply'));
});

it('keeps an update that needs a restart pending until the user chooses to restart', async () => {
  const { get, writes, settle, button } = await startGuidedBrowser({
    data: withUpdates(),
    respond: (path, body) => {
      if (path === '/api/update-check')
        return (body as { background?: boolean }).background ? undefined : updateTicket;
      if (path === '/api/apply')
        return {
          ok: true,
          restartRequired: true,
          title: 'Update installed',
          messages: ['Restart to use 0.45.0.'],
        };
      if (path === '/api/restart') return { ok: true, messages: [] };
      return undefined;
    },
  });
  get('tab-methods').fire('click');
  const rtk = get('methods-root')
    .querySelectorAll('article.method')
    .find((item) => item.dataset['method'] === 'rtk')!;
  button(rtk, 'Update').fire('click');
  await settle();
  button(get('modal-actions'), 'Install update').fire('click');
  await settle();
  assert.equal(get('modal-title').textContent, 'Update installed');
  assert.match(get('modal-content').textContent, /Restart to finish.*Restart to use 0\.45\.0\./);
  assert.deepEqual(
    get('modal-actions')
      .querySelectorAll('button')
      .map((item) => item.textContent),
    ['Later', 'Restart and re-check'],
  );
  assert.ok(
    writes.every((write) => write.path !== '/api/restart'),
    'the restart is never automatic',
  );
  button(get('modal-actions'), 'Restart and re-check').fire('click');
  await settle();
  assert.equal(writes.filter((write) => write.path === '/api/restart').length, 1);
});


it('clears a stale startup update notice and rechecks all provider releases without a page refresh', async () => {
  const data = withUpdates();
  data.stack.components.push({
    providerId: 'harnesstrim',
    configured: true,
    configuredHarnesses: ['codex'],
    installed: true,
    version: '0.3.0',
    update: 'available',
    updateAvailableVersion: '0.3.1',
  });
  let installed = false;
  const { get, writes, settle, button } = await startGuidedBrowser({
    data,
    respond: (path, body) => {
      if (path === '/api/update-check') {
        if (!installed) {
          return {
            ...updateTicket,
            application: { applicationId: 'token-harness', installed: '0.1.34', available: null,
              channel: 'npm', verdict: 'current', installationSource: 'npm-global',
              installationPath: '/fixture/global/node_modules/token-harness' },
            ...(body as { background?: boolean }).background ? { ticket: null } : {},
          };
        }
        return {
          ok: true,
          title: 'Up to date',
          messages: ['Everything is current.'],
          updatesAvailable: false,
          ticket: null,
          stack: data.stack,
          application: { applicationId: 'token-harness', installed: '0.1.34', available: null,
            channel: 'npm', verdict: 'current', installationSource: 'npm-global',
            installationPath: '/fixture/global/node_modules/token-harness' },
        };
      }
      if (path === '/api/apply') {
        installed = true;
        for (const component of data.stack.components) {
          component.update = 'current';
          component.updateAvailableVersion = null;
        }
        return { ok: true, messages: ['All provider updates applied.'] };
      }
      return undefined;
    },
  });
  assert.equal(get('update-notice').hidden, false);
  button(get('update-notice'), 'Review update').fire('click');
  await settle();
  button(get('modal-actions'), 'Install update').fire('click');
  await settle();
  assert.equal(get('update-notice').hidden, true,
    'the startup warning must disappear without a browser refresh');
  assert.deepEqual(
    writes.filter(write => write.path === '/api/update-check').map(write => write.body),
    [{ period: 'all', background: true }, { period: 'all' }, { period: 'all', background: true }],
    'post-install check covers RTK, HarnessTrim and every other configured provider',
  );
  assert.equal(get('modal').open, true, 'no full-page reload is necessary');
});

it('replaces the stale Token Harness version banner with an explicit pending-restart notice', async () => {
  const { get, settle, button } = await startGuidedBrowser({
    data: withUpdates(),
    respond: (path, body) => {
      if (path === '/api/update-check')
        return (body as { background?: boolean }).background
          ? { ...updateTicket, ticket: null }
          : updateTicket;
      if (path === '/api/apply')
        return { ok: true, restartRequired: true, title: 'Token Harness updated',
          messages: ['Restart to load the installed build.'] };
      return undefined;
    },
  });
  button(get('update-notice'), 'Review update').fire('click');
  await settle();
  button(get('modal-actions'), 'Install update').fire('click');
  await settle();
  assert.match(get('update-notice').textContent, /Restart required/);
  assert.doesNotMatch(get('update-notice').textContent, /An update is available/);
  assert.equal(get('modal-title').textContent, 'Token Harness updated');
});

it('distinguishes npx and global npm installations without touching either installation', async () => {
  for (const installation of [
    { source: 'other', verdict: 'unsupported-installation',
      path: '/fixture/_npx/123/node_modules/token-harness', version: '0.1.34',
      expected: /Non-global \(for example npx\)/ },
    { source: 'npm-global', verdict: 'current',
      path: '/fixture/global/node_modules/token-harness', version: '0.1.32',
      expected: /Verified global npm/ },
  ]) {
    const { get, writes, turn, button, settle } = await startGuidedBrowser({
      data: withUpdates(),
      respond: (path, body) => path === '/api/update-check'
        ? {
            ok: true, title: 'Checked', messages: [], ticket: null, updatesAvailable: false,
            application: {
              applicationId: 'token-harness', installed: installation.version, available: null,
              channel: installation.source === 'npm-global' ? 'npm' : null,
              verdict: installation.verdict, installationSource: installation.source,
              installationPath: installation.path,
            },
          }
        : undefined,
    });
    await turn('details');
    assert.match(get('details-root').textContent, installation.expected);
    assert.ok(get('details-root').textContent.includes(installation.path));
    assert.ok(get('details-root').textContent.includes(installation.version));
    assert.match(get('details-root').textContent, /separate global CLI installation has not been checked/);
    button(get('details-root'), 'Check for updates').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, installation.expected);
    assert.ok(writes.every(write => write.path !== '/api/apply'),
      'provenance checks are read-only and must not install any packages');
  }
});
