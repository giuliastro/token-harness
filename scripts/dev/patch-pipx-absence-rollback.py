from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"patch anchor missing: {label}")
    return text.replace(old, new, 1)


install_path = Path('packages/core/src/state/install.ts')
install = install_path.read_text()

install = replace_once(
    install,
    "};\n\nexport function knownPackageManagers(): string[] {",
    """};

/**
 * Rollback commands are deliberately narrower than install commands. An uninstall is admitted only
 * after its inventory channel has proved the package was absent before this transaction and the
 * journal proves this transaction installed it. pipx is the first reviewed absence-restoration
 * channel; other package managers keep the conservative manual-remediation behavior.
 */
const UNINSTALL_COMMANDS: Readonly<
  Record<string, { executable: string; args: (packageName: string) => string[] }>
> = {
  pipx: {
    executable: 'pipx',
    args: (packageName) => ['uninstall', packageName],
  },
};

export function knownPackageManagers(): string[] {""",
    'uninstall command table',
)

old_absent = """  if (capture.status === 'absent') {
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
"""

new_absent = """  if (capture.status === 'absent') {
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
"""

install = replace_once(install, old_absent, new_absent, 'absence rollback')
install_path.write_text(install)


test_path = Path('packages/core/test/package-inventory.test.ts')
test = test_path.read_text()
anchor = """  it('says a confirmed absence stays installed rather than inventing an uninstall', async () => {
"""
addition = """  it('restores a pipx absence by uninstalling and re-reading inventory', async () => {
    let installed = true;
    const commands: string[] = [];
    const process: ProcessRunner = {
      run: (request) => {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        if (request.args[0] === 'uninstall') installed = false;
        const isList = request.args[0] === 'list';
        const stdout = isList
          ? JSON.stringify({
              pipx_spec_version: '0.1',
              venvs: installed
                ? {
                    mcptoon: {
                      metadata: {
                        main_package: { package: 'mcptoon', package_version: '0.7.10' },
                      },
                    },
                  }
                : {},
            })
          : '';
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    };

    const outcome = await restorePackageInventory({
      capture: capture({
        channel: 'pipx',
        packageName: 'mcptoon',
        status: 'absent',
        version: null,
      }),
      runner: process,
      cwd: '/work',
    });

    assert.equal(outcome.restored, true);
    assert.deepEqual(commands, [
      'pipx list --output json',
      'pipx uninstall mcptoon',
      'pipx list --output json',
    ]);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-inventory-restored'));
  });

  it('does not uninstall pipx when the live inventory is unreadable', async () => {
    const { commands, runner: process } = runner({ stdout: 'not-json' });
    const outcome = await restorePackageInventory({
      capture: capture({
        channel: 'pipx',
        packageName: 'mcptoon',
        status: 'absent',
        version: null,
      }),
      runner: process,
      cwd: '/work',
    });

    assert.equal(outcome.restored, false);
    assert.deepEqual(commands, ['pipx list --output json']);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'package-restore-failed'));
  });

"""
test = replace_once(test, anchor, addition + anchor, 'pipx absence rollback tests')
test_path.write_text(test)
