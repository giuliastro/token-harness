import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runPackageManagerInstall,
  type PackageManagerInstallAction,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

function action(version: string | null): PackageManagerInstallAction {
  return {
    kind: 'package-manager-install',
    id: 'pnpm-harnesstrim-update',
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pnpm'],
    preconditions: [],
    postconditions: [],
    rollbackData: 'package-inventory',
    explanation: 'Update HarnessTrim through pnpm',
    packageManager: 'pnpm',
    packageName: 'harnesstrim',
    version,
  };
}

function runner(): { commands: string[]; runner: ProcessRunner } {
  const commands: string[] = [];
  return {
    commands,
    runner: {
      run(request): Promise<ProcessOutcome> {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
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
        });
      },
    },
  };
}

describe('pnpm package-manager install', () => {
  it('uses the documented global exact-version argv for HarnessTrim updates', async () => {
    const process = runner();
    const result = await runPackageManagerInstall({
      action: action('0.3.0'),
      runner: process.runner,
      cwd: '/work',
    });

    assert.equal(result.status, 'installed');
    assert.deepEqual(process.commands, ['pnpm add --global harnesstrim@0.3.0']);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'install-channel-unverified'));
  });

  it('omits the version suffix only when the action deliberately requests the channel default', async () => {
    const process = runner();
    const result = await runPackageManagerInstall({
      action: action(null),
      runner: process.runner,
      cwd: '/work',
    });

    assert.equal(result.status, 'installed');
    assert.deepEqual(process.commands, ['pnpm add --global harnesstrim']);
  });
});
