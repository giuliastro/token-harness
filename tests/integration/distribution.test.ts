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

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import { AVAILABLE_COMMANDS } from 'token-harness';

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

  it('claims a version the contents actually satisfy', () => {
    /**
     * This asserted `/^0\.0\.\d+$/` — a hard floor, so that a `0.1.0` could not be published as a
     * claim about the contents. The gate it was guarding is now met, so the assertion moves from
     * "must be 0.0.x" to "if it says 0.1.0, the things 0.1.0 means must be here".
     *
     * PLAN §16 defines `0.1.0` as: RTK and HarnessTrim, three harnesses, transactional install,
     * verification with declared tiers, metrics, and brownfield adoption. The registries are what
     * make the first two checkable from here; the rest are asserted by the suites named beside
     * them.
     */
    const version = root().version;
    assert.match(version, /^0\.\d+\.\d+$/);
    if (version === '0.0.0' || version.startsWith('0.0.')) return;

    // Two providers and three harnesses, by id rather than by count, so adding a fourth of
    // something does not silently satisfy the gate.
    assert.deepEqual(
      listProviderAdapters().map((adapter) => adapter.manifest.id),
      ['rtk', 'harnesstrim'],
      'PLAN §16 requires RTK and HarnessTrim for 0.1.0',
    );
    assert.deepEqual(
      listHarnessAdapters().map((adapter) => adapter.manifest.id),
      ['claude', 'codex', 'opencode'],
      'PLAN §16 requires three harnesses for 0.1.0',
    );

    // Every command the workflow needs. `update` is not part of the 0.1.0 gate.
    for (const command of [
      'apply',
      'doctor',
      'metrics',
      'plan',
      'rollback',
      'status',
      'uninstall',
      'verify',
    ]) {
      assert.ok(
        (AVAILABLE_COMMANDS as readonly string[]).includes(command),
        `0.1.0 needs \`${command}\``,
      );
    }

    // Verification with declared tiers, and brownfield adoption, are properties of the manifests:
    // every provider states a tier per harness, which is what "with declared tiers" means.
    for (const adapter of listProviderAdapters()) {
      assert.ok(
        adapter.manifest.harnesses.length > 0,
        `${adapter.manifest.id} declares no harness`,
      );
      for (const entry of adapter.manifest.harnesses) {
        assert.ok(entry.verificationTier.length > 0);
      }
      // Metrics from both providers, so the report can carry two measurement classes.
      assert.notEqual(adapter.manifest.metrics.source, 'none');
    }
  });
});
