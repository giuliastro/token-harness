import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// dist/test/ -> package root
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

interface Manifest {
  name: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as Manifest;
}

/**
 * Distribution is Phase 8.3 (PLAN §8.3), and PLAN §17.2 keeps executable
 * packaging beyond npm an open decision. Until both are settled the package is
 * private — not as a formality, but because publishing it today would produce a
 * tarball nobody can install.
 *
 * The reason is mechanical: `dist/src` imports `@token-harness/core` and
 * `@token-harness/adapters`, which are private workspace packages, and the
 * dependency ranges use the `workspace:` protocol that npm rejects outright with
 * EUNSUPPORTEDPROTOCOL.
 *
 * This test is written so it invalidates itself. Whoever removes `private` in
 * Phase 8.3 is forced by a failing assertion to resolve the dependency question
 * at the same time, rather than discovering it from a user's install log.
 */
describe('packaging', () => {
  it('is either private or free of workspace-protocol dependencies', () => {
    const pkg = manifest();
    if (pkg.private === true) return;

    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      assert.ok(
        !range.startsWith('workspace:'),
        `token-harness is publishable but depends on ${name}@${range}; npm rejects the workspace protocol. ` +
          'Publish the bundled artifact with no runtime dependencies, or publish the workspace packages too.',
      );
    }
  });

  it('declares a bin that is included in the published files', () => {
    const pkg = manifest();
    const binPath = pkg.bin?.['token-harness'];
    assert.ok(binPath !== undefined, 'the package must declare a token-harness bin');
    const included = (pkg.files ?? []).some((entry) => binPath.replace('./', '').startsWith(entry));
    assert.ok(included, `${binPath} is not covered by the files array`);
  });
});
