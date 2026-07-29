/**
 * Bundles the CLI into a single self-contained ESM artifact.
 *
 * The entry point is `apps/cli/bin/token-harness.mjs` — the same launcher the
 * workspace uses — so the bundled artifact and the development binary are the
 * same program rather than two entry points that can drift.
 *
 * It bundles the *compiled* JavaScript rather than the TypeScript sources, so
 * `tsc` remains the only thing that decides what the types mean.
 *
 * esbuild is a pragmatic choice, not a settled one: PLAN §17.2 keeps "bundler
 * and executable packaging beyond npm" open. It is a dev dependency with no
 * runtime footprint in the artifact, so replacing it changes this file alone.
 */

import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repoRoot, 'apps', 'cli', 'bin', 'token-harness.mjs');
const outfile = join(repoRoot, 'dist', 'bundle', 'token-harness.mjs');

mkdirSync(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.13',
  // Everything in the workspace is inlined; only Node built-ins stay external,
  // so the artifact runs with no `node_modules` beside it.
  packages: 'bundle',
  external: ['node:*'],
  metafile: true,
  logLevel: 'warning',
});

try {
  chmodSync(outfile, 0o755);
} catch {
  // Windows has no executable bit; the launcher is invoked through `node`.
}

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`bundled ${outfile} (${bytes} bytes)`);
