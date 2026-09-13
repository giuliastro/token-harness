import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  knownPackageManagers,
  runPackageManagerInstall,
  type PackageManagerInstallAction,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

function action(version: string | null): PackageManagerInstallAction {
  return {
    kind: 'package-manager-install',
    id: 'pipx-mcptoon-install',
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pipx'],
    preconditions: [],
    postconditions: [],
    rollbackData: 'package-inventory',
    explanation: 'Install mcptoon through pipx',
    packageManager: 'pipx',
    packageName: 'mcptoon',
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
          stdout: '{"status":"success"}',
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

describe('pipx package installation', () => {
  it('uses an isolated exact-version package spec without a shell', async () => {
    const process = runner();
    const result = await runPackageManagerInstall({
      action: action('0.7.10'),
      runner: process.runner,
      cwd: '/work',
    });
    assert.equal(result.status, 'installed');
    assert.deepEqual(process.commands, ['pipx install --force --output json mcptoon==0.7.10']);
    assert.equal(knownPackageManagers().includes('pipx'), true);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'install-channel-unverified'),
      false,
    );
  });
});
