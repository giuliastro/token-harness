from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"patch anchor missing: {label}")
    return text.replace(old, new, 1)


# packages/core/src/state/install.ts
install_path = Path("packages/core/src/state/install.ts")
install = install_path.read_text()
install_table_start = install.index("const INSTALL_COMMANDS")
install_table_end = install.index("\n};\n\nexport function knownPackageManagers", install_table_start)
if "\n  pipx: {" not in install[install_table_start:install_table_end]:
    pipx_install = """
  pipx: {
    executable: 'pipx',
    args: (packageName, version) => [
      'install',
      '--force',
      '--output',
      'json',
      version === null ? packageName : `${packageName}==${version}`,
    ],
    verified: true,
  },"""
    install = install[:install_table_end] + pipx_install + install[install_table_end:]

inventory_table_start = install.index("const INVENTORY_COMMANDS")
pipx_inventory_start = install.index("  pipx: {", inventory_table_start)
inventory_table_end = install.index(
    "\n};\n\nexport function knownInventoryChannels", inventory_table_start
)
pipx_inventory = """  pipx: {
    executable: 'pipx',
    args: () => ['list', '--output', 'json'],
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
        const observedName = typeof record['package'] === 'string' ? record['package'] : environment;
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
  },"""
install = install[:pipx_inventory_start] + pipx_inventory + install[inventory_table_end:]
install_path.write_text(install)


# packages/core/test/package-inventory.test.ts
inventory_test_path = Path("packages/core/test/package-inventory.test.ts")
inventory_test = inventory_test_path.read_text()
inventory_test = replace_once(
    inventory_test,
    "it('reads npm, homebrew, uv, and pipx in their documented shapes', async () => {",
    "it('reads npm, homebrew, and uv in their documented shapes', async () => {",
    "package inventory combined test title",
)
inventory_test = replace_once(
    inventory_test,
    "      { channel: 'pipx', packageName: 'rtk', stdout: 'rtk 0.42.0\\n', version: '0.42.0' },\n",
    "",
    "legacy pipx text fixture",
)
pipx_inventory_test = """
  it('reads pipx machine-readable inventory and distinguishes absence', async () => {
    const stdout = JSON.stringify({
      pipx_spec_version: '0.1',
      venvs: {
        mcptoon: {
          metadata: {
            main_package: { package: 'mcptoon', package_version: '0.7.10' },
          },
        },
      },
    });
    const { commands, runner: process } = runner({ stdout });
    const outcome = await queryPackageInventory({
      channel: 'pipx',
      packageName: 'mcptoon',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'captured');
    assert.equal(outcome.version, '0.7.10');
    assert.deepEqual(commands, ['pipx list --output json']);
    assert.equal(
      outcome.diagnostics.some((entry) => entry.code === 'inventory-query-unverified'),
      false,
    );

    const { runner: absentProcess } = runner({
      stdout: JSON.stringify({ pipx_spec_version: '0.1', venvs: {} }),
    });
    const absent = await queryPackageInventory({
      channel: 'pipx',
      packageName: 'mcptoon',
      runner: absentProcess,
      cwd: '/work',
    });
    assert.equal(absent.status, 'absent');
    assert.equal(absent.version, null);
  });

"""
inventory_test = replace_once(
    inventory_test,
    "  it('never turns an unreadable answer into \"captured at nothing\"', async () => {",
    pipx_inventory_test
    + "  it('never turns an unreadable answer into \"captured at nothing\"', async () => {",
    "pipx inventory test insertion",
)
inventory_test_path.write_text(inventory_test)


# packages/core/test/pipx-install.test.ts
Path("packages/core/test/pipx-install.test.ts").write_text(
    """import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  knownPackageManagers,
  runPackageManagerInstall,
  type PackageManagerInstallAction,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

function action(version: string | null): PackageManagerInstallAction {
  return {
    kind: 'package-manager-install',
    id: 'pipx-mcptoon-install',
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pipx'],
    preconditions: [],
    postconditions: [],
    rollbackData: 'package-inventory',
    explanation: 'Install mcptoon through pipx',
    packageManager: 'pipx',
    packageName: 'mcptoon',
    version,
  };
}

function runner(): { commands: string[]; runner: ProcessRunner } {
  const commands: string[] = [];
  return {
    commands,
    runner: {
      run(request): Promise<ProcessOutcome> {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct',
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout: '{"status":"success"}',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    },
  };
}

describe('pipx package installation', () => {
  it('uses an isolated exact-version package spec without a shell', async () => {
    const process = runner();
    const result = await runPackageManagerInstall({
      action: action('0.7.10'),
      runner: process.runner,
      cwd: '/work',
    });
    assert.equal(result.status, 'installed');
    assert.deepEqual(process.commands, [
      'pipx install --force --output json mcptoon==0.7.10',
    ]);
    assert.equal(knownPackageManagers().includes('pipx'), true);
    assert.equal(
      result.diagnostics.some((entry) => entry.code === 'install-channel-unverified'),
      false,
    );
  });
});
"""
)


# packages/adapters/src/providers/mcptoon-managed.ts
managed_path = Path("packages/adapters/src/providers/mcptoon-managed.ts")
managed = managed_path.read_text()
managed = replace_once(
    managed,
    "export const MCPTOON_MANAGED_MINIMUM_VERSION = '0.7.8';\n",
    "export const MCPTOON_MANAGED_MINIMUM_VERSION = '0.7.8';\nexport const MCPTOON_REVIEWED_INSTALL_VERSION = '0.7.10';\n",
    "reviewed install version",
)
helper_anchor = "function directoryAction(harness: HarnessId, path: string, index: number): PlannedAction {"
helper = """function mcptoonInstallAction(): PlannedAction {
  return {
    kind: 'package-manager-install',
    id: `mcptoon:install:${MCPTOON_REVIEWED_INSTALL_VERSION}`,
    riskClass: 'delegated',
    requiresNetwork: true,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: ['pipx'],
    preconditions: ['pipx remains runnable and the reviewed mcptoon release remains installable'],
    postconditions: [`mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} is installed through pipx`],
    rollbackData: 'package-inventory',
    explanation: `Install reviewed mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} in an isolated pipx environment`,
    packageManager: 'pipx',
    packageName: 'mcptoon',
    version: MCPTOON_REVIEWED_INSTALL_VERSION,
  };
}

"""
managed = replace_once(managed, helper_anchor, helper + helper_anchor, "mcptoon install helper")
old_doc = """/**
 * Plan only the reversible agent-instruction activation. Package installation is deliberately not
 * hidden here: the current package executor does not yet implement pipx installation, so an absent
 * mcptoon CLI remains a blocked prerequisite rather than an action that would fail at apply time.
 */"""
new_doc = """/**
 * Plan the reviewed mcptoon lifecycle slice without touching MCP configuration.
 *
 * A missing CLI is installed through the generic pipx package transaction first, then the narrow
 * Claude/Codex instruction surface is applied. A runnable but incompatible third-party build stays
 * user-owned rather than being silently replaced.
 */"""
managed = replace_once(managed, old_doc, new_doc, "mcptoon lifecycle documentation")
plan_start = managed.index(
    "  const observation = await observeMcptoonCandidate(context);\n",
    managed.index("export async function planMcptoonManagedActivation"),
)
old_plan_tail = """  const observation = await observeMcptoonCandidate(context);
  if (observation.state !== 'benchmark-ready') {
    return {
      harness,
      target: null,
      actions: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'mcptoon-managed-prerequisite',
          subject: harness,
          message:
            observation.state === 'absent'
              ? 'mcptoon is not installed; managed activation waits for the reviewed pipx install primitive'
              : `mcptoon ${observation.version ?? ''} is not on the reviewed managed-activation surface`.trim(),
          remediation:
            observation.state === 'absent'
              ? 'Install mcptoon in an isolated environment for the current experiment, then refresh Token Harness'
              : `Use mcptoon ${MCPTOON_MANAGED_MINIMUM_VERSION} or newer with the reviewed manifest surfaces`,
        }),
      ],
    };
  }

  return harness === 'claude'
    ? planClaudeActivation(context, harness)
    : planCodexActivation(context, harness);"""
new_plan_tail = """  const observation = await observeMcptoonCandidate(context);
  const activation =
    harness === 'claude'
      ? await planClaudeActivation(context, harness)
      : await planCodexActivation(context, harness);

  if (observation.state === 'benchmark-ready') return activation;

  if (observation.state === 'absent') {
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

  return {
    harness,
    target: null,
    actions: [],
    diagnostics: [
      diagnostic({
        severity: 'warning',
        code: 'mcptoon-managed-prerequisite',
        subject: harness,
        message: `mcptoon ${observation.version ?? ''} is runnable but not on the reviewed managed-activation surface`.trim(),
        remediation: `Keep the existing installation user-owned, or move to mcptoon ${MCPTOON_MANAGED_MINIMUM_VERSION} or newer with the reviewed manifest surfaces`,
      }),
    ],
  };"""
if not managed.startswith(old_plan_tail, plan_start):
    raise SystemExit("patch anchor missing: mcptoon plan tail")
managed = managed[:plan_start] + new_plan_tail + managed[plan_start + len(old_plan_tail) :]
managed_path.write_text(managed)


# packages/adapters/src/providers/index.ts
index_path = Path("packages/adapters/src/providers/index.ts")
index = index_path.read_text()
index = replace_once(
    index,
    "  MCPTOON_MANAGED_MINIMUM_VERSION,\n",
    "  MCPTOON_MANAGED_MINIMUM_VERSION,\n  MCPTOON_REVIEWED_INSTALL_VERSION,\n",
    "mcptoon reviewed version export",
)
index_path.write_text(index)


# packages/adapters/test/mcptoon-managed.test.ts
managed_test_path = Path("packages/adapters/test/mcptoon-managed.test.ts")
managed_test = managed_test_path.read_text()
managed_test = replace_once(
    managed_test,
    "  MCPTOON_MARKER_END,\n",
    "  MCPTOON_MARKER_END,\n  MCPTOON_REVIEWED_INSTALL_VERSION,\n",
    "mcptoon reviewed version test import",
)
managed_test += """

test('plans reviewed pipx installation before Codex guidance when mcptoon is absent', async () => {
  const fs = new MemoryFs();
  const base = context(fs);
  const absentRunner: ProcessRunner = {
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
  const plan = await planMcptoonManagedActivation(
    { ...base, runner: absentRunner },
    harnessId('codex'),
  );

  assert.equal(plan.actions.length, 2);
  const install = plan.actions[0];
  assert.ok(install?.kind === 'package-manager-install');
  assert.equal(install.packageManager, 'pipx');
  assert.equal(install.packageName, 'mcptoon');
  assert.equal(install.version, MCPTOON_REVIEWED_INSTALL_VERSION);
  assert.equal(install.rollbackData, 'package-inventory');
  assert.equal(plan.actions[1]?.kind, 'patch-marker-block');
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'mcptoon-managed-install-planned'));
});
"""
managed_test_path.write_text(managed_test)
