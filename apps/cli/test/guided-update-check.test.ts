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
  let applicationVersion = '0.1.20';
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
      available: '0.1.21',
      channel: 'npm',
      verdict: applicationVersion === '0.1.20' ? 'upgradable' : 'current',
      ...(confirmed && applicationVersion === '0.1.21' ? { updated: true } : {}),
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
    if (command === 'update') {
      const confirmed = args.includes('--yes');
      if (confirmed) {
        providerVersion = '0.45.0';
        applicationVersion = '0.1.21';
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
      result.messages.some((message) => message.includes('Token Harness: 0.1.20 → 0.1.21')),
    );
    assert.deepEqual(
      calls.filter((args) => args[0] === 'update'),
      [['update']],
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
    };
    assert.equal(appliedResult.ok, true);
    assert.equal(appliedResult.title, 'Token Harness updated');
    assert.equal(appliedResult.appliedPlans, 2);
    assert.ok(appliedResult.messages.some((message) => message.includes('Restart this app')));
    assert.deepEqual(
      calls.filter((args) => args[0] === 'update'),
      [['update'], ['update'], ['update', '--yes']],
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
  assert.match(GUIDE_HTML, /Health and updates/);
  assert.match(GUIDE_JS, /Check for updates/);
  assert.match(GUIDE_JS, /Install updates/);
  assert.match(GUIDE_JS, /\/api\/update-check/);
  assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
  assert.match(GUIDE_JS, /Nothing changes during this check/);
  assert.doesNotMatch(GUIDE_JS, /Check optimizer updates/);
});
