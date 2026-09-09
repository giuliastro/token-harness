import type { ProviderContext } from './contract.js';

export type McptoonCandidateState =
  | 'absent'
  | 'installed'
  | 'benchmark-ready'
  | 'unsupported-version';

export interface McptoonCandidateObservation {
  state: McptoonCandidateState;
  version: string | null;
  executable: string | null;
  supportsCompactManifest: boolean;
  supportsJsonManifest: boolean;
  minimumBenchmarkVersion: string;
  reasons: string[];
}

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
export const MCPTOON_MINIMUM_BENCHMARK_VERSION = '0.7.8';

export function parseMcptoonVersion(text: string): string | null {
  return VERSION_PATTERN.exec(text)?.[1] ?? null;
}

function numericCore(version: string): [number, number, number] | null {
  const core = version.split(/[-+]/, 1)[0];
  if (core === undefined) return null;
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function mcptoonVersionAtLeast(version: string, minimum: string): boolean {
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

export function parseMcptoonManifestCapabilities(text: string): {
  compact: boolean;
  json: boolean;
} {
  const lower = text.toLowerCase();
  return {
    compact: /(?:^|\s)--compact(?:\s|,|$)/m.test(lower),
    json: /(?:^|\s)--json(?:\s|,|$)/m.test(lower),
  };
}

/**
 * Read-only candidate observation for MCP discovery/schema reduction.
 *
 * This never runs `mcptoon sync`, never writes agent MCP configuration, never starts `serve`, and
 * never enables result-side TOON compression. It only checks whether the local CLI exposes the two
 * explicit manifest surfaces Token Harness needs for a native-vs-compact benchmark.
 */
export async function observeMcptoonCandidate(
  context: ProviderContext,
): Promise<McptoonCandidateObservation> {
  const versionOutcome = await context.runner.run({
    executable: 'mcptoon',
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
      supportsCompactManifest: false,
      supportsJsonManifest: false,
      minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
      reasons: [`mcptoon --version failed: ${versionOutcome.failure.reason}`],
    };
  }
  if (versionOutcome.exitCode !== 0) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsCompactManifest: false,
      supportsJsonManifest: false,
      minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
      reasons: [`mcptoon --version exited ${String(versionOutcome.exitCode)}`],
    };
  }

  const version = parseMcptoonVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  if (version === null) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsCompactManifest: false,
      supportsJsonManifest: false,
      minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
      reasons: ['mcptoon is runnable but did not report a recognisable semantic version'],
    };
  }

  if (!mcptoonVersionAtLeast(version, MCPTOON_MINIMUM_BENCHMARK_VERSION)) {
    return {
      state: 'unsupported-version',
      version,
      executable: versionOutcome.executablePath,
      supportsCompactManifest: false,
      supportsJsonManifest: false,
      minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
      reasons: [
        `mcptoon ${version} predates the ${MCPTOON_MINIMUM_BENCHMARK_VERSION} benchmark baseline`,
      ],
    };
  }

  const manifestOutcome = await context.runner.run({
    executable: 'mcptoon',
    args: ['manifest', '--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const capabilities =
    manifestOutcome.failure === null && manifestOutcome.exitCode === 0
      ? parseMcptoonManifestCapabilities(`${manifestOutcome.stdout}\n${manifestOutcome.stderr}`)
      : { compact: false, json: false };

  if (!capabilities.compact || !capabilities.json) {
    return {
      state: 'installed',
      version,
      executable: versionOutcome.executablePath,
      supportsCompactManifest: capabilities.compact,
      supportsJsonManifest: capabilities.json,
      minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
      reasons: [
        'this mcptoon build does not advertise both explicit compact and JSON manifest surfaces',
      ],
    };
  }

  return {
    state: 'benchmark-ready',
    version,
    executable: versionOutcome.executablePath,
    supportsCompactManifest: true,
    supportsJsonManifest: true,
    minimumBenchmarkVersion: MCPTOON_MINIMUM_BENCHMARK_VERSION,
    reasons: [
      'mcptoon is eligible for read-only MCP context benchmarking; no sync or compression policy has been enabled',
    ],
  };
}
