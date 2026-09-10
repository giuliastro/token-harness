import type { ProviderContext } from './contract.js';

export type GitNexusCandidateState = 'absent' | 'installed' | 'benchmark-ready';

export interface GitNexusCandidateObservation {
  state: GitNexusCandidateState;
  version: string | null;
  executable: string | null;
  supportsQuery: boolean;
  supportsContext: boolean;
  supportsStatusJson: boolean;
  reasons: string[];
}

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

export function parseGitNexusVersion(text: string): string | null {
  return VERSION_PATTERN.exec(text)?.[1] ?? null;
}

function advertisesCommand(text: string, command: string): boolean {
  return text
    .toLowerCase()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === command || line.startsWith(`${command} `));
}

export function parseGitNexusCliCapabilities(
  helpText: string,
  statusHelpText: string,
): {
  query: boolean;
  context: boolean;
  statusJson: boolean;
} {
  const status = advertisesCommand(helpText, 'status');
  return {
    query: advertisesCommand(helpText, 'query'),
    context: advertisesCommand(helpText, 'context'),
    statusJson: status && /(?:^|\s)--json(?:\s|,|$)/m.test(statusHelpText.toLowerCase()),
  };
}

/**
 * Read-only candidate observation for repository graph/code-intelligence experiments.
 *
 * The reviewed GitNexus CLI excludes `--version` and `--help` invocations from its background
 * update checker. Keep this observer restricted to those surfaces: it must never run `analyze`,
 * `setup`, `status`, `query`, `context`, MCP, hooks, package managers, or any command that can create
 * an index or change agent configuration. A `benchmark-ready` result only means that the installed
 * CLI advertises the direct query/context and machine-readable status surfaces needed to design a
 * paired benchmark; it does not admit or enable GitNexus as an optimization provider.
 */
export async function observeGitNexusCandidate(
  context: ProviderContext,
): Promise<GitNexusCandidateObservation> {
  const versionOutcome = await context.runner.run({
    executable: 'gitnexus',
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
      supportsQuery: false,
      supportsContext: false,
      supportsStatusJson: false,
      reasons: [`gitnexus --version failed: ${versionOutcome.failure.reason}`],
    };
  }
  if (versionOutcome.exitCode !== 0) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsQuery: false,
      supportsContext: false,
      supportsStatusJson: false,
      reasons: [`gitnexus --version exited ${String(versionOutcome.exitCode)}`],
    };
  }

  const version = parseGitNexusVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  const helpOutcome = await context.runner.run({
    executable: 'gitnexus',
    args: ['--help'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const helpText =
    helpOutcome.failure === null && helpOutcome.exitCode === 0
      ? `${helpOutcome.stdout}\n${helpOutcome.stderr}`
      : '';
  const hasStatus = advertisesCommand(helpText, 'status');

  let statusHelpText = '';
  if (hasStatus) {
    const statusHelpOutcome = await context.runner.run({
      executable: 'gitnexus',
      args: ['status', '--help'],
      cwd: context.projectRoot,
      timeoutMs: 20_000,
    });
    if (statusHelpOutcome.failure === null && statusHelpOutcome.exitCode === 0) {
      statusHelpText = `${statusHelpOutcome.stdout}\n${statusHelpOutcome.stderr}`;
    }
  }

  const capabilities = parseGitNexusCliCapabilities(helpText, statusHelpText);
  if (version === null) {
    return {
      state: 'installed',
      version: null,
      executable: versionOutcome.executablePath,
      supportsQuery: capabilities.query,
      supportsContext: capabilities.context,
      supportsStatusJson: capabilities.statusJson,
      reasons: ['gitnexus is runnable but did not report a recognisable semantic version'],
    };
  }

  const missing = [
    capabilities.query ? null : 'query',
    capabilities.context ? null : 'context',
    capabilities.statusJson ? null : 'status --json',
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) {
    return {
      state: 'installed',
      version,
      executable: versionOutcome.executablePath,
      supportsQuery: capabilities.query,
      supportsContext: capabilities.context,
      supportsStatusJson: capabilities.statusJson,
      reasons: [`this GitNexus build does not advertise benchmark surfaces: ${missing.join(', ')}`],
    };
  }

  return {
    state: 'benchmark-ready',
    version,
    executable: versionOutcome.executablePath,
    supportsQuery: true,
    supportsContext: true,
    supportsStatusJson: true,
    reasons: [
      'GitNexus is eligible for paired repository-exploration benchmarking; no index, MCP, hooks, skills, or agent configuration were changed',
    ],
  };
}
