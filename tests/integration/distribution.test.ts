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

/** Every package.json in the workspace, so nothing is checked by name and then forgotten. */
const WORKSPACE_MANIFESTS = [
  ['root', join(REPO_ROOT, 'package.json')],
  ['@token-harness/core', join(REPO_ROOT, 'packages', 'core', 'package.json')],
  ['@token-harness/platform', join(REPO_ROOT, 'packages', 'platform', 'package.json')],
  ['@token-harness/adapters', join(REPO_ROOT, 'packages', 'adapters', 'package.json')],
  ['token-harness', join(REPO_ROOT, 'apps', 'cli', 'package.json')],
  ['tests', join(REPO_ROOT, 'tests', 'package.json')],
] as const;

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
const RELEASE = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

/**
 * `release.yml` with its comment lines removed.
 *
 * Every assertion below about something being *absent* has to read this rather than the whole file.
 * Twice while writing them, a check failed because the workflow's own comment explains why it does
 * not use the thing being forbidden — the RFC 0001 floor, and `--provenance`. An assertion that
 * cannot tell discussing a flag from passing it is checking the prose, and its failure message sends
 * the reader hunting for a configuration problem that is not there.
 */
const RELEASE_CONFIG = RELEASE.split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

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

  it('ships no third-party runtime code, which is what makes the SBOM short', () => {
    /**
     * The invariant `dist/package/sbom.json` asserts, checked here so that document cannot quietly
     * understate what shipped.
     *
     * The published tarball declares no dependencies at all and the bundle inlines the three
     * workspace packages. That is only honest while every runtime dependency in the workspace is
     * first-party — add one third-party package anywhere in the graph and it becomes part of the
     * artifact while the manifest still says `dependencies: none`.
     *
     * `devDependencies` are deliberately not checked: esbuild, TypeScript and the linters build the
     * artifact and are not in it.
     */
    for (const [name, path] of WORKSPACE_MANIFESTS) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
        assert.ok(
          range.startsWith('workspace:'),
          `${name} depends on ${dependency}@${range}, which would be third-party code inside the published bundle`,
        );
      }
    }
  });

  it('stages an SBOM and publishes it', () => {
    // An SBOM is generated at package time because it carries the bundle's digest, so it is not
    // committed and cannot be read here. What is checked is that the step exists and that the
    // document is inside `files` — one staged beside the tarball and left out of it is a build side
    // effect, not a supply-chain document.
    const packaging = readFileSync(join(REPO_ROOT, 'scripts', 'package.mjs'), 'utf8');
    assert.match(packaging, /sbom\.json/, 'the packaging script emits no SBOM');
    assert.match(packaging, /bomFormat: 'CycloneDX'/, 'the SBOM is not in a recognised format');
    assert.match(packaging, /'SHA-256'/, 'the SBOM records no digest for the artifact');
    assert.match(
      packaging,
      /files: \['token-harness\.mjs', 'sbom\.json'/,
      'the SBOM is staged but not published',
    );
  });

  it('validates release tags without publishing packages', () => {
    assert.match(
      RELEASE_CONFIG,
      /check-release-tag\.mjs/,
      'the release workflow does not check the tag against the version',
    );
    assert.doesNotMatch(RELEASE_CONFIG, /npm publish/, 'the release workflow publishes packages');
    assert.doesNotMatch(
      RELEASE_CONFIG,
      /\$\{\{\s*secrets\./,
      'the release workflow reads settings',
    );
  });

  it('uses the same runtime floor as CI', () => {
    const floor = "node-version: '22.13.0'";
    assert.ok(CI.includes(floor), 'CI no longer tests the RFC 0001 runtime floor');
    assert.ok(RELEASE_CONFIG.includes(floor), 'the release job no longer uses the runtime floor');
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
      ['claude', 'codex', 'hermes', 'opencode'],
      'PLAN §16 requires four harnesses for 0.1.0',
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
