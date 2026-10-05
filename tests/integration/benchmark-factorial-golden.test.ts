import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { commandResult, type TaskBenchmarkFactorialReport } from '@token-harness/core';
import { DEFAULT_COMMANDS } from 'token-harness';
import { captureRun, LINUX_FIXTURE_PLATFORM, REPO_ROOT } from '../src/index.js';

const root = join(REPO_ROOT, 'tests', 'fixtures', 'benchmark-factorial-golden');
const data = JSON.parse(
  readFileSync(join(root, 'report.json'), 'utf8'),
) as TaskBenchmarkFactorialReport;
const options = {
  platform: LINUX_FIXTURE_PLATFORM,
  cwd: '/tmp/fixture-project',
  home: '/tmp/fixture-home',
  stateRoot: null,
  toolVersion: 'test',
  commands: {
    ...DEFAULT_COMMANDS,
    'benchmark-factorial': async () =>
      commandResult({ command: 'benchmark-factorial', exitCode: 0, data }),
  },
};

it('golden-compares exploratory factorial human output and the complete JSON envelope', async () => {
  const human = await captureRun({
    ...options,
    argv: ['benchmark-factorial', '--benchmark-id', 'four-golden'],
  });
  assert.equal(human.exitCode, 0);
  assert.equal(human.stderr, '');
  assert.equal(human.stdout, readFileSync(join(root, 'human.txt'), 'utf8'));
  for (const line of human.stdout.trimEnd().split('\n'))
    assert.ok(line.length <= 78, `line exceeds terminal contract: ${line}`);
  const json = await captureRun({
    ...options,
    argv: ['benchmark-factorial', '--benchmark-id', 'four-golden', '--json'],
  });
  assert.equal(json.exitCode, 0);
  assert.equal(json.stderr, '');
  assert.deepEqual(JSON.parse(json.stdout), {
    schemaVersion: 1,
    command: 'benchmark-factorial',
    toolVersion: 'test',
    status: 'ok',
    exitCode: 0,
    data,
    diagnostics: [],
  });
  assert.equal(json.stdout.trimEnd().split('\n}\n').length, 1);
});
