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
    args: (packageName) => ['ls', '-g', packageName, '--depth=0'],
    parse: (stdout, packageName) => {
      const pattern = new RegExp(`(?:^|[^@\\w.-])${packageName}@(\\d[^\\s]*)`);
      const match = pattern.exec(stdout);
      const candidate = match?.[1] ?? null;
      if (candidate === null || parseSemanticVersion(candidate) === null) {
        return { status: 'unknown', version: null };
      }
      return { status: 'captured', version: candidate };
    },
    verified: false,
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
      const pattern = new RegExp(`^${packageName}\\s+v?(\\S+)`, 'm');
      const match = pattern.exec(stdout);
      if (match === null) return { status: 'absent', version: null };
      const candidate = match[1] ?? '';
      if (parseSemanticVersion(candidate) === null) return { status: 'unknown', version: null };
      return { status: 'captured', version: candidate };
    },
    verified: false,
  },
  pipx: {
    executable: 'pipx',
    args: () => ['list'],
    parse: (stdout, packageName) => {
      const pattern = new RegExp(`^\\s*${packageName}\\s+(\\S+)`, 'm');
      const match = pattern.exec(stdout);
      if (match === null) return { status: 'absent', version: null };
      const candidate = match[1] ?? '';
      if (parseSemanticVersion(candidate) === null) return { status: 'unknown', version: null };
      return { status: 'captured', version: candidate };
    },
    verified: false,
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
    return {
      restored: false,
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'package-inventory-unrestored',
          message: `${capture.packageName} was not installed before the transaction; restoring that absence would require an uninstall command, so it stays installed`,
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
