/**
 * Distribution — PLAN §8.3.
 *
 * `apps/cli/test/packaging.test.ts` asserts the *policy*: the workspace CLI package
 * stays private while it carries `workspace:` dependencies npm cannot resolve. This
 * file asserts that the way out of that policy exists and is wired into CI, because
 * the way out is a build step and a build step nobody runs is not a guarantee.
 *
 * The real proof that the package installs is `pnpm smoke:install`, which packs the
 * staged directory, installs the tarball with no workspace above it, and runs what
 * came out. That cannot be asserted from inside the test suite — it needs a built
 * bundle — so what is asserted here is that the gate is declared and that CI runs it
 * on every platform.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT } from '../src/index.js';

interface RootManifest {
  version: string;
  scripts: Record<string, string>;
}

function root(): RootManifest {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as RootManifest;
}

function cliVersion(): string {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

const CI = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('distribution', () => {
  it('declares the staging and install-check steps', () => {
    const scripts = root().scripts;
    assert.ok('package' in scripts, 'no `package` script to stage the publishable tree');
    assert.ok('smoke:install' in scripts, 'no `smoke:install` script to prove it installs');
  });

  it('runs the install check in CI, on every platform in the matrix', () => {
    // The matrix is one job definition across three operating systems, so a step in it
    // runs on all three. A package that installs on Linux and not on Windows is the
    // failure this project was set up to catch early (PLAN §1.1).
    assert.match(CI, /pnpm package/, 'CI does not stage the package');
    assert.match(CI, /pnpm smoke:install/, 'CI does not verify the package installs');
    assert.match(CI, /windows-latest, macos-latest, ubuntu-latest/, 'the matrix changed');
  });

  it('keeps the published version and the compiled-in version in one place', () => {
    // `scripts/package.mjs` refuses to stage a tree whose root and CLI versions
    // disagree, and `apps/cli/test/version.test.ts` ties the CLI manifest to
    // `TOOL_VERSION`. Together those make `--version` on an installed artifact the same
    // string as the manifest it came from; this asserts the first link.
    assert.equal(root().version, cliVersion());
  });

  it('is versioned in the 0.0.x band the release gates describe', () => {
    // PLAN §16: "`0.0.x` — Internal architecture and fixtures. No stability promise."
    // `0.1.0` is defined there as RTK + HarnessTrim, three harnesses, transactional
    // install, verification with declared tiers, metrics, and brownfield adoption. None
    // of that exists yet, so publishing a `0.1.0` would be a claim about the contents
    // rather than a number.
    assert.match(root().version, /^0\.0\.\d+$/, 'a 0.1.0 must satisfy the PLAN §16 gate first');
  });
});
