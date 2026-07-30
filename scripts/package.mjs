/**
 * Stages the publishable package — PLAN §8.3, first bullet.
 *
 * ## Why the manifest is generated rather than hand-maintained
 *
 * `apps/cli/package.json` cannot be the published manifest. It depends on
 * `@token-harness/core`, `@token-harness/platform`, and `@token-harness/adapters`
 * through the `workspace:` protocol, which npm rejects outright with
 * `EUNSUPPORTEDPROTOCOL`, and those three packages are private. Publishing it would
 * produce a tarball nobody could install — which is why
 * `apps/cli/test/packaging.test.ts` has been failing that combination since Phase 1.
 *
 * There are two ways out, and that test names both: "publish the bundled artifact
 * with no runtime dependencies, or publish the workspace packages too." This takes
 * the first. `pnpm build` already inlines the whole workspace into one
 * self-contained ESM file, so the published package is that file plus a manifest
 * describing it, and it has **no dependencies at all** — nothing to resolve, nothing
 * to go stale, no version skew between four packages.
 *
 * The cost is that the published manifest is generated. That is mitigated by
 * `packaging.test.ts` asserting its shape, and by `scripts/smoke-install.mjs`
 * packing it, installing the tarball, and running the result.
 *
 * What is deliberately *not* published: a library entry point. `apps/cli` exports
 * `run()` for the test suite, but a consumer importing it would need the three
 * private packages. A CLI is what this artifact is, so `bin` is the only entry it
 * declares. Exporting an API is a `1.0` concern, alongside the provider and harness
 * SDKs RFC 0001 §Repository shape defers.
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(repoRoot, 'dist', 'bundle', 'token-harness.mjs');
const outDir = join(repoRoot, 'dist', 'package');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const root = readJson(join(repoRoot, 'package.json'));
const cli = readJson(join(repoRoot, 'apps', 'cli', 'package.json'));

try {
  statSync(bundle);
} catch {
  console.error(`missing ${bundle}\nRun \`pnpm build\` first.`);
  process.exit(1);
}

// The version comes from one place. `apps/cli/test/version.test.ts` already ties the
// compiled-in `TOOL_VERSION` to `apps/cli/package.json`, so a published artifact whose
// `--version` disagreed with its manifest would have to get past that test first.
if (root.version !== cli.version) {
  console.error(`version skew: root is ${root.version}, apps/cli is ${cli.version}`);
  process.exit(1);
}

const manifest = {
  name: cli.name,
  version: cli.version,
  description: cli.description,
  license: root.license,
  type: 'module',
  engines: root.engines,
  bin: { 'token-harness': './token-harness.mjs' },
  files: ['token-harness.mjs', 'README.md', 'LICENSE'],
  repository: {
    type: 'git',
    url: 'git+https://github.com/giuliastro/token-harness.git',
  },
  homepage: 'https://github.com/giuliastro/token-harness#readme',
  bugs: { url: 'https://github.com/giuliastro/token-harness/issues' },
  keywords: ['tokens', 'llm', 'coding-agent', 'claude-code', 'codex', 'opencode', 'cli'],
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
copyFileSync(bundle, join(outDir, 'token-harness.mjs'));
for (const name of ['README.md', 'LICENSE']) {
  copyFileSync(join(repoRoot, name), join(outDir, name));
}

console.log(`staged ${manifest.name}@${manifest.version} in ${outDir}`);
console.log(`  bin          ${manifest.bin['token-harness']}`);
console.log(`  dependencies none`);
