import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseSemanticVersion,
  queryAvailableVersion,
  runPackageManagerInstall,
  type PackageManagerInstallAction,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

function runner(stdout: string): { commands: string[]; runner: ProcessRunner } {
  const commands: string[] = [];
  return {
    commands,
    runner: {
      run(request): Promise<ProcessOutcome> {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: `C:/tools/${request.executable}.exe`,
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
    },
  };
}

describe('provider update channels', () => {
  it('accepts a v-prefixed release version without changing semantic comparison', () => {
    assert.deepEqual(parseSemanticVersion('v0.48.0'), parseSemanticVersion('0.48.0'));
  });

  it('reads RTK versions from the current WinGet spelling', async () => {
    const process = runner('Found RTK [rtk-ai.rtk]\r\nVersion\r\n-------\r\nv0.48.0\r\nv0.47.0\r\n');
    const result = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process.runner,
      cwd: 'C:/work',
    });

    assert.equal(result.status, 'found');
    assert.equal(result.version, 'v0.48.0');
    assert.deepEqual(process.commands, ['winget show --id rtk-ai.rtk --exact --versions']);
  });

  it('uses npm for an exact HarnessTrim global update', async () => {
    const process = runner('');
    const action: PackageManagerInstallAction = {
      kind: 'package-manager-install',
      id: 'npm-harnesstrim-update',
      riskClass: 'delegated',
      requiresNetwork: true,
      requiresElevation: false,
      affectedPaths: [],
      affectedProcesses: ['npm'],
      preconditions: [],
      postconditions: [],
      rollbackData: 'package-inventory',
      explanation: 'Update HarnessTrim through npm',
      packageManager: 'npm',
      packageName: 'harnesstrim',
      version: '0.3.0',
    };

    const result = await runPackageManagerInstall({
      action,
      runner: process.runner,
      cwd: 'C:/work',
    });

    assert.equal(result.status, 'installed');
    assert.deepEqual(process.commands, ['npm install --global harnesstrim@0.3.0']);
    assert.equal(result.diagnostics.some((entry) => entry.code === 'install-channel-unverified'), false);
  });

  it('queries HarnessTrim through npm without locale-sensitive parsing', async () => {
    const process = runner('0.3.0\r\n');
    const result = await queryAvailableVersion({
      packageManager: 'npm',
      packageName: 'harnesstrim',
      runner: process.runner,
      cwd: 'C:/work',
    });

    assert.equal(result.status, 'found');
    assert.equal(result.version, '0.3.0');
    assert.deepEqual(process.commands, ['npm view harnesstrim version']);
  });
});
