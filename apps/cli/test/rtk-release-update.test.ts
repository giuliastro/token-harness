import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, it } from 'node:test';

import { providerId, type PlatformFacts } from '@token-harness/core';
import { FakeProcessRunner, NodeFileSystem, type ReleaseFetch } from '@token-harness/platform';

import { planDirectRtkRelease } from '../src/commands/rtk-release-update.js';

const HOST: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
/** The planner's target platform; the filesystem stays the host's so canonical paths are real. */
const LINUX: PlatformFacts = { ...HOST, os: 'linux', arch: 'x64' };
const ASSET = 'rtk-x86_64-unknown-linux-musl.tar.gz';
const API = 'https://api.github.com/repos/rtk-ai/rtk/releases';

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function response(body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let read = false;
  return {
    status: 200,
    ok: true,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? String(bytes.length) : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true as const };
          read = true;
          return { done: false as const, value: bytes };
        },
      }),
    },
  };
}

/** GitHub fake: `latest` is the newest stable tag (null = unreachable); every tag has an asset. */
function github(latest: string | null): { fetch: ReleaseFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: ReleaseFetch = async (url) => {
    urls.push(url);
    if (url === `${API}/latest`) {
      if (latest === null) throw new Error('offline');
      return response({ tag_name: `v${latest}`, draft: false, prerelease: false, assets: [] });
    }
    const tag = /\/releases\/tags\/(v[^/]+)$/.exec(url)?.[1];
    if (tag === undefined) throw new Error(`unexpected URL ${url}`);
    return response({
      tag_name: tag,
      draft: false,
      prerelease: false,
      assets: [
        {
          name: ASSET,
          browser_download_url: `https://github.com/rtk-ai/rtk/releases/download/${tag}/${ASSET}`,
          content_type: 'application/gzip',
          size: 1024,
          digest: `sha256:${'a'.repeat(64)}`,
        },
      ],
    });
  };
  return { fetch, urls };
}

async function plan(installed: string, latest: string | null, withExecutable = true) {
  const root = await mkdtemp(join(tmpdir(), 'th-rtk-plan-'));
  sandboxes.push(root);
  const path = join(root, 'rtk');
  await writeFile(path, 'rtk fixture', { mode: 0o755 });
  const remote = github(latest);
  const result = await planDirectRtkRelease({
    providerId: providerId('rtk'),
    installedVersion: installed,
    executables: withExecutable ? [{ requested: 'rtk', path, kind: 'native' }] : [],
    channelAvailableVersion: null,
    platform: LINUX,
    fs: new NodeFileSystem(HOST),
    runner: new FakeProcessRunner(),
    releaseFetch: remote.fetch,
  });
  return { result, urls: remote.urls };
}

describe('direct RTK release planning', () => {
  it('targets the newest stable GitHub release beyond the reviewed version', async () => {
    const { result, urls } = await plan('0.51.0', '1.4.0');
    assert.equal(result.verdict, 'upgradable');
    assert.equal(result.availableVersion, '1.4.0');
    assert.equal(result.plan?.target, '1.4.0');
    assert.equal(result.plan?.asset.tag, 'v1.4.0');
    assert.deepEqual(urls, [`${API}/latest`, `${API}/tags/v1.4.0`]);
  });

  it('reports current when the installed RTK is already the newest release', async () => {
    const { result } = await plan('1.4.0', '1.4.0');
    assert.equal(result.verdict, 'current');
    assert.equal(result.availableVersion, '1.4.0');
    assert.ok(result.destinations.length > 0);
  });

  it('never targets below the reviewed version', async () => {
    const { result } = await plan('0.51.0', '0.50.0');
    assert.equal(result.plan?.target, '1.1.0');
  });

  it('falls back to the reviewed version when the newest release cannot be read', async () => {
    const { result } = await plan('0.51.0', null);
    assert.equal(result.verdict, 'upgradable');
    assert.equal(result.plan?.target, '1.1.0');
    assert.ok(result.diagnostics.some((entry) => entry.code === 'rtk-release-latest-unavailable'));
  });

  it('stays off the network when no RTK executable can be replaced', async () => {
    const { result, urls } = await plan('0.51.0', '1.4.0', false);
    assert.equal(result.verdict, 'unavailable');
    assert.deepEqual(urls, []);
  });
});
