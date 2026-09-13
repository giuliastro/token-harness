import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import {
  FakeProcessRunner,
  NodeFileSystem,
  NodeRtkWindowsReleaseRuntime,
  RTK_WINDOWS_RELEASE_ASSET,
  extractRtkExeFromVerifiedZip,
  type ReleaseFetch,
} from '../src/index.js';

const FACTS: PlatformFacts = {
  os: process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function storedZip(name: string, payload: Uint8Array): Uint8Array {
  const fileName = Buffer.from(name, 'utf8');
  const content = Buffer.from(payload);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + fileName.length + content.length;
  const centralSize = central.length + fileName.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([local, fileName, content, central, fileName, eocd]));
}

function response(bytes: Uint8Array, status = 200, extraHeaders: Record<string, string> = {}) {
  let read = false;
  const headers = new Map<string, string>([
    ['content-length', String(bytes.byteLength)],
    ...Object.entries(extraHeaders).map(
      ([key, value]) => [key.toLowerCase(), value] as [string, string],
    ),
  ]);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true as const };
          read = true;
          return { done: false as const, value: bytes };
        },
        cancel: async () => undefined,
      }),
    },
  };
}

function releaseFixture(input?: { digest?: string; payload?: Uint8Array }) {
  const executable = input?.payload ?? new TextEncoder().encode('rtk 0.49 fixture');
  const archive = storedZip('rtk.exe', executable);
  const actualDigest = createHash('sha256').update(archive).digest('hex');
  const publishedDigest = input?.digest ?? actualDigest;
  const downloadUrl =
    'https://github.com/rtk-ai/rtk/releases/download/v0.49.0/rtk-x86_64-pc-windows-msvc.zip';
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      tag_name: 'v0.49.0',
      draft: false,
      prerelease: false,
      assets: [
        {
          name: RTK_WINDOWS_RELEASE_ASSET,
          browser_download_url: downloadUrl,
          content_type: 'application/zip',
          size: archive.byteLength,
          digest: `sha256:${publishedDigest}`,
        },
      ],
    }),
  );
  const fetchImpl: ReleaseFetch = async (url) => {
    if (url.includes('/releases/tags/v0.49.0')) return response(metadata);
    if (url === downloadUrl) return response(archive);
    throw new Error(`unexpected URL ${url}`);
  };
  return { executable, archive, actualDigest, downloadUrl, fetchImpl };
}

async function sandbox(): Promise<{ root: string; fs: NodeFileSystem }> {
  const root = await mkdtemp(join(tmpdir(), 'th-rtk-release-'));
  sandboxes.push(root);
  return { root, fs: new NodeFileSystem(FACTS) };
}

describe('verified RTK Windows release artifact', () => {
  it('extracts only the root rtk.exe bytes from a bounded ZIP', () => {
    const expected = new TextEncoder().encode('hello rtk');
    assert.deepEqual(extractRtkExeFromVerifiedZip(storedZip('rtk.exe', expected)), expected);
    assert.throws(
      () => extractRtkExeFromVerifiedZip(storedZip('../rtk.exe', expected)),
      /no root rtk\.exe/,
    );
  });

  it('selects the exact stable reviewed release asset and its published SHA-256', async () => {
    const fixture = releaseFixture();
    const { fs } = await sandbox();
    const runtime = new NodeRtkWindowsReleaseRuntime({
      fs,
      runner: new FakeProcessRunner(),
      fetchImpl: fixture.fetchImpl,
    });

    const result = await runtime.query('0.49.0');
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.equal(result.asset.name, RTK_WINDOWS_RELEASE_ASSET);
    assert.equal(result.asset.sha256, fixture.actualDigest);
    assert.equal(result.asset.downloadUrl, fixture.downloadUrl);
  });

  it('installs exact verified bytes, keeps a backup and can explicitly roll them back', async () => {
    const fixture = releaseFixture();
    const { root, fs } = await sandbox();
    const target = fs.join(root, 'bin', 'rtk.exe');
    const stateRoot = fs.join(root, 'state');
    const previous = new TextEncoder().encode('old rtk 0.48 fixture');
    await fs.writeFile(target, previous);

    const runner = new FakeProcessRunner()
      .expect({
        executable: target,
        args: ['--version'],
        times: 1,
        respond: { stdout: 'rtk 0.49.0\n' },
      })
      .expect({
        executable: target,
        args: ['--version'],
        times: 1,
        respond: { stdout: 'rtk 0.48.0\n' },
      });
    const runtime = new NodeRtkWindowsReleaseRuntime({ fs, runner, fetchImpl: fixture.fetchImpl });
    const query = await runtime.query('0.49.0');
    assert.equal(query.status, 'found');
    if (query.status !== 'found') return;

    const installed = await runtime.install({
      asset: query.asset,
      targetPath: target,
      previousVersion: '0.48.0',
      stateRoot,
      cwd: root,
    });
    assert.equal(installed.status, 'installed');
    if (installed.status !== 'installed') return;
    assert.deepEqual(await fs.readFile(target), fixture.executable);
    assert.deepEqual(await fs.readFile(installed.backupPath), previous);

    const rollback = await runtime.rollback(installed.handle, root);
    assert.equal(rollback.status, 'rolled-back');
    assert.deepEqual(await fs.readFile(target), previous);
    runner.assertSatisfied();
  });

  it('restores the previous executable when the new version cannot be started or verified', async () => {
    const fixture = releaseFixture();
    const { root, fs } = await sandbox();
    const target = fs.join(root, 'rtk.exe');
    const previous = new TextEncoder().encode('old rtk 0.48 fixture');
    await fs.writeFile(target, previous);

    const runner = new FakeProcessRunner()
      .expect({
        executable: target,
        args: ['--version'],
        times: 1,
        respond: { stdout: 'rtk 0.48.0\n' },
      })
      .expect({
        executable: target,
        args: ['--version'],
        times: 1,
        respond: { stdout: 'rtk 0.48.0\n' },
      });
    const runtime = new NodeRtkWindowsReleaseRuntime({ fs, runner, fetchImpl: fixture.fetchImpl });
    const query = await runtime.query('0.49.0');
    assert.equal(query.status, 'found');
    if (query.status !== 'found') return;

    const installed = await runtime.install({
      asset: query.asset,
      targetPath: target,
      previousVersion: '0.48.0',
      stateRoot: fs.join(root, 'state'),
      cwd: root,
    });
    assert.equal(installed.status, 'rolled-back');
    assert.equal(installed.code, 'rtk-release-postcondition-failed');
    assert.match(installed.message, /Smart App Control/);
    assert.deepEqual(await fs.readFile(target), previous);
    runner.assertSatisfied();
  });

  it('refuses a download whose bytes do not match GitHub published SHA-256 before mutation', async () => {
    const fixture = releaseFixture({ digest: '0'.repeat(64) });
    const { root, fs } = await sandbox();
    const target = fs.join(root, 'rtk.exe');
    const previous = new TextEncoder().encode('old rtk');
    await fs.writeFile(target, previous);

    const runtime = new NodeRtkWindowsReleaseRuntime({
      fs,
      runner: new FakeProcessRunner(),
      fetchImpl: fixture.fetchImpl,
    });
    const query = await runtime.query('0.49.0');
    assert.equal(query.status, 'found');
    if (query.status !== 'found') return;

    const installed = await runtime.install({
      asset: query.asset,
      targetPath: target,
      previousVersion: '0.48.0',
      stateRoot: fs.join(root, 'state'),
      cwd: root,
    });
    assert.equal(installed.status, 'failed');
    assert.equal(installed.code, 'rtk-release-artifact-invalid');
    assert.deepEqual(await fs.readFile(target), previous);
  });
});
