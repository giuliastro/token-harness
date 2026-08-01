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

  it('publishes without a token, and says so structurally', () => {
    /**
     * PLAN §8.3, publishing and provenance. Asserted against the workflow rather than trusted to a
     * comment, because every one of these is a silent failure if it regresses.
     *
     * `id-token: write` is the whole mechanism — without it there is no OIDC token, npm has nothing
     * to verify, and the publish falls back to looking for a credential that is deliberately absent.
     */
    assert.match(
      RELEASE_CONFIG,
      /id-token: write/,
      'the release workflow cannot obtain an OIDC token',
    );

    /**
     * No token, anywhere. A `NODE_AUTH_TOKEN` or an `NPM_TOKEN` secret appearing here would mean the
     * trusted-publishing route had quietly been replaced by the one it was chosen over — and it
     * would still work, which is what makes it worth a test rather than a review.
     */
    assert.doesNotMatch(
      RELEASE_CONFIG,
      /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./,
      'the release workflow uses a token',
    );

    // With trusted publishing npm signs provenance by default; `--provenance` belongs to the
    // token-based route. Passing it is not harmless noise — it is a sign the workflow was written
    // against the other mechanism.
    assert.doesNotMatch(
      RELEASE_CONFIG,
      /--provenance/,
      'trusted publishing signs provenance without the flag',
    );

    // The tag guard runs before the publish, which is the only order that helps.
    const guard = RELEASE_CONFIG.indexOf('check-release-tag.mjs');
    const publish = RELEASE_CONFIG.indexOf('npm publish');
    assert.ok(guard > 0, 'the release workflow does not check the tag against the version');
    assert.ok(publish > guard, 'the tag is checked after publishing, which is too late');
  });

  it('does not publish on the runtime floor it tests on', () => {
    /**
     * These two disagree on purpose, and the disagreement is load-bearing in both directions.
     *
     * `ci.yml` pins the RFC 0001 floor so a feature newer than the floor fails in CI rather than for
     * a user. Trusted publishing requires npm 11.5.1 and Node 22.14.0 or newer, which is above that
     * floor — so the release job runs newer and asserts the npm version rather than hoping the
     * runner's bundled one is recent enough.
     *
     * Asserted so that neither is "tidied" into matching the other later: raising the CI floor to
     * match the release job would silently drop the oldest supported runtime from the matrix.
     */
    assert.match(CI, /node-version: '22\.13\.0'/, 'CI no longer tests the RFC 0001 runtime floor');
    assert.match(
      RELEASE_CONFIG,
      /required=11\.5\.1/,
      'the release job does not assert an npm version',
    );

    /**
     * The configured value, not the string anywhere in the file.
     *
     * The first version of this asserted the floor did not appear in `release.yml` at all — and
     * failed, because the comment explaining why the floor is not used names it. An assertion that
     * forbids a version from being *discussed* rather than from being *selected* is checking the
     * prose, and its failure message would send a reader looking for a configuration problem that
     * is not there.
     */
    const selected = /node-version: '([^']+)'/.exec(RELEASE_CONFIG)?.[1];
    assert.ok(selected !== undefined, 'the release job pins no Node version');
    assert.notEqual(selected, '22.13.0', 'the release job cannot publish on the RFC 0001 floor');
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
