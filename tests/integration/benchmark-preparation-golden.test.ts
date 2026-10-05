import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { commandResult } from '@token-harness/core';
import { DEFAULT_COMMANDS } from 'token-harness';
import { captureRun, LINUX_FIXTURE_PLATFORM, REPO_ROOT } from '../src/index.js';

for (const command of ['benchmark-prepare', 'benchmark-restore'] as const) {
  it(`golden-compares ${command} human output, JSON envelope and stream discipline`, async () => {
    const root = join(REPO_ROOT, 'tests', 'fixtures', 'benchmark-preparation-golden');
    const data = JSON.parse(readFileSync(join(root, command + '.json'), 'utf8')) as unknown;
    const options = {
      platform: LINUX_FIXTURE_PLATFORM,
      cwd: '/tmp/fixture-project',
      home: '/tmp/fixture-home',
      stateRoot: null,
      toolVersion: 'test',
      commands: {
        ...DEFAULT_COMMANDS,
        [command]: async () => commandResult({ command, exitCode: 0, data }),
      },
    };
    const argv = [command, '--benchmark-id', 'four-golden', '--variant', 'baseline'];
    const human = await captureRun({ ...options, argv });
    assert.equal(human.exitCode, 0);
    assert.equal(human.stderr, '');
    assert.equal(human.stdout, readFileSync(join(root, command + '.txt'), 'utf8'));
    for (const line of human.stdout.trimEnd().split('\n'))
      assert.ok(line.length <= 78, `terminal line too long: ${line}`);
    const json = await captureRun({ ...options, argv: [...argv, '--json'] });
    assert.equal(json.exitCode, 0);
    assert.equal(json.stderr, '');
    assert.deepEqual(JSON.parse(json.stdout), {
      schemaVersion: 1,
      command,
      toolVersion: 'test',
      status: 'ok',
      exitCode: 0,
      data,
      diagnostics: [],
    });
  });
}
