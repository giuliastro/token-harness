/**
 * Running a package manager — RFC 0004 §Network policy and §Process policy.
 *
 * The last unimplemented action family that a `safe` plan can produce. Until now
 * `package-manager-install` was planned and never executed, so a machine without RTK saw the
 * transaction fail on action one and roll back cleanly. Correct and safe, and not an installation.
 *
 * ## Three rules RFC 0004 imposes, and what each costs
 *
 * **"Elevation is never automatic. If a system package manager requires elevation, the plan
 * explains it and the user runs or approves that step explicitly."** So an action declaring
 * `requiresElevation` is *refused* here, with the exact command in the remediation. Refused rather
 * than failed: nothing is wrong, and the user can complete it in one paste.
 *
 * **"roll back by restoring those snapshots, never by inventing an uninstall command."** A package
 * is not a file, so there is no snapshot, so there is nothing to restore. An installed package
 * therefore survives a rollback — and the outcome says so rather than letting a "rolled back"
 * report imply the machine is as it was. RFC 0004 admits this directly: restore-based rollback
 * "cannot undo side effects outside the filesystem".
 *
 * **"Token Harness prefers release binaries or packages and never pipes network responses directly
 * to a shell."** The command is argv through the process runner — no shell, no interpolation.
 *
 * ## Why the argv is a table here rather than in the plan
 *
 * A plan is data a reviewer approves, and `winget install --id rtk-ai.rtk --exact --silent` is not
 * something a reviewer should have to audit for shell-injection each time. The plan names *what* to
 * install; this names *how* to ask each manager, once, in a table that a test pins. An unknown
 * manager is refused rather than guessed at.
 */

import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import type { PackageManagerInstallAction } from '../domain/actions.js';
import type { ProcessRunner } from '../domain/process.js';
import { parseSemanticVersion } from '../domain/version.js';

/** How to ask each package manager for a package, without a shell. */
const INSTALL_COMMANDS: Readonly<
  Record<
    string,
    {
      executable: string;
      args: (packageName: string, version: string | null) => string[];
      verified: boolean;
    }
  >
> = {
  winget: {
    executable: 'winget',
    args: (packageName, version) => [
      'install',
      '--id',
      packageName,
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
      ...(version === null ? [] : ['--version', version]),
    ],
    verified: true,
  },
  cargo: {
    executable: 'cargo',
    args: (packageName, version) => [
      'install',
      packageName,
      ...(version === null ? [] : ['--version', version]),
    ],
    verified: false,
  },
  npm: {
    executable: 'npm',
    args: (packageName, version) => [
      'install',
      '--global',
      version === null ? packageName : `${packageName}@${version}`,
    ],
    // HarnessTrim's upstream install contract is npm; this argv is intentionally simple and works
    // without the PNPM_HOME requirement that broke a real Windows update.
    verified: true,
  },
  pnpm: {
    executable: 'pnpm',
    args: (packageName, version) => [
      'add',
      '--global',
      version === null ? packageName : `${packageName}@${version}`,
    ],
    verified: false,
  },
  pipx: {
    executable: 'pipx',
    // Keep installation compatible with distro-packaged pipx releases. The install path consumes
    // only the exit status, so requesting newer machine-readable output adds no safety or value.
    args: (packageName, version) => [
      'install',
      '--force',
      version === null ? packageName : `${packageName}==${version}`,
    ],
    verified: true,
  },
  uv: {
    executable: 'uv',
    // Headroom uses uv's isolated tool installer. Token Harness invokes an existing uv only;
    // it never bootstraps uv, Python, or administrator prerequisites.
    args: (packageName, version) => [
      'tool',
      'install',
      '--force',
      version === null ? packageName : `${packageName}==${version}`,
    ],
    verified: true,
  },
};

/**
 * Rollback commands are deliberately narrower than install commands. An uninstall is admitted only
 * after its inventory channel has proved the package was absent before this transaction and the
 * journal proves this transaction installed it. pipx is the first reviewed absence-restoration
 * channel; other package managers keep the conservative manual-remediation behavior.
 */
const UNINSTALL_COMMANDS: Readonly<
  Record<string, { executable: string; args: (packageName: string) => string[] }>
> = {
  npm: {
    executable: 'npm',
    args: (packageName) => ['uninstall', '--global', packageName],
  },
  pipx: {
    executable: 'pipx',
    args: (packageName) => ['uninstall', packageName],
  },
  uv: {
    executable: 'uv',
    // Extras are install-time selectors; uv tool uninstall expects the distribution name.
    args: (packageName) => ['tool', 'uninstall', packageName.replace(/\[.*\]$/, '')],
  },
};

export function knownPackageManagers(): string[] {
  return Object.keys(INSTALL_COMMANDS).sort();
}

/** Channels this build can ask about a version. */
export function knownVersionQueryChannels(): string[] {
  return Object.keys(QUERY_COMMANDS).sort();
}

/** How to ask each package manager what version is available. */
const QUERY_COMMANDS: Readonly<
  Record<
    string,
    {
      executable: string;
      args: (packageName: string) => string[];
      parse: (stdout: string) => string | null;
      verified: boolean;
    }
  >
> = {
  winget: {
    executable: 'winget',
    args: (packageName) => ['show', '--id', packageName, '--exact', '--versions'],
    parse: (stdout) => {
      const lines = stdout.split(/\r?\n/);
      const separator = lines.findIndex((line) => /^-{3,}\s*$/.test(line.trim()));
      if (separator < 0) return null;
      for (const line of lines.slice(separator + 1)) {
        const candidate = line.trim();
        if (candidate === '') continue;
        // WinGet package versions may use the common release-tag prefix (`v0.48.0`). The shared
        // semantic parser accepts that transport spelling while keeping comparison semantics.
        return parseSemanticVersion(candidate) === null ? null : candidate;
      }
      return null;
    },
    verified: true,
  },
  npm: {
    executable: 'npm',
    args: (packageName) => ['view', packageName, 'version'],
    parse: (stdout) => {
      const candidate = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
      return parseSemanticVersion(candidate) === null ? null : candidate;
    },
    verified: true,
  },
  pnpm: {
    executable: 'pnpm',
    args: (packageName) => ['view', packageName, 'version'],
    parse: (stdout) => {
      const candidate = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? '';
      return parseSemanticVersion(candidate) === null ? null : candidate;
    },
    verified: true,
  },
  cargo: {
    executable: 'cargo',
    args: (packageName) => ['search', packageName, '--limit', '1'],
    parse: (stdout) => {
      const match = /^\s*\S+\s*=\s*"([^"]+)"/m.exec(stdout);
      const candidate = match?.[1] ?? null;
      if (candidate === null) return null;
      return parseSemanticVersion(candidate) === null ? null : candidate;
    },
    verified: false,
  },
};

export type VersionQueryStatus = 'found' | 'unknown' | 'unsupported' | 'failed';

export interface VersionQueryOutcome {
  status: VersionQueryStatus;
  version: string | null;
  destination: string | null;
  diagnostics: Diagnostic[];
}

export interface QueryVersionInput {
  packageManager: string;
  packageName: string;
  runner: ProcessRunner | null;
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_QUERY_TIMEOUT_MS = 60_000;

export async function queryAvailableVersion(
  input: QueryVersionInput,
): Promise<VersionQueryOutcome> {
  const recipe = QUERY_COMMANDS[input.packageManager];
  if (recipe === undefined) {
    return {
      status: 'unsupported',
      version: null,
      destination: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'version-query-unsupported',
          message: `This build cannot ask ${input.packageManager} what version of ${input.packageName} is available`,
          remediation: `Check for a newer ${input.packageName} yourself`,
        }),
      ],
    };
  }

  if (input.runner === null) {
    return {
      status: 'failed',
      version: null,
      destination: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'no-process-runner',
          message: 'No process runner is available, so no channel can be queried',
          remediation: null,
        }),
      ],
    };
  }

  const destination = `${input.packageManager} package index`;
  const diagnostics: Diagnostic[] = [];
  if (!recipe.verified) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'version-query-unverified',
        message: `The ${input.packageManager} version query follows that tool's documented output but has not been observed working`,
        remediation: 'Confirm the reported version before acting on it',
      }),
    );
  }

  const outcome = await input.runner.run({
    executable: recipe.executable,
    args: recipe.args(input.packageName),
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
  });

  if (outcome.failure !== null || outcome.exitCode !== 0) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'version-query-failed',
        message:
          outcome.failure === null
            ? `${outcome.displayCommand} exited with ${String(outcome.exitCode)}`
            : `${recipe.executable} could not be run: ${outcome.failure.reason}`,
        remediation: `Run it yourself to see the full output: ${outcome.displayCommand}`,
      }),
    );
    return { status: 'failed', version: null, destination, diagnostics };
  }

  const version = recipe.parse(outcome.stdout);
  if (version === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'version-query-unreadable',
        message: `${recipe.executable} answered, but its output did not name a version in the form this build reads`,
        remediation: `Run it yourself to see what it printed: ${outcome.displayCommand}`,
      }),
    );
    return { status: 'unknown', version: null, destination, diagnostics };
  }

  return { status: 'found', version, destination, diagnostics };
}

/** How to ask each package manager what it has installed. */
const INVENTORY_COMMANDS: Readonly<
  Record<
    string,
    {
      executable: string;
      args: (packageName: string) => string[];
      parse: (
        stdout: string,
        packageName: string,
      ) => { status: 'captured' | 'absent' | 'unknown'; version: string | null };
      verified: boolean;
    }
  >
> = {
  winget: {
    executable: 'winget',
    args: (packageName) => ['list', '--id', packageName, '--exact'],
    parse: (stdout, _packageName) => {
      const lines = stdout.split(/\r?\n/);
      const separator = lines.findIndex((line) => /^-{3,}\s*$/.test(line.trim()));
      if (separator < 0) return { status: 'unknown', version: null };
      for (const line of lines.slice(separator + 1)) {
        const row = line.trim();
        if (row === '') continue;
        const candidate = row.split(/\s+/).at(-1) ?? '';
        if (parseSemanticVersion(candidate) === null) return { status: 'unknown', version: null };
        return { status: 'captured', version: candidate };
      }
      return { status: 'unknown', version: null };
    },
    verified: false,
  },
  cargo: {
    executable: 'cargo',
    args: () => ['install', '--list'],
    parse: (stdout, packageName) => {
      const pattern = new RegExp(`^\\s*${packageName}\\s+v(\\S+)\\s*:`, 'm');
      const match = pattern.exec(stdout);
      if (match === null) return { status: 'absent', version: null };
      const candidate = match[1] ?? '';
      if (parseSemanticVersion(candidate) === null) return { status: 'unknown', version: null };
      return { status: 'captured', version: candidate };
    },
    verified: false,
  },
  npm: {
    executable: 'npm',
    // Listing the global root as JSON proves both presence and absence without depending on
    // localized human output or npm's exit behavior for a package-name filter.
    args: () => ['ls', '--global', '--depth=0', '--json'],
    parse: (stdout, packageName) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout) as unknown;
      } catch {
        return { status: 'unknown', version: null };
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'unknown', version: null };
      }
      const dependencies = (parsed as Record<string, unknown>)['dependencies'];
      if (dependencies === undefined) return { status: 'absent', version: null };
      if (
        typeof dependencies !== 'object' ||
        dependencies === null ||
        Array.isArray(dependencies)
      ) {
        return { status: 'unknown', version: null };
      }
      const dependency = (dependencies as Record<string, unknown>)[packageName];
      if (dependency === undefined) return { status: 'absent', version: null };
      const candidate =
        typeof dependency === 'string'
          ? dependency
          : typeof dependency === 'object' && dependency !== null && !Array.isArray(dependency)
            ? (dependency as Record<string, unknown>)['version']
            : null;
      if (typeof candidate !== 'string' || parseSemanticVersion(candidate) === null) {
        return { status: 'unknown', version: null };
      }
      return { status: 'captured', version: candidate };
    },
    verified: true,
  },
  pnpm: {
    executable: 'pnpm',
    args: (packageName) => ['list', '--global', packageName, '--depth', '0', '--json'],
    parse: (stdout, packageName) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout) as unknown;
      } catch {
        return { status: 'unknown', version: null };
      }

      const roots = Array.isArray(parsed) ? parsed : [parsed];
      let sawObject = false;
      for (const root of roots) {
        if (typeof root !== 'object' || root === null || Array.isArray(root)) continue;
        sawObject = true;
        const record = root as Record<string, unknown>;
        for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
          const group = record[field];
          if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
          const dependency = (group as Record<string, unknown>)[packageName];
          if (dependency === undefined) continue;
          const candidate =
            typeof dependency === 'string'
              ? dependency
              : typeof dependency === 'object' && dependency !== null && !Array.isArray(dependency)
                ? (dependency as Record<string, unknown>)['version']
                : null;
          if (typeof candidate !== 'string' || parseSemanticVersion(candidate) === null) {
            return { status: 'unknown', version: null };
          }
          return { status: 'captured', version: candidate };
        }
      }
      return sawObject ? { status: 'absent', version: null } : { status: 'unknown', version: null };
    },
    verified: false,
  },
  homebrew: {
    executable: 'brew',
    args: (packageName) => ['list', '--versions', packageName],
    parse: (stdout, packageName) => {
      const pattern = new RegExp(`^${packageName}\\s+(.+)$`);
      const match = pattern.exec(stdout.trim());
      const candidate = match?.[1]?.trim().split(/\s+/).at(-1) ?? null;
      if (candidate === null || parseSemanticVersion(candidate) === null) {
        return { status: 'unknown', version: null };
      }
      return { status: 'captured', version: candidate };
    },
    verified: false,
  },
  uv: {
    executable: 'uv',
    args: () => ['tool', 'list'],
    parse: (stdout, packageName) => {
      // Installation specs can include extras such as headroom-ai[mcp], while uv inventories the
      // base distribution. Parse the first two whitespace-separated fields instead of building a
      // regular expression from a package spec.
      const distribution = packageName.replace(/\[.*\]$/, '');
      for (const line of stdout.split(/\r?\n/)) {
        const fields = line.trim().split(/\s+/);
        if (fields[0] !== distribution) continue;
        const candidate = (fields[1] ?? '').replace(/^v/i, '');
        if (parseSemanticVersion(candidate) === null) {
          return { status: 'unknown', version: null };
        }
        return { status: 'captured', version: candidate };
      }
      return { status: 'absent', version: null };
    },
    verified: true,
  },
  pipx: {
    executable: 'pipx',
    // `--json` is the legacy machine-readable alias retained by pipx, so it works with older
    // distro packages while preserving the exact inventory parser and rollback proof below.
    args: () => ['list', '--json'],
    parse: (stdout, packageName) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout) as unknown;
      } catch {
        return { status: 'unknown', version: null };
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'unknown', version: null };
      }
      const venvs = (parsed as Record<string, unknown>)['venvs'];
      if (typeof venvs !== 'object' || venvs === null || Array.isArray(venvs)) {
        return { status: 'unknown', version: null };
      }
      const normalize = (value: string): string => value.toLowerCase().replace(/[-_.]+/g, '-');
      const wanted = normalize(packageName);
      for (const [environment, raw] of Object.entries(venvs as Record<string, unknown>)) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
        const metadata = (raw as Record<string, unknown>)['metadata'];
        if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) continue;
        const main = (metadata as Record<string, unknown>)['main_package'];
        if (typeof main !== 'object' || main === null || Array.isArray(main)) continue;
        const record = main as Record<string, unknown>;
        const observedName =
          typeof record['package'] === 'string' ? record['package'] : environment;
        if (normalize(observedName) !== wanted && normalize(environment) !== wanted) continue;
        const candidate = record['package_version'];
        if (typeof candidate !== 'string' || parseSemanticVersion(candidate) === null) {
          return { status: 'unknown', version: null };
        }
        return { status: 'captured', version: candidate };
      }
      return { status: 'absent', version: null };
    },
    verified: true,
  },
};

export function knownInventoryChannels(): string[] {
  return Object.keys(INVENTORY_COMMANDS).sort();
}

export function channelCanReportInventory(channelId: string): boolean {
  return Object.hasOwn(INVENTORY_COMMANDS, channelId);
}

export type PackageInventoryStatus = 'captured' | 'absent' | 'unknown' | 'unsupported' | 'failed';

export interface PackageInventoryCapture {
  channel: string;
  packageName: string;
  status: PackageInventoryStatus;
  version: string | null;
  diagnostics: Diagnostic[];
}

export interface QueryInventoryInput {
  channel: string;
  packageName: string;
  runner: ProcessRunner | null;
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_INVENTORY_TIMEOUT_MS = 60_000;

export async function queryPackageInventory(
  input: QueryInventoryInput,
): Promise<PackageInventoryCapture> {
  const recipe = INVENTORY_COMMANDS[input.channel];
  if (recipe === undefined) {
    return {
      channel: input.channel,
      packageName: input.packageName,
      status: 'unsupported',
      version: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'inventory-query-unsupported',
          message: `This build cannot ask ${input.channel} what it has installed`,
          remediation: null,
        }),
      ],
    };
  }

  if (input.runner === null) {
    return {
      channel: input.channel,
      packageName: input.packageName,
      status: 'failed',
      version: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'no-process-runner',
          message: 'No process runner is available, so no inventory can be captured',
          remediation: null,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (!recipe.verified) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'inventory-query-unverified',
        message: `The ${input.channel} inventory query follows that tool's documented output but has not been observed working`,
        remediation: 'Confirm the rollback receipt after any failure',
      }),
    );
  }

  const outcome = await input.runner.run({
    executable: recipe.executable,
    args: recipe.args(input.packageName),
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? DEFAULT_INVENTORY_TIMEOUT_MS,
  });

  if (outcome.failure !== null || outcome.exitCode !== 0) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'inventory-query-failed',
        message:
          outcome.failure === null
            ? `${outcome.displayCommand} exited with ${String(outcome.exitCode)}`
            : `${recipe.executable} could not be run: ${outcome.failure.reason}`,
        remediation: null,
      }),
    );
    return {
      channel: input.channel,
      packageName: input.packageName,
      status: 'failed',
      version: null,
      diagnostics,
    };
  }

  const reading = recipe.parse(outcome.stdout, input.packageName);
  if (reading.status === 'unknown') {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'inventory-query-unreadable',
        message: `${recipe.executable} answered, but its output did not name an installed version in the form this build reads`,
        remediation: null,
      }),
    );
  }

  return {
    channel: input.channel,
    packageName: input.packageName,
    status: reading.status,
    version: reading.version,
    diagnostics,
  };
}

export type InstallOutcomeStatus = 'installed' | 'refused' | 'failed';

export interface InstallOutcome {
  status: InstallOutcomeStatus;
  diagnostics: Diagnostic[];
}

export interface RunInstallInput {
  action: PackageManagerInstallAction;
  runner: ProcessRunner | null;
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 600_000;

export async function runPackageManagerInstall(input: RunInstallInput): Promise<InstallOutcome> {
  const { action } = input;

  if (action.requiresElevation) {
    const recipe = INSTALL_COMMANDS[action.packageManager];
    const shown =
      recipe === undefined
        ? `${action.packageManager} install ${action.packageName}`
        : [recipe.executable, ...recipe.args(action.packageName, action.version)].join(' ');
    return {
      status: 'refused',
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'install-requires-elevation',
          message: `Installing ${action.packageName} through ${action.packageManager} requires elevation, which Token Harness never performs automatically`,
          remediation: `Run this yourself in an elevated shell, then run the command again: ${shown}`,
        }),
      ],
    };
  }

  const recipe = INSTALL_COMMANDS[action.packageManager];
  if (recipe === undefined) {
    return {
      status: 'failed',
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'unknown-package-manager',
          message: `This build does not know how to invoke ${action.packageManager}; it knows ${knownPackageManagers().join(', ')}`,
          remediation: `Install ${action.packageName} yourself, then run the command again`,
        }),
      ],
    };
  }

  if (input.runner === null) {
    return {
      status: 'failed',
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'no-process-runner',
          message: 'No process runner is available, so no installer can be invoked',
          remediation: null,
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (!recipe.verified) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'install-channel-unverified',
        message: `The ${action.packageManager} invocation for ${action.packageName} follows that tool's documented form but has not been observed working`,
        remediation: 'Check the result afterwards, or install it yourself instead',
      }),
    );
  }

  const outcome = await input.runner.run({
    executable: recipe.executable,
    args: recipe.args(action.packageName, action.version),
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
  });

  if (outcome.failure !== null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'install-command-failed',
        message: `${recipe.executable} could not be run: ${outcome.failure.reason}`,
        remediation: `Install ${action.packageName} yourself, then run the command again`,
      }),
    );
    return { status: 'failed', diagnostics };
  }

  if (outcome.exitCode !== 0) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'install-command-failed',
        message: `${outcome.displayCommand} exited with ${String(outcome.exitCode)}`,
        remediation: `Run it yourself to see the full output: ${outcome.displayCommand}`,
      }),
    );
    return { status: 'failed', diagnostics };
  }

  return { status: 'installed', diagnostics };
}

export interface InventoryRestoreOutcome {
  restored: boolean;
  diagnostics: Diagnostic[];
}

export interface RestoreInventoryInput {
  capture: PackageInventoryCapture;
  runner: ProcessRunner | null;
  cwd: string;
  timeoutMs?: number;
}

export async function restorePackageInventory(
  input: RestoreInventoryInput,
): Promise<InventoryRestoreOutcome> {
  const { capture } = input;

  if (capture.status === 'absent') {
    const uninstall = UNINSTALL_COMMANDS[capture.channel];
    if (uninstall === undefined) {
      return {
        restored: false,
        diagnostics: [
          diagnostic({
            severity: 'info',
            code: 'package-inventory-unrestored',
            message: `${capture.packageName} was not installed before the transaction; ${capture.channel} has no reviewed uninstall rollback, so it stays installed`,
            remediation: null,
          }),
        ],
      };
    }

    if (input.runner === null) {
      return {
        restored: false,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'package-restore-failed',
            message: `${capture.packageName} was absent before the transaction but cannot be removed because no process runner is available`,
            remediation: `Remove ${capture.packageName} through ${capture.channel}, then verify it is absent`,
          }),
        ],
      };
    }

    const beforeRemoval = await queryPackageInventory({
      channel: capture.channel,
      packageName: capture.packageName,
      runner: input.runner,
      cwd: input.cwd,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });

    if (beforeRemoval.status === 'absent') {
      return {
        restored: true,
        diagnostics: [
          ...beforeRemoval.diagnostics,
          diagnostic({
            severity: 'info',
            code: 'package-inventory-restored',
            message: `${capture.packageName} is absent again through ${capture.channel}; the pre-transaction absence was verified`,
            remediation: null,
          }),
        ],
      };
    }

    if (beforeRemoval.status !== 'captured') {
      return {
        restored: false,
        diagnostics: [
          ...beforeRemoval.diagnostics,
          diagnostic({
            severity: 'error',
            code: 'package-restore-failed',
            message: `${capture.packageName} was absent before the transaction, but its current ${capture.channel} inventory could not be established safely`,
            remediation: `Inspect ${capture.channel} inventory before removing ${capture.packageName} manually`,
          }),
        ],
      };
    }

    const removal = await input.runner.run({
      executable: uninstall.executable,
      args: uninstall.args(capture.packageName),
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
    });
    if (removal.failure !== null || removal.exitCode !== 0) {
      return {
        restored: false,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'package-restore-failed',
            message:
              removal.failure === null
                ? `${removal.displayCommand} exited with ${String(removal.exitCode)}`
                : `${uninstall.executable} could not remove ${capture.packageName}: ${removal.failure.reason}`,
            remediation: `Remove ${capture.packageName} through ${capture.channel}, then verify it is absent`,
          }),
        ],
      };
    }

    const verified = await queryPackageInventory({
      channel: capture.channel,
      packageName: capture.packageName,
      runner: input.runner,
      cwd: input.cwd,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    if (verified.status !== 'absent') {
      return {
        restored: false,
        diagnostics: [
          ...verified.diagnostics,
          diagnostic({
            severity: 'error',
            code: 'package-restore-failed',
            message: `${capture.packageName} was removed through ${capture.channel}, but the inventory does not confirm the pre-transaction absence`,
            remediation: `Inspect ${capture.channel} inventory and remove ${capture.packageName} manually if it is still present`,
          }),
        ],
      };
    }

    return {
      restored: true,
      diagnostics: [
        ...verified.diagnostics,
        diagnostic({
          severity: 'info',
          code: 'package-inventory-restored',
          message: `${capture.packageName} was restored to the pre-transaction absent state through ${capture.channel} and the inventory was re-read`,
          remediation: null,
        }),
      ],
    };
  }

  if (capture.status !== 'captured' || capture.version === null) {
    return {
      restored: false,
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'package-inventory-unrestored',
          message: `${capture.packageName} was installed without a captured inventory, so it could not be restored`,
          remediation: null,
        }),
      ],
    };
  }

  if (input.runner === null) {
    return {
      restored: false,
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'package-inventory-unrestored',
          message: `${capture.packageName} could not be restored: no process runner is available`,
          remediation: null,
        }),
      ],
    };
  }

  const restoreAction: PackageManagerInstallAction = {
    kind: 'package-manager-install',
    id: `restore-${capture.packageName}`,
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: [capture.channel],
    preconditions: [],
    postconditions: [],
    rollbackData: 'none',
    explanation: `Restore ${capture.packageName} to ${capture.version} after a rollback`,
    packageManager: capture.channel,
    packageName: capture.packageName,
    version: capture.version,
  };

  const result = await runPackageManagerInstall({
    action: restoreAction,
    runner: input.runner,
    cwd: input.cwd,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });

  if (result.status !== 'installed') {
    return {
      restored: false,
      diagnostics: [
        ...result.diagnostics,
        diagnostic({
          severity: 'error',
          code: 'package-restore-failed',
          message: `${capture.packageName} could not be restored to ${capture.version} through ${capture.channel}`,
          path: null,
          remediation: `Install ${capture.packageName} at ${capture.version} yourself, then run the command again`,
        }),
      ],
    };
  }

  const verified = await queryPackageInventory({
    channel: capture.channel,
    packageName: capture.packageName,
    runner: input.runner,
    cwd: input.cwd,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });

  if (verified.status !== 'captured' || verified.version !== capture.version) {
    return {
      restored: false,
      diagnostics: [
        ...verified.diagnostics,
        diagnostic({
          severity: 'error',
          code: 'package-restore-failed',
          message: `${capture.packageName} was reinstalled but the inventory does not report ${capture.version}`,
          remediation: `Confirm what ${capture.channel} has installed and correct it by hand`,
        }),
      ],
    };
  }

  return {
    restored: true,
    diagnostics: [
      diagnostic({
        severity: 'info',
        code: 'package-inventory-restored',
        message: `${capture.packageName} was restored to ${capture.version} through ${capture.channel} and the inventory was re-read`,
        remediation: null,
      }),
    ],
  };
}
