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
  join(REPO_ROOT, 'packages', 'adapters', 'src'),
  join(REPO_ROOT, 'apps', 'cli', 'src'),
];

interface SourceFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  imports: string[];
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

function readSources(): SourceFile[] {
  const files: SourceFile[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of listTypeScript(root)) {
      const text = readFileSync(file, 'utf8');
      const imports = new Set<string>();
      for (const match of text.matchAll(IMPORT_PATTERN)) imports.add(match[1] as string);
      for (const match of text.matchAll(BARE_IMPORT_PATTERN)) imports.add(match[1] as string);
      files.push({
        path: relative(REPO_ROOT, file).split(sep).join('/'),
        imports: [...imports],
      });
    }
  }
  return files;
}

const SOURCES = readSources();

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
