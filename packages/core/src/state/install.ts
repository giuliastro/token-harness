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

/**
 * How to ask each package manager for a package, without a shell.
 *
 * Verified against the machine this was written on: `rtk` resolves to
 * `WinGet/Packages/rtk-ai.rtk_.../rtk.exe`, `winget search rtk` returns the id `rtk-ai.rtk`, and
 * every flag below appears in `winget install --help`.
 *
 * `cargo` is declared but was **not** verified — cargo is not installed here, so `cargo install
 * <crate>` is the documented form rather than an observed one. It is marked, and the marking is
 * what `install-channel-unverified` reports at run time.
 */
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
      // Non-interactive: the runner gives a child no usable stdin, so a prompt would hang until
      // the timeout rather than ask anybody anything.
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
};

export function knownPackageManagers(): string[] {
  return Object.keys(INSTALL_COMMANDS).sort();
}

/**
 * Channels this build can *ask* about a version, which is deliberately not the same set it can
 * install through.
 *
 * A query is a read and an install is a mutation, so they are held to different standards of
 * evidence. `pnpm view <pkg> version` was verified against the machine; a global pnpm install argv
 * was not, and adding one unverified so the two lists would match would be shipping an unreviewed
 * mutation to make a symmetry look tidy.
 *
 * The asymmetry costs nothing today: RFC 0003 records that HarnessTrim, the provider whose channel
 * is pnpm, "is not installed by Token Harness at all".
 */
export function knownVersionQueryChannels(): string[] {
  return Object.keys(QUERY_COMMANDS).sort();
}

/**
 * How to ask each package manager what version is *available* — RFC 0004 §Amended: version
 * discovery belongs to the channel, not the provider.
 *
 * The provider contract cannot answer this: `detect` reports the version that is installed, which
 * is the wrong side of the arrow `update` has to print. `winget` knows what exists for
 * `rtk-ai.rtk`; RTK's own adapter has no idea.
 *
 * The parse is the interesting part, and verifying it changed the answer. `winget show --id <id>
 * --exact` prints the version behind a **localized label** — `Versione:` on the machine this was
 * written on, `Version:` on an English one — so matching that label would have shipped something
 * that works in one locale and silently reports nothing in every other. `--versions` instead
 * prints a table whose header is localized but whose body is bare versions, newest first, after a
 * separator line of dashes that no translation touches.
 */
const QUERY_COMMANDS: Readonly<
  Record<
    string,
    {
      executable: string;
      args: (packageName: string) => string[];
      /** The newest available version, or null when the output named none. */
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
      // Anchored on the dashes rather than on a line count: `winget` prints a "Found <name> [<id>]"
      // line above the table whose wording is also localized.
      const separator = lines.findIndex((line) => /^-{3,}\s*$/.test(line.trim()));
      if (separator < 0) return null;
      for (const line of lines.slice(separator + 1)) {
        const candidate = line.trim();
        if (candidate === '') continue;
        // Newest first, so the first parseable line is the answer. A line that is not a version is
        // not skipped past — it means the table shape is not what was verified, and guessing
        // further down would be reading an unknown format.
        return parseSemanticVersion(candidate) === null ? null : candidate;
      }
      return null;
    },
    verified: true,
  },
  /**
   * `pnpm view <pkg> version` prints the version alone, on one line, in every locale — the
   * registry answers with data rather than with a rendered table, which is why this one needs no
   * separator trick.
   *
   * Verified on the machine this was written on: `pnpm view harnesstrim version` → `0.0.6`, which
   * matches what the installed binary reports. `npm view` prints the same thing, but the channel a
   * user installed through is the channel to ask.
   */
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
    // `name = "0.1.0"    # description`, per cargo's documented output. Not observed: cargo is not
    // installed on the machine this was written on, which is what `verified: false` reports.
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
  /** Non-null only when `status` is `found`. */
  version: string | null;
  /** The destination the query reached, for the plan's network summary. Null when none was. */
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

/** A query is a read, so it is held to a much shorter leash than an install. */
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
    /**
     * A warning rather than an error, and never a guess.
     *
     * `unknown` is what a locale or a changed table shape produces, and the honest consequence is
     * that `update` cannot say what a newer version would be — not that it invents one or reports
     * "already current", which is the same sentence a user reads as good news.
     */
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

export type InstallOutcomeStatus = 'installed' | 'refused' | 'failed';

export interface InstallOutcome {
  status: InstallOutcomeStatus;
  diagnostics: Diagnostic[];
}

export interface RunInstallInput {
  action: PackageManagerInstallAction;
  runner: ProcessRunner | null;
  cwd: string;
  /** Bounded: an installer that hangs must not hold a transaction open indefinitely. */
  timeoutMs?: number;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 600_000;

export async function runPackageManagerInstall(input: RunInstallInput): Promise<InstallOutcome> {
  const { action } = input;

  if (action.requiresElevation) {
    // RFC 0004 §Process policy: "Provider commands run with current-user privileges. Elevation is
    // never automatic." Refusing is the specified behaviour, not a limitation.
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
    // Guessing an unknown manager's argv is how a plan becomes a command nobody reviewed.
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
        // The runner already redacted the display command and bounded the output.
        message: `${outcome.displayCommand} exited with ${String(outcome.exitCode)}`,
        remediation: `Run it yourself to see the full output: ${outcome.displayCommand}`,
      }),
    );
    return { status: 'failed', diagnostics };
  }

  /**
   * Said on success, not only on failure.
   *
   * A later action can still fail and roll the transaction back, and the rollback restores files.
   * This package is not a file and will still be installed afterwards. Reporting a clean rollback
   * without saying so would leave the user believing the machine is as it was.
   */
  diagnostics.push(
    diagnostic({
      severity: 'info',
      code: 'install-not-reversible',
      message: `${action.packageName} was installed through ${action.packageManager}; a rollback restores files and will not uninstall it`,
      remediation: null,
    }),
  );

  return { status: 'installed', diagnostics };
}
