/**
 * Fixture loading.
 *
 * Every path is resolved relative to this compiled module, never from the
 * process working directory and never from the developer's home. `dist/src/` is
 * two levels below the package root, which is where `fixtures/` lives.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURES_ROOT = fileURLToPath(new URL('../../fixtures/', import.meta.url));
export const GOLDEN_ROOT = fileURLToPath(new URL('../../fixtures/golden/', import.meta.url));
export const CLI_ROOT = fileURLToPath(new URL('../../fixtures/cli/', import.meta.url));
export const BENCHMARK_ROOT = fileURLToPath(new URL('../../fixtures/benchmarks/', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface ScenarioRoots {
  home: string | null;
  stateRoot: string | null;
  projectRoot: string | null;
}

export interface GoldenScenario {
  name: string;
  title: string;
  /** Provenance: an RFC section, or `project-local` when no RFC pins it. */
  source: string;
  command: string;
  /** False when the command itself does not exist in this build. */
  commandImplemented?: boolean;
  note?: string;
  roots: ScenarioRoots;
  toolVersion: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function listGoldenScenarios(): string[] {
  return readdirSync(GOLDEN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export interface LoadedGolden {
  scenario: GoldenScenario;
  result: { command: string; exitCode: number; data: unknown; diagnostics: unknown[] };
  expectedText: string;
  expectedJson: string;
}

export function loadGolden(name: string): LoadedGolden {
  const dir = `${GOLDEN_ROOT}${name}/`;
  return {
    scenario: readJson<GoldenScenario>(`${dir}scenario.json`),
    result: readJson(`${dir}result.json`),
    expectedText: readFileSync(`${dir}expected.txt`, 'utf8'),
    expectedJson: readFileSync(`${dir}expected.json`, 'utf8'),
  };
}

export function listCliScenarios(): string[] {
  return readdirSync(CLI_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export interface CliScenario {
  name: string;
  title: string;
  source: string;
  argv: string[];
  expectedExitCode: number;
  roots: ScenarioRoots;
  platform: {
    os: 'windows' | 'macos' | 'linux';
    osDisplayName: string;
    arch: 'x64' | 'arm64' | 'ia32' | 'arm' | 'unknown';
    nodeVersion: string;
    isWsl: boolean;
  };
  toolVersion: string;
  /** Expected stream: `stdout` for a report, `stderr` for a usage failure. */
  expectStderr: boolean;
}

export function loadCliScenario(name: string): {
  scenario: CliScenario;
  expectedStdout: string;
  expectedStderr: string;
} {
  const dir = `${CLI_ROOT}${name}/`;
  return {
    scenario: readJson<CliScenario>(`${dir}scenario.json`),
    expectedStdout: readFileSync(`${dir}stdout.txt`, 'utf8'),
    expectedStderr: readFileSync(`${dir}stderr.txt`, 'utf8'),
  };
}


export interface BenchmarkFixtureScenario {
  name: string;
  fixtureKind: 'contract-not-empirical';
  taskClass: 'mechanical' | 'standard' | 'hard' | 'critical';
  harnessId: string;
  expectedVerdict:
    | 'optimized-better'
    | 'baseline-better'
    | 'equivalent'
    | 'inconclusive'
    | 'incomparable';
  expectedBasis:
    | 'quality'
    | 'backend-quota'
    | 'failed-attempts'
    | 'runtime-errors'
    | 'attempts'
    | 'local-usage'
    | 'none';
  expectedEvidenceLevel: 'quota-backed' | 'local-evidence' | 'quality-only' | 'none';
  note: string;
}

export function listBenchmarkFixtures(): string[] {
  return readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadBenchmarkFixture(name: string): {
  scenario: BenchmarkFixtureScenario;
  baseline: unknown;
  optimized: unknown;
} {
  const dir = `${BENCHMARK_ROOT}${name}/`;
  return {
    scenario: readJson<BenchmarkFixtureScenario>(`${dir}scenario.json`),
    baseline: readJson(`${dir}baseline.json`),
    optimized: readJson(`${dir}optimized.json`),
  };
}
