import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import {
  commandResult,
  diagnostic,
  type TaskBenchmarkCaptureCheckPlanReport,
} from '@token-harness/core';
import { DEFAULT_COMMANDS } from 'token-harness';
import { captureRun, LINUX_FIXTURE_PLATFORM, REPO_ROOT } from '../src/index.js';

it('shows the check preview on stdout in default/verbose mode and in JSON data', async () => {
  const root = join(REPO_ROOT, 'tests', 'fixtures', 'benchmark-check-plan-golden');
  const data = JSON.parse(
    readFileSync(join(root, 'report.json'), 'utf8'),
  ) as TaskBenchmarkCaptureCheckPlanReport;
  const diagnostics = [
    diagnostic({
      severity: 'info',
      code: 'benchmark-check-plan',
      message: 'The saved check was planned without execution',
      remediation: data.nextCommand,
    }),
  ];
  const options = {
    platform: LINUX_FIXTURE_PLATFORM,
    cwd: '/tmp/fixture-project',
    home: '/tmp/fixture-home',
    stateRoot: null,
    toolVersion: 'test',
    commands: {
      ...DEFAULT_COMMANDS,
      'benchmark-finish': async () =>
        commandResult({ command: 'benchmark-finish', exitCode: 0, data, diagnostics }),
    },
  };
  const argv = [
    'benchmark-finish',
    '--benchmark-id',
    data.benchmarkId,
    '--variant',
    data.variant,
    '--attempts',
    '1',
    '--failed-attempts',
    '0',
  ];
  for (const flags of [[], ['--verbose']]) {
    const human = await captureRun({ ...options, argv: [...argv, ...flags] });
    assert.equal(human.exitCode, 0);
    assert.equal(human.stderr, '');
    assert.equal(human.stdout, readFileSync(join(root, 'report.txt'), 'utf8'));
    for (const line of human.stdout.trimEnd().split('\n'))
      assert.ok(line.length <= 78, `terminal line too long: ${line}`);
  }
  const json = await captureRun({ ...options, argv: [...argv, '--json'] });
  assert.equal(json.exitCode, 0);
  assert.equal(json.stderr, '');
  assert.deepEqual(JSON.parse(json.stdout), {
    schemaVersion: 1,
    command: 'benchmark-finish',
    toolVersion: 'test',
    status: 'ok',
    exitCode: 0,
    data,
    diagnostics,
  });
});
