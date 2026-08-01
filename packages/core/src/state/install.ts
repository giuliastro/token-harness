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
