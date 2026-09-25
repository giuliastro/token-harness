import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import {
  createExecutableResolver,
  detectPlatform,
  NodeFileSystem,
  nodeExecutableProbe,
  NodeProcessRunner,
  NodeRtkReleaseRuntime,
  type SystemProbe,
} from '../src/index.js';

const LIVE_RELEASE_TEST =
  process.platform === 'win32' && process.env['TOKEN_HARNESS_LIVE_RTK_RELEASE'] === '1';

function liveWindowsProbe(root: string): SystemProbe {
  return {
    platform: 'win32',
    arch: 'x64',
    release: '10.0.26100',
    version: 'Windows 11',
    nodeVersion: process.versions.node,
    env: {
      SystemRoot: process.env['SystemRoot'],
      windir: process.env['windir'],
      COMSPEC: process.env['COMSPEC'],
      Path: process.env['Path'] ?? process.env['PATH'],
      PATHEXT: process.env['PATHEXT'],
      TEMP: process.env['TEMP'],
      TMP: process.env['TMP'],
    },
    homeDirectory: root,
    temporaryDirectory: tmpdir(),
    readTextFile: () => null,
  };
}

test(
  'downloads, installs, starts and rolls back the reviewed RTK Windows release',
  { skip: !LIVE_RELEASE_TEST },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'th-rtk-release-live-'));
    try {
      const probe = liveWindowsProbe(root);
      const detection = detectPlatform(probe);
      assert.equal(detection.ok, true, 'the bounded Windows probe must resolve platform facts');
      if (!detection.ok) return;

      const fs = new NodeFileSystem(detection.facts);
      const resolve = createExecutableResolver({
        facts: detection.facts,
        env: probe.env,
        cwd: root,
        probe: nodeExecutableProbe(),
      });
      const runner = new NodeProcessRunner({
        facts: detection.facts,
        env: probe.env,
        resolve,
      });
      const target = fs.join(root, 'rtk.exe');
      const previous = new TextEncoder().encode('token-harness previous RTK fixture');
      await fs.writeFile(target, previous);

      const runtime = new NodeRtkReleaseRuntime({ fs, runner });
      const query = await runtime.query('0.49.0', detection.facts);
      assert.equal(
        query.status,
        'found',
        query.status === 'found' ? undefined : `live release query failed: ${query.message}`,
      );
      if (query.status !== 'found') return;

      const installed = await runtime.install({
        asset: query.asset,
        targetPath: target,
        previousVersion: null,
        stateRoot: fs.join(root, 'state'),
        cwd: root,
      });
      assert.equal(
        installed.status,
        'installed',
        installed.status === 'installed'
          ? undefined
          : `live release install failed: ${installed.message}`,
      );
      if (installed.status !== 'installed') return;

      const verification = await runner.run({
        executable: target,
        args: ['--version'],
        cwd: root,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      });
      assert.equal(verification.failure, null);
      assert.equal(verification.exitCode, 0);
      assert.match(`${verification.stdout}\n${verification.stderr}`, /(?:^|\s)v?0\.49\.0(?:\s|$)/m);

      const rollback = await runtime.rollback(installed.handle, root);
      assert.equal(rollback.status, 'rolled-back');
      assert.deepEqual(await fs.readFile(target), previous);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
