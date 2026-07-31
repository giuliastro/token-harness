/**
 * Module boundaries — PLAN §1.1.
 *
 * "Internal module layout inside those packages mirrors the logical boundaries —
 * domain, planner, state, metrics under `core`; harnesses and providers under
 * `adapters` — enforced by import rules rather than by workspace packages."
 *
 * The rules are enforced here as a test rather than only as a lint rule, because
 * a lint rule can be skipped and this cannot: `pnpm test` is a release gate.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT } from '../src/index.js';

const SOURCE_ROOTS = [
  join(REPO_ROOT, 'packages', 'core', 'src'),
  join(REPO_ROOT, 'packages', 'platform', 'src'),
  join(REPO_ROOT, 'packages', 'adapters', 'src'),
  join(REPO_ROOT, 'apps', 'cli', 'src'),
];

const TEST_ROOTS = [
  join(REPO_ROOT, 'packages', 'core', 'test'),
  join(REPO_ROOT, 'packages', 'platform', 'test'),
  join(REPO_ROOT, 'packages', 'adapters', 'test'),
  join(REPO_ROOT, 'apps', 'cli', 'test'),
  join(REPO_ROOT, 'tests', 'integration'),
  join(REPO_ROOT, 'tests', 'src'),
];

interface SourceFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  imports: string[];
  text: string;
}

function listTypeScript(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTypeScript(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_PATTERN = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function readSources(roots: readonly string[]): SourceFile[] {
  const files: SourceFile[] = [];
  for (const root of roots) {
    for (const file of listTypeScript(root)) {
      const text = readFileSync(file, 'utf8');
      const imports = new Set<string>();
      for (const match of text.matchAll(IMPORT_PATTERN)) imports.add(match[1] as string);
      for (const match of text.matchAll(BARE_IMPORT_PATTERN)) imports.add(match[1] as string);
      files.push({
        path: relative(REPO_ROOT, file).split(sep).join('/'),
        imports: [...imports],
        text,
      });
    }
  }
  return files;
}

const SOURCES = readSources(SOURCE_ROOTS);
const TESTS = readSources(TEST_ROOTS);

function inPackage(file: SourceFile, prefix: string): boolean {
  return file.path.startsWith(prefix);
}

/**
 * Layers inside `core`. A module may import its own directory or a strictly
 * lower layer, never a higher one.
 *
 * `envelope` sits above `metrics` because its parsers validate metrics
 * documents; nothing in `metrics` knows the envelope exists. `state` and
 * `planner` are listed although they do not exist yet, so the rule is already in
 * place when Phase 2 adds them.
 */
const CORE_LAYERS: Record<string, number> = {
  domain: 0,
  metrics: 1,
  envelope: 2,
  planner: 3,
  state: 3,
};

function coreLayerOf(path: string): { name: string; rank: number } | null {
  const match = /^packages\/core\/src\/([^/]+)\//.exec(path);
  const name = match?.[1];
  if (name === undefined) return null;
  const rank = CORE_LAYERS[name];
  return rank === undefined ? null : { name, rank };
}

function resolveRelative(fromPath: string, specifier: string): string {
  const segments = fromPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

describe('module boundaries', () => {
  it('finds the source tree', () => {
    assert.ok(SOURCES.length > 10, `expected a populated source tree, found ${SOURCES.length}`);
  });

  it('core never imports adapters or the cli', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/core/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          !specifier.startsWith('@token-harness/adapters') && specifier !== 'token-harness',
          `${file.path} imports ${specifier}`,
        );
      }
    }
  });

  it('core contains no filesystem or process implementation', () => {
    // PLAN §1.2 acceptance: "domain objects contain no filesystem or process
    // implementation". Applied to the whole package, not only `domain/`, because
    // the planner and the metrics report have the same obligation.
    const forbidden = [
      'node:fs',
      'node:fs/promises',
      'node:child_process',
      'node:os',
      'node:path',
      'node:process',
      'fs',
      'child_process',
      'os',
      'path',
      'process',
    ];
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/core/'))) {
      for (const specifier of file.imports) {
        assert.ok(!forbidden.includes(specifier), `${file.path} imports ${specifier}`);
      }
    }
  });

  /**
   * The list above forbids the operating system by name, which left every other Node
   * built-in silently allowed. PLAN §15 issue 6 needed exactly one of them —
   * `node:crypto`, for the digests RFC 0004 §Ownership and RFC 0006 §Plan persistence
   * both require — so the permission is stated positively instead of resting on a
   * gap. Hashing is arithmetic; the rule is about the machine.
   */
  it('core imports no Node built-in except node:crypto', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/core/'))) {
      for (const specifier of file.imports) {
        if (!specifier.startsWith('node:')) continue;
        assert.equal(
          specifier,
          'node:crypto',
          `${file.path} imports ${specifier}; core reaches the platform through a port, not directly`,
        );
      }
    }
  });

  /**
   * The Phase 2 decision, enforced rather than described.
   *
   * RFC 0001 §Repository shape lists neither `platform` nor `process` under `core`,
   * and the rule above forbids `node:fs`, `node:os`, `node:path`,
   * `node:child_process`, and `node:process` across the whole of `core`. The
   * platform layer cannot satisfy both, so RFC 0001's own extraction rule applies —
   * "a package is extracted when a concrete consumer appears" — and
   * `packages/platform` is that extraction. The consumers are the PLAN §2.3
   * executor, the Phase 3 adapters, and `apps/cli`.
   *
   * The rule for `core` is therefore *unchanged*: relaxing it was the alternative,
   * and it was rejected because a rule that admits exceptions can no longer tell an
   * intended `node:fs` from an accidental one.
   */
  it('core never imports the platform layer, so the dependency direction stays acyclic', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/core/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          !specifier.startsWith('@token-harness/platform') && !specifier.includes('/platform/src'),
          `${file.path} imports ${specifier}; core is below platform, not above it`,
        );
      }
    }
  });

  it('platform imports neither adapters nor the cli', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/platform/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          !specifier.startsWith('@token-harness/adapters') && specifier !== 'token-harness',
          `${file.path} imports ${specifier}`,
        );
      }
    }
  });

  it('platform reaches core only through its package entry point', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/platform/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          !specifier.startsWith('@token-harness/core/'),
          `${file.path} deep-imports core: ${specifier}`,
        );
        assert.ok(
          !specifier.includes('../core'),
          `${file.path} reaches into core by relative path: ${specifier}`,
        );
      }
    }
  });

  it('adapters and the cli reach platform only through its package entry point', () => {
    for (const file of SOURCES.filter(
      (f) => inPackage(f, 'packages/adapters/') || inPackage(f, 'apps/cli/'),
    )) {
      for (const specifier of file.imports) {
        assert.ok(
          !specifier.startsWith('@token-harness/platform/'),
          `${file.path} deep-imports platform: ${specifier}`,
        );
        assert.ok(
          !specifier.includes('../platform'),
          `${file.path} reaches into platform by relative path: ${specifier}`,
        );
      }
    }
  });

  /**
   * RFC 0004 §Process policy is a safety invariant, and an invariant that lives in
   * one file can be verified by reading one file. The `icacls` call RFC 0004 §State
   * directory permissions requires goes "through the process runner" because there
   * is nowhere else for it to go.
   */
  it('only the process runner can spawn', () => {
    const allowed = new Set(['packages/platform/src/process/node-runner.ts']);
    for (const file of SOURCES) {
      if (allowed.has(file.path)) continue;
      for (const specifier of file.imports) {
        assert.ok(
          specifier !== 'node:child_process' && specifier !== 'child_process',
          `${file.path} imports ${specifier}; spawning belongs to NodeProcessRunner`,
        );
      }
    }
  });

  /**
   * The SQLite driver must load in a child process and nowhere else.
   *
   * RFC 0001 and RFC 0005 rejected `node:sqlite` because importing it emits
   * `ExperimentalWarning` on stderr, and RFC 0006 permits nothing on stderr in
   * `--json` mode. Reading a provider's database in a child spawned with
   * `--no-warnings` answers that objection — but only while the driver stays out of
   * the parent. An import added anywhere else would reintroduce the warning on the
   * user's terminal, and it would do so silently, in whichever command happened to
   * load the module first.
   *
   * The rule is stated positively, like the `node:crypto` permission above, because
   * the value here is the *single* location and not the absence of a bad one.
   */
  it('only the database reader child imports node:sqlite', () => {
    const READER = 'packages/platform/src/metrics/sqlite-child.ts';
    // `file.imports` only carries static `import … from` specifiers, and the reader's import
    // is deliberately dynamic — a static one would be hoisted into the parent by the
    // bundler, which is the failure this whole arrangement exists to avoid. Matching both
    // forms is what keeps the rule from passing because it found nothing to check.
    const dynamic = /\bimport\s*\(\s*['"]node:sqlite['"]\s*\)/;
    const importsDriver = (file: (typeof SOURCES)[number]): boolean =>
      file.imports.includes('node:sqlite') || dynamic.test(file.text);

    const importers = SOURCES.filter(importsDriver).map((file) => file.path);
    assert.deepEqual(
      importers,
      [READER],
      'the SQLite driver belongs to the reader child, which runs with --no-warnings, and to nothing else',
    );
  });

  /**
   * AGENTS.md and PLAN §2.1 acceptance: "no test reads or writes the developer's
   * actual home."
   *
   * The three names below are the only ways to reach it: `homedir` returns it, and
   * `nodeSystemProbe`/`resolveHostEnvironment` are the composition roots that call
   * `homedir` for you. A test that needs platform facts builds its own probe, which
   * is why the probe is an interface.
   */
  it('no test can reach the real home directory', () => {
    const forbidden = ['homedir', 'nodeSystemProbe', 'resolveHostEnvironment'];
    // This file names all three in order to forbid them.
    for (const file of TESTS.filter((f) => f.path !== 'tests/integration/architecture.test.ts')) {
      for (const name of forbidden) {
        assert.ok(
          !new RegExp(`\\b${name}\\b`).test(file.text),
          `${file.path} references ${name}; build a SystemProbe fixture instead`,
        );
      }
    }
  });

  it('core layers only import strictly lower layers', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/core/src/'))) {
      const from = coreLayerOf(file.path);
      if (from === null) continue;
      for (const specifier of file.imports) {
        if (!specifier.startsWith('.')) continue;
        const target = coreLayerOf(`${resolveRelative(file.path, specifier)}`);
        if (target === null) continue;
        if (target.name === from.name) continue;
        assert.ok(
          target.rank < from.rank,
          `${file.path} (layer ${from.name}) imports ${specifier} (layer ${target.name})`,
        );
      }
    }
  });

  it('adapters reach core only through its package entry point', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/adapters/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          specifier !== '@token-harness/core/src' && !specifier.startsWith('@token-harness/core/'),
          `${file.path} deep-imports core: ${specifier}`,
        );
        assert.ok(
          !specifier.includes('../../core'),
          `${file.path} reaches into core by relative path: ${specifier}`,
        );
      }
    }
  });

  it('the two adapter registries do not import each other', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'packages/adapters/src/'))) {
      const isHarness = file.path.startsWith('packages/adapters/src/harnesses/');
      const isProvider = file.path.startsWith('packages/adapters/src/providers/');
      if (!isHarness && !isProvider) continue;
      for (const specifier of file.imports) {
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveRelative(file.path, specifier);
        assert.ok(
          !(isHarness && resolved.includes('/providers/')),
          `${file.path} imports a provider module: ${specifier}`,
        );
        assert.ok(
          !(isProvider && resolved.includes('/harnesses/')),
          `${file.path} imports a harness module: ${specifier}`,
        );
      }
    }
  });

  it('the cli reaches core and adapters only through their entry points', () => {
    for (const file of SOURCES.filter((f) => inPackage(f, 'apps/cli/'))) {
      for (const specifier of file.imports) {
        assert.ok(
          !/^@token-harness\/(core|adapters)\//.test(specifier),
          `${file.path} deep-imports a workspace package: ${specifier}`,
        );
      }
    }
  });

  it('only the cli entry point touches the process or the operating system', () => {
    const allowed = new Set(['apps/cli/src/main.ts']);
    const forbidden = ['node:os', 'node:process', 'node:child_process', 'node:fs'];
    for (const file of SOURCES.filter((f) => inPackage(f, 'apps/cli/'))) {
      if (allowed.has(file.path)) continue;
      for (const specifier of file.imports) {
        assert.ok(!forbidden.includes(specifier), `${file.path} imports ${specifier}`);
      }
    }
  });

  it('every relative import carries an explicit .js extension', () => {
    for (const file of SOURCES) {
      for (const specifier of file.imports) {
        if (!specifier.startsWith('.')) continue;
        assert.ok(specifier.endsWith('.js'), `${file.path} imports ${specifier} without .js`);
      }
    }
  });
});
