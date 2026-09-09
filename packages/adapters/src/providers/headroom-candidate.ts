import type { ProviderContext } from './contract.js';

export type HeadroomCandidateState =
  | 'absent'
  | 'installed'
  | 'benchmark-ready'
  | 'unsupported-version';

export interface HeadroomCandidateObservation {
  state: HeadroomCandidateState;
  version: string | null;
  executable: string | null;
  supportsClaudeWrap: boolean;
  supportsCodexWrap: boolean;
  minimumBenchmarkVersion: string;
  reasons: string[];
}

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
export const HEADROOM_MINIMUM_BENCHMARK_VERSION = '0.36.0';

export function parseHeadroomVersion(text: string): string | null {
  return VERSION_PATTERN.exec(text)?.[1] ?? null;
}

export function parseHeadroomWrapTargets(text: string): {
  claude: boolean;
  codex: boolean;
} {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 0);
  return {
    claude: tokens.includes('claude'),
    codex: tokens.includes('codex'),
  };
}

function numericCore(version: string): [number, number, number] | null {
  const core = version.split(/[-+]/, 1)[0];
  if (core === undefined) return null;
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function headroomVersionAtLeast(version: string, minimum: string): boolean {
  const actual = numericCore(version);
  const floor = numericCore(minimum);
  if (actual === null || floor === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const left = actual[index] ?? 0;
    const right = floor[index] ?? 0;
    if (left !== right) return left > right;
  }
  return !(version.includes('-') && !minimum.includes('-'));
}

/**
 * Read-only candidate observation. This does not register Headroom as an active provider, run a
 * proxy, install an MCP server, or mutate Claude/Codex configuration.
 */
export async function observeHeadroomCandidate(
  context: ProviderContext,
): Promise<HeadroomCandidateObservation> {
  const versionOutcome = await context.runner.run({
    executable: 'headroom',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (versionOutcome.failure !== null) {
    const absent = versionOutcome.failure.reason === 'executable-not-found';
    return {
      state: absent ? 'absent' : 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsClaudeWrap: false,
      supportsCodexWrap: false,
      minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
      reasons: [`headroom --version failed: ${versionOutcome.failure.reason}`],
    };
  }
  if (versionOutcome.exitCode !== 0) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsClaudeWrap: false,
      supportsCodexWrap: false,
      minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
      reasons: [`headroom --version exited ${String(versionOutcome.exitCode)}`],
    };
  }

  const version = parseHeadroomVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  const wrapOutcome = await context.runner.run({
    executable: 'headroom',
    args: ['wrap', '--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const targets =
    wrapOutcome.failure === null && wrapOutcome.exitCode === 0
      ? parseHeadroomWrapTargets(`${wrapOutcome.stdout}\n${wrapOutcome.stderr}`)
      : { claude: false, codex: false };

  if (version === null) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsClaudeWrap: targets.claude,
      supportsCodexWrap: targets.codex,
      minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
      reasons: ['headroom is runnable but did not report a recognisable semantic version'],
    };
  }

  if (!headroomVersionAtLeast(version, HEADROOM_MINIMUM_BENCHMARK_VERSION)) {
    return {
      state: 'unsupported-version',
      version,
      executable: versionOutcome.executablePath,
      supportsClaudeWrap: targets.claude,
      supportsCodexWrap: targets.codex,
      minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
      reasons: [
        `Headroom ${version} predates the ${HEADROOM_MINIMUM_BENCHMARK_VERSION} benchmark baseline`,
      ],
    };
  }

  if (!targets.claude || !targets.codex) {
    return {
      state: 'installed',
      version,
      executable: versionOutcome.executablePath,
      supportsClaudeWrap: targets.claude,
      supportsCodexWrap: targets.codex,
      minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
      reasons: ['this Headroom build does not advertise both Claude and Codex wrap targets'],
    };
  }

  return {
    state: 'benchmark-ready',
    version,
    executable: versionOutcome.executablePath,
    supportsClaudeWrap: true,
    supportsCodexWrap: true,
    minimumBenchmarkVersion: HEADROOM_MINIMUM_BENCHMARK_VERSION,
    reasons: [
      'Headroom is eligible for paired experimental benchmarking; no integration has been enabled',
    ],
  };
}
