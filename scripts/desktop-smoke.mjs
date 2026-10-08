import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(repoRoot, 'dist', 'desktop', 'artifacts');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
const macDirectory = readdirSync(artifacts).find(
  (name) => name === 'mac' || name === `mac-${process.arch}`,
);
const unpacked =
  process.platform === 'win32'
    ? join(artifacts, 'win-unpacked')
    : process.platform === 'darwin'
      ? join(artifacts, macDirectory ?? 'missing', 'Token Harness.app', 'Contents')
      : join(artifacts, 'linux-unpacked');
const resources = join(unpacked, process.platform === 'darwin' ? 'Resources' : 'resources');
const node = join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const cli = join(resources, 'backend', 'token-harness.mjs');
const runtime = JSON.parse(readFileSync(join(resources, 'runtime', 'runtime.json'), 'utf8'));
assert.equal(runtime.platform, process.platform, 'Node runtime must match the packaged platform');
assert.equal(runtime.arch, process.arch, 'Node runtime must match the packaged architecture');
const native = spawnSync(
  node,
  [
    '-p',
    'JSON.stringify({platform:process.platform,arch:process.arch,version:process.versions.node})',
  ],
  { encoding: 'utf8', timeout: 20_000, shell: false },
);
assert.equal(native.status, 0, native.stderr);
assert.deepEqual(JSON.parse(native.stdout), {
  platform: runtime.platform,
  arch: runtime.arch,
  version: runtime.nodeVersion,
});
assert.ok(readFileSync(join(resources, 'runtime', 'LICENSE'), 'utf8').length > 1000);
const result = spawnSync(node, [cli, '--version'], {
  encoding: 'utf8',
  timeout: 20_000,
  shell: false,
});
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), version);
console.log(`Packaged Node/CLI smoke passed: ${version} ${runtime.platform}/${runtime.arch}`);

const sandbox = mkdtempSync(join(tmpdir(), 'token-harness-desktop-smoke-'));
mkdirSync(join(sandbox, 'home'), { recursive: true });
try {
  const executable =
    process.platform === 'win32'
      ? join(unpacked, 'Token Harness.exe')
      : process.platform === 'darwin'
        ? join(unpacked, 'MacOS', 'Token Harness')
        : join(unpacked, 'token-harness-desktop');
  const smoke = spawnSync(executable, ['--desktop-smoke'], {
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, TOKEN_HARNESS_DESKTOP_SMOKE_ROOT: sandbox },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  const receipt = smoke.stdout
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((value) => value?.desktopSmoke !== undefined);
  assert.deepEqual(receipt, {
    desktopSmoke: { session: 200, dashboard: true, privileged: false },
    version,
  });
  console.log(
    'Packaged Electron renderer/backend smoke passed (isolated profile, no provider installation)',
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
