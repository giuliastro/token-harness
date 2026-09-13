from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"patch anchor missing: {label}")
    return text.replace(old, new, 1)


candidate_path = Path('packages/adapters/src/providers/mcptoon-candidate.ts')
candidate = candidate_path.read_text()
candidate = replace_once(
    candidate,
    "  const manifestOutcome = await context.runner.run({\n    executable: 'mcptoon',\n    args: ['manifest', '--help'],",
    "  const helpOutcome = await context.runner.run({\n    executable: 'mcptoon',\n    args: ['--help'],",
    'candidate root help probe',
)
candidate = replace_once(
    candidate,
    "  const capabilities =\n    manifestOutcome.failure === null && manifestOutcome.exitCode === 0\n      ? parseMcptoonManifestCapabilities(`${manifestOutcome.stdout}\\n${manifestOutcome.stderr}`)\n      : { compact: false, json: false };",
    "  const capabilities =\n    helpOutcome.failure === null && helpOutcome.exitCode === 0\n      ? parseMcptoonManifestCapabilities(`${helpOutcome.stdout}\\n${helpOutcome.stderr}`)\n      : { compact: false, json: false };",
    'candidate root help parse',
)
candidate = candidate.replace(
    'explicit manifest surfaces Token Harness needs for a native-vs-compact benchmark.',
    'global output surfaces Token Harness needs for a native-vs-compact benchmark.',
)
candidate_path.write_text(candidate)


candidate_test_path = Path('packages/adapters/test/mcptoon-candidate.test.ts')
candidate_test = candidate_test_path.read_text()
candidate_test = replace_once(
    candidate_test,
    "      } else if (request.args[0] === 'manifest' && request.args[1] === '--help') {\n        payload = options.manifestHelp ?? null;\n      }",
    "      } else if (request.args[0] === '--help') {\n        payload = options.manifestHelp ?? null;\n      }",
    'candidate test root help runner',
)
candidate_test_path.write_text(candidate_test)


managed_path = Path('packages/adapters/src/providers/mcptoon-managed.ts')
managed = managed_path.read_text()
old_absent = """  if (observation.state === 'absent') {
    return {
      ...activation,
      actions: [mcptoonInstallAction(), ...activation.actions],
      diagnostics: [
        ...activation.diagnostics,
        diagnostic({
          severity: 'info',
          code: 'mcptoon-managed-install-planned',
          subject: harness,
          message: `mcptoon is absent; install reviewed ${MCPTOON_REVIEWED_INSTALL_VERSION} through pipx before enabling agent guidance`,
          remediation: null,
        }),
      ],
    };
  }
"""
new_absent = """  if (observation.state === 'absent') {
    const pipx = await context.runner.run({
      executable: 'pipx',
      args: ['--version'],
      cwd: context.projectRoot,
      timeoutMs: 20_000,
    });
    if (pipx.failure !== null || pipx.exitCode !== 0) {
      return {
        harness,
        target: activation.target,
        actions: [],
        diagnostics: [
          ...activation.diagnostics,
          diagnostic({
            severity: 'warning',
            code: 'mcptoon-pipx-unavailable',
            subject: harness,
            message: 'mcptoon is absent and the isolated pipx installer is not available',
            remediation: 'Install pipx, then refresh Token Harness; Token Harness will not bootstrap a Python package manager implicitly',
          }),
        ],
      };
    }
    return {
      ...activation,
      actions: [mcptoonInstallAction(), ...activation.actions],
      diagnostics: [
        ...activation.diagnostics,
        diagnostic({
          severity: 'info',
          code: 'mcptoon-managed-install-planned',
          subject: harness,
          message: `mcptoon is absent; install reviewed ${MCPTOON_REVIEWED_INSTALL_VERSION} through pipx before enabling agent guidance`,
          remediation: null,
        }),
      ],
    };
  }
"""
managed = replace_once(managed, old_absent, new_absent, 'mcptoon pipx prerequisite')
managed_path.write_text(managed)


managed_test_path = Path('packages/adapters/test/mcptoon-managed.test.ts')
managed_test = managed_test_path.read_text()
managed_test = replace_once(
    managed_test,
    "      if (request.args[0] === 'manifest' && request.args[1] === '--help') {\n        return Promise.resolve(outcome(request, 'Options: --compact --json --toon'));\n      }",
    "      if (request.args[0] === '--help') {\n        return Promise.resolve(outcome(request, 'Options: --compact --json --toon'));\n      }",
    'managed test root help runner',
)
old_runner = """  const absentRunner: ProcessRunner = {
    run: (request) =>
      Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: null,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: { reason: 'executable-not-found', message: 'mcptoon missing' },
      }),
  };
"""
new_runner = """  const absentRunner: ProcessRunner = {
    run: (request) => {
      const pipx = request.executable === 'pipx';
      return Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: pipx ? '/usr/bin/pipx' : null,
        exitCode: pipx ? 0 : null,
        signal: null,
        stdout: pipx ? '1.7.1' : '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: pipx ? null : { reason: 'executable-not-found', message: 'mcptoon missing' },
      });
    },
  };
"""
managed_test = replace_once(managed_test, old_runner, new_runner, 'mcptoon absent test pipx runner')
managed_test += """

test('refuses managed installation when pipx is unavailable', async () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const missingRunner: ProcessRunner = {
    run: (request) =>
      Promise.resolve({
        displayCommand: `${request.executable} ${request.args.join(' ')}`,
        interpreter: 'direct',
        executablePath: null,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: { reason: 'executable-not-found', message: `${request.executable} missing` },
      }),
  };
  const plan = await planMcptoonManagedActivation(
    { ...base, runner: missingRunner },
    harnessId('codex'),
  );
  assert.deepEqual(plan.actions, []);
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-pipx-unavailable'));
});
"""
managed_test_path.write_text(managed_test)
