/**
 * The inventory half of `rollbackData: 'package-inventory'` — RFC 0009 §Initial delivery order
 * item 1.
 *
 * Two questions, tested apart: what the channel says it has installed (a read, decided by parsing
 * the channel's real output shape), and what a rollback may claim about restoring it (a receipt,
 * decided by the capture plus a re-read — never by optimism). The winget fixture below is the
 * same shape as the version-query one, because `winget list` prints the same separator-anchored
 * table; the other channels follow their documented output forms.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  channelCanReportInventory,
  knownInventoryChannels,
  queryPackageInventory,
  restorePackageInventory,
  type PackageInventoryCapture,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

/** The installed-version table `winget list --id <id> --exact` prints, Italian locale. */
const WINGET_LIST = ['Trovato rtk [rtk-ai.rtk]', 'Versione', '--------', '0.42.0', ''].join('\r\n');

function runner(result: Partial<ProcessOutcome>): { commands: string[]; runner: ProcessRunner } {
  const commands: string[] = [];
  return {
    commands,
    runner: {
      run(request) {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
          ...result,
        });
      },
    },
  };
}

function capture(overrides: Partial<PackageInventoryCapture> = {}): PackageInventoryCapture {
  return {
    channel: 'cargo',
    packageName: 'rtk',
    status: 'captured',
    version: '0.42.0',
    diagnostics: [],
    ...overrides,
  };
}

describe('known inventory channels', () => {
  it('lists the seven channels RFC 0009/update policy knows, sorted', () => {
    assert.deepEqual(knownInventoryChannels(), [
      'cargo',
      'homebrew',
      'npm',
      'pipx',
      'pnpm',
      'uv',
      'winget',
    ]);
    assert.equal(channelCanReportInventory('winget'), true);
    assert.equal(channelCanReportInventory('cargo'), true);
    assert.equal(channelCanReportInventory('pnpm'), true);
    assert.equal(channelCanReportInventory('not-a-channel'), false);
  });
});

describe('asking a channel what it has installed', () => {
  it('reads the installed version out of a localized winget table', async () => {
    const { commands, runner: process } = runner({ stdout: WINGET_LIST });
    const outcome = await queryPackageInventory({
      channel: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });

    assert.equal(outcome.status, 'captured');
    assert.equal(outcome.version, '0.42.0');
    assert.deepEqual(commands, ['winget list --id rtk-ai.rtk --exact']);
  });

  it('answers absent when cargo lists every crate and the crate is not there', async () => {
    const { runner: process } = runner({ stdout: 'bat v0.24.0:\n    /usr/bin/bat\n' });
    const outcome = await queryPackageInventory({
      channel: 'cargo',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'absent');
    assert.equal(outcome.version, null);
  });

  it('reads a crate line out of cargo install --list', async () => {
    const { runner: process } = runner({ stdout: 'rtk v0.42.0:\n    /home/user/.cargo/bin/rtk\n' });
    const outcome = await queryPackageInventory({
      channel: 'cargo',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'captured');
    assert.equal(outcome.version, '0.42.0');
  });

  it('reads HarnessTrim from pnpm global JSON inventory', async () => {
    const stdout = JSON.stringify([
      {
        path: '/home/user/.local/share/pnpm/global/5',
        dependencies: {
          harnesstrim: { from: 'harnesstrim', version: '0.1.0' },
        },
      },
    ]);
    const { commands, runner: process } = runner({ stdout });
    const outcome = await queryPackageInventory({
      channel: 'pnpm',
      packageName: 'harnesstrim',
      runner: process,
      cwd: '/work',
    });

    assert.equal(outcome.status, 'captured');
    assert.equal(outcome.version, '0.1.0');
    assert.deepEqual(commands, ['pnpm list --global harnesstrim --depth 0 --json']);
  });

  it('treats a valid pnpm global JSON tree without the package as absent', async () => {
    const { runner: process } = runner({ stdout: JSON.stringify([{ dependencies: {} }]) });
    const outcome = await queryPackageInventory({
      channel: 'pnpm',
      packageName: 'harnesstrim',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'absent');
  });

  it('reads npm, homebrew, uv, and pipx in their documented shapes', async () => {
    const cases: { channel: string; packageName: string; stdout: string; version: string }[] = [
      {
        channel: 'npm',
        packageName: 'rtk',
        stdout: 'rtk@0.42.0 /usr/lib/node_modules/rtk',
        version: '0.42.0',
      },
      { channel: 'homebrew', packageName: 'rtk', stdout: 'rtk 0.42.0', version: '0.42.0' },
      { channel: 'uv', packageName: 'rtk', stdout: 'rtk v0.42.0\n', version: '0.42.0' },
      { channel: 'pipx', packageName: 'rtk', stdout: 'rtk 0.42.0\n', version: '0.42.0' },
    ];
    for (const entry of cases) {
      const { runner: process } = runner({ stdout: entry.stdout });
      const outcome = await queryPackageInventory({
        channel: entry.channel,
        packageName: entry.packageName,
        runner: process,
        cwd: '/work',
      });
      assert.equal(outcome.status, 'captured', entry.channel);
      assert.equal(outcome.version, entry.version, entry.channel);
    }
  });

  it('never turns an unreadable answer into "captured at nothing"', async () => {
    const { runner: process } = runner({ stdout: 'Versione: 0.42.0\r\n' });
    const outcome = await queryPackageInventory({
      channel: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'unknown');
    assert.equal(outcome.version, null);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'inventory-query-unreadable'));
  });

  it('records a non-zero exit as failed, not as absent', async () => {
    const { runner: process } = runner({ exitCode: 1 });
    const outcome = await queryPackageInventory({
      channel: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'failed');
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'inventory-query-failed'));
  });

  it('says a channel outside the table is unsupported rather than guessing its output', async () => {
    const { runner: process } = runner({});
    const outcome = await queryPackageInventory({
      channel: 'apt',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'unsupported');
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'inventory-query-unsupported'));
  });

  it('fails rather than throwing when there is no runner', async () => {
    const outcome = await queryPackageInventory({
      channel: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: null,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.diagnostics[0]?.code, 'no-process-runner');
  });

  it('warns when the invocation was never observed working', async () => {
    const { runner: process } = runner({ stdout: 'rtk v0.42.0:\n' });
    const outcome = await queryPackageInventory({
      channel: 'cargo',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'inventory-query-unverified'));
  });
});

describe('restoring a captured inventory', () => {
  it('restores the captured version and re-reads the inventory to verify it', async () => {
    let installedOnly = true;
    const commands: string[] = [];
    const runner: ProcessRunner = {
      run: (request) => {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        const isList = request.args[1] === '--list';
        const stdout = isList ? (installedOnly ? 'rtk v0.42.0:\n' : '') : '';
        if (request.args.includes('--version')) installedOnly = true;
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    };

    const outcome = await restorePackageInventory({
      capture: capture({ channel: 'cargo', packageName: 'rtk' }),
      runner,
      cwd: '/work',
    });

    assert.equal(outcome.restored, true);
    assert.deepEqual(commands, ['cargo install rtk --version 0.42.0', 'cargo install --list']);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-inventory-restored'));
  });

  it('reports the restore as failed when the re-read disagrees', async () => {
    const commands: string[] = [];
    const runner: ProcessRunner = {
      run: (request) => {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        const stdout = request.args[1] === '--list' ? 'rtk v0.43.0:\n' : '';
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    };

    const outcome = await restorePackageInventory({
      capture: capture({ channel: 'cargo', packageName: 'rtk' }),
      runner,
      cwd: '/work',
    });

    assert.equal(outcome.restored, false);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-restore-failed'));
  });

  it('restores HarnessTrim through pnpm and verifies the previous global version', async () => {
    const commands: string[] = [];
    const runner: ProcessRunner = {
      run: (request) => {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        const isList = request.args[0] === 'list';
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout: isList
            ? JSON.stringify([{ dependencies: { harnesstrim: { version: '0.1.0' } } }])
            : '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    };

    const outcome = await restorePackageInventory({
      capture: capture({ channel: 'pnpm', packageName: 'harnesstrim', version: '0.1.0' }),
      runner,
      cwd: '/work',
    });

    assert.equal(outcome.restored, true);
    assert.deepEqual(commands, [
      'pnpm add --global harnesstrim@0.1.0',
      'pnpm list --global harnesstrim --depth 0 --json',
    ]);
  });

  it('says a confirmed absence stays installed rather than inventing an uninstall', async () => {
    const outcome = await restorePackageInventory({
      capture: capture({ status: 'absent', version: null }),
      runner: null,
      cwd: '/work',
    });
    assert.equal(outcome.restored, false);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-inventory-unrestored'));
  });

  it('says a missing capture cannot be restored instead of pretending', async () => {
    const outcome = await restorePackageInventory({
      capture: capture({ status: 'unknown', version: null }),
      runner: null,
      cwd: '/work',
    });
    assert.equal(outcome.restored, false);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-inventory-unrestored'));
  });

  it('says a captured version cannot be restored without a runner', async () => {
    const outcome = await restorePackageInventory({
      capture: capture(),
      runner: null,
      cwd: '/work',
    });
    assert.equal(outcome.restored, false);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-inventory-unrestored'));
  });

  it('reports a failed restore install as a failure', async () => {
    const { runner: process } = runner({ exitCode: 1 });
    const outcome = await restorePackageInventory({
      capture: capture({ channel: 'cargo', packageName: 'rtk' }),
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.restored, false);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-restore-failed'));
  });
});
