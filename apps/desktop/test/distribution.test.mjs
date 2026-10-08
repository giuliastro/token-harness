import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { stageDesktop } from '../../../scripts/desktop-stage.mjs';
import {
  collectDesktopArtifacts,
  desktopArtifactNames,
} from '../../../scripts/desktop-release.mjs';

const repo = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const version = '0.1.30';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'th-desktop-package-'));
  for (const path of ['dist/package', 'apps/desktop/dist/src', 'runtime'])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ version, license: 'Apache-2.0', devDependencies: { electron: '44.5.1' } }),
  );
  writeFileSync(
    join(root, 'dist/package/package.json'),
    JSON.stringify({ name: 'token-harness', version, description: 'fixture' }),
  );
  writeFileSync(join(root, 'dist/package/token-harness.mjs'), 'console.log("fixture CLI");');
  writeFileSync(join(root, 'LICENSE'), 'first-party license');
  writeFileSync(join(root, 'runtime/LICENSE'), 'upstream Node license');
  writeFileSync(join(root, 'runtime/node'), 'fixture runtime bytes');
  writeFileSync(join(root, 'apps/desktop/dist/src/main.js'), 'console.log("fixture desktop");');
  writeFileSync(
    join(root, 'apps/desktop/electron-builder.json'),
    readFileSync(join(repo, 'apps/desktop/electron-builder.json')),
  );
  return root;
}

describe('desktop staging', () => {
  for (const platform of ['win32', 'darwin', 'linux'])
    it(`ships identical CLI/runtime bytes and upstream license on ${platform}`, async () => {
      const root = fixture();
      try {
        await stageDesktop({
          repoRoot: root,
          nodeExecutable: join(root, 'runtime/node'),
          nodeLicense: join(root, 'runtime/LICENSE'),
          platform,
          arch: 'x64',
          nodeVersion: '24.13.0',
        });
        const resources = join(root, 'dist/desktop/resources');
        assert.deepEqual(
          readFileSync(join(resources, 'backend/token-harness.mjs')),
          readFileSync(join(root, 'dist/package/token-harness.mjs')),
        );
        assert.deepEqual(
          readFileSync(join(resources, 'runtime', platform === 'win32' ? 'node.exe' : 'node')),
          readFileSync(join(root, 'runtime/node')),
        );
        assert.equal(
          readFileSync(join(resources, 'runtime/LICENSE'), 'utf8'),
          'upstream Node license',
        );
        assert.equal(
          JSON.parse(readFileSync(join(resources, 'backend/package.json'), 'utf8'))
            .tokenHarnessDistribution,
          'desktop',
        );
        assert.equal(
          JSON.parse(readFileSync(join(root, 'dist/desktop/app/package.json'), 'utf8')).version,
          version,
        );
        assert.deepEqual(
          JSON.parse(readFileSync(join(resources, 'runtime/runtime.json'), 'utf8')),
          { nodeVersion: '24.13.0', platform, arch: 'x64' },
        );
        assert.equal(
          JSON.parse(readFileSync(join(root, 'dist/desktop/electron-builder.json'), 'utf8'))
            .electronVersion,
          '44.5.1',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  it('refuses unsupported runtimes, targets and version skew before staging', async () => {
    const root = fixture();
    try {
      const options = {
        repoRoot: root,
        nodeExecutable: join(root, 'runtime/node'),
        nodeLicense: join(root, 'runtime/LICENSE'),
      };
      await assert.rejects(stageDesktop({ ...options, nodeVersion: '22.12.0' }), /22.13/);
      await assert.rejects(stageDesktop({ ...options, arch: 'ia32' }), /Unsupported/);
      await assert.rejects(stageDesktop({ ...options, platform: 'freebsd' }), /Unsupported/);
      writeFileSync(join(root, 'dist/package/package.json'), JSON.stringify({ version: '0.1.29' }));
      await assert.rejects(stageDesktop(options), /versions disagree/);
      assert.equal(existsSync(join(root, 'dist/desktop')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('complete desktop release set', () => {
  it('publishes exactly seven native packages plus deterministic SHA-256 checksums', () => {
    const root = mkdtempSync(join(tmpdir(), 'th-desktop-assets-'));
    try {
      const names = desktopArtifactNames(version);
      assert.equal(names.length, 7);
      assert.ok(names.some((name) => name.endsWith('windows-x64-setup.exe')));
      for (const arch of ['x64', 'arm64'])
        assert.ok(names.includes(`token-harness-${version}-macos-${arch}.dmg`));
      for (const name of names) writeFileSync(join(root, name), name);
      writeFileSync(join(root, 'unrelated.exe'), 'do not publish');
      const assets = collectDesktopArtifacts(root, `v${version}`);
      assert.deepEqual(
        assets.slice(0, -1),
        names.map((name) => join(root, name)),
      );
      const checksums = readFileSync(assets.at(-1), 'utf8');
      assert.equal(
        checksums,
        names
          .map((name) => `${createHash('sha256').update(name).digest('hex')}  ${name}`)
          .join('\n') + '\n',
      );
      assert.deepEqual(
        collectDesktopArtifacts(root, `v${version}`),
        assets,
        'same-tag recovery uses the same names',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('refuses partial or wrong-tag sets before producing a checksum/upload manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'th-desktop-incomplete-'));
    try {
      for (const name of desktopArtifactNames(version).slice(0, -1))
        writeFileSync(join(root, name), 'fixture');
      assert.throws(() => collectDesktopArtifacts(root, `v${version}`));
      assert.equal(
        existsSync(join(root, `token-harness-${version}-desktop-SHA256SUMS.txt`)),
        false,
      );
      for (const tag of ['main', 'v../other', `v${version}\n`, 'v0.1.29'])
        assert.throws(() => collectDesktopArtifacts(root, tag));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('gates the existing release workflow on native build success and keeps PR builds read-only', () => {
    const release = readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8');
    const desktop = readFileSync(join(repo, '.github/workflows/desktop.yml'), 'utf8');
    assert.match(release, /uses: \.\/\.github\/workflows\/desktop.yml/);
    assert.match(release, /verify:[\s\S]*?needs: desktop/);
    assert.ok(
      release.indexOf('desktop-release.mjs "$RELEASE_TAG" --check') <
        release.indexOf('run: npm publish'),
      'complete asset coverage is checked before publication',
    );
    assert.match(release, /if: needs.desktop.outputs.enabled == 'true'/);
    assert.match(
      desktop,
      /fs.existsSync\('apps\/desktop\/package.json'\)/,
      'historical tag recovery must inspect the immutable source',
    );
    assert.match(release, /release-tag: \$\{\{ inputs.tag \|\| github.ref_name \}\}/);
    assert.match(release, /pattern: token-harness-desktop-\*/);
    assert.match(release, /desktop-release.mjs "\$RELEASE_TAG"/);
    assert.match(desktop, /permissions:\s*\n\s*contents: read/);
    assert.doesNotMatch(desktop, /contents: write|GH_TOKEN|secrets\.|release:\s*\n/);
    for (const target of ['windows-latest', 'ubuntu-22.04', 'macos-15-intel', 'macos-15'])
      assert.ok(desktop.includes(target));
    assert.match(desktop, /--publish never/);
    assert.match(desktop, /pnpm desktop:smoke/);
    assert.match(desktop, /check-release-tag.mjs "\$RELEASE_TAG"/);
  });
});
