/**
 * Proves the staged package is installable — PLAN §8.3.
 *
 * `pnpm smoke` already runs the bundle from a temporary directory, which proves the
 * *artifact* is self-contained. It does not prove the *package* is installable: the
 * manifest could name the wrong `bin`, omit the file from `files`, or carry a
 * dependency npm cannot resolve, and the bundle would still run fine when invoked
 * directly.
 *
 * So this packs the staged directory with `npm pack`, installs the resulting tarball
 * into a scratch directory with no workspace above it, and runs what came out. Any
 * mistake in the manifest surfaces here rather than in a user's install log — which is
 * the failure mode `apps/cli/test/packaging.test.ts` was written to make impossible to
 * reach by accident.
 *
 * The installed artifact is invoked through `node` rather than through the generated
 * `.bin` shim. That is not avoidance: the shim's existence is asserted separately, and
 * on Windows npm generates a `.cmd` batch shim that cannot be spawned without the
 * command interpreter — the constraint `packages/platform` exists to handle, and not
 * something this script should reimplement to test a manifest.
 *
 * Read-only root and cross-harness surfaces are exercised. Scheduler evidence is supplied
 * explicitly, so the smoke never needs to inspect real subscription state.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const staged = join(repoRoot, 'dist', 'package');

// `npm` is a `.cmd` batch shim on Windows, which cannot be spawned without the
// command interpreter. Rather than reach for `shell: true` — which Node now warns
// about precisely because concatenating arguments into a shell string is the
// vulnerability class this project exists to avoid — the check runs npm through Token
// Harness's own process runner, which resolves the shim and quotes for `cmd.exe` with
// the rules `packages/platform` tests. The build has already produced `dist`, so it is
// available.
const { resolveHostEnvironment } = await import(
  new URL('../packages/platform/dist/src/index.js', import.meta.url).href
);

const host = resolveHostEnvironment();
if (!host.ok) {
  console.error(`unsupported environment: ${host.diagnostics.map((d) => d.message).join('; ')}`);
  process.exit(1);
}

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok    ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail === undefined ? '' : `\n      ${detail}`}`);
  }
}

async function npm(args, cwd) {
  const outcome = await host.environment.runner.run({
    executable: 'npm',
    args,
    cwd,
    timeoutMs: 300_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  return {
    status: outcome.failure === null ? outcome.exitCode : null,
    stdout: outcome.stdout,
    stderr:
      outcome.failure === null
        ? outcome.stderr
        : `${outcome.failure.reason}: ${outcome.failure.message}`,
    interpreter: outcome.interpreter,
  };
}

try {
  statSync(join(staged, 'package.json'));
} catch {
  console.error(`missing ${staged}\nRun \`pnpm build && pnpm package\` first.`);
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), 'token-harness-install-'));

try {
  const packed = await npm(['pack', '--pack-destination', sandbox, '--loglevel', 'error'], staged);
  check('npm pack succeeds', packed.status === 0, packed.stderr.trim());
  if (packed.status !== 0) throw new Error('pack failed');
  console.log(`      (npm reached through the ${packed.interpreter} path)`);

  const tarballs = readdirSync(sandbox).filter((name) => name.endsWith('.tgz'));
  check('the pack produced exactly one tarball', tarballs.length === 1, tarballs.join(', '));
  const tarball = join(sandbox, tarballs[0] ?? '');

  const target = mkdtempSync(join(tmpdir(), 'token-harness-target-'));
  const installed = await npm(['install', '--no-save', '--loglevel', 'error', tarball], target);
  check('the tarball installs', installed.status === 0, installed.stderr.trim());

  const moduleRoot = join(target, 'node_modules', 'token-harness');
  const entry = join(moduleRoot, 'token-harness.mjs');
  check(
    'the manifest bin file is in the tarball',
    (() => {
      try {
        return statSync(entry).isFile();
      } catch {
        return false;
      }
    })(),
  );

  // npm creates the launcher from the `bin` field. On Windows that is a `.cmd`; on
  // POSIX an extensionless symlink.
  const shim = join(
    target,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'token-harness.cmd' : 'token-harness',
  );
  check(
    'npm generated the command launcher',
    (() => {
      try {
        statSync(shim);
        return true;
      } catch {
        return false;
      }
    })(),
    shim,
  );

  check(
    'nothing was installed alongside it',
    (() => {
      const siblings = readdirSync(join(target, 'node_modules')).filter(
        (name) => name !== 'token-harness' && name !== '.bin' && name !== '.package-lock.json',
      );
      // A package with no dependencies installs nothing else. If this ever fails, the
      // generated manifest grew a dependency the bundle does not need.
      return siblings.length === 0;
    })(),
  );

  const run = (args) =>
    spawnSync(process.execPath, [entry, ...args], { cwd: target, encoding: 'utf8' });

  const installedManifest = JSON.parse(readFileSync(join(moduleRoot, 'package.json'), 'utf8'));
  const version = run(['--version']);
  check('--version exits 0', version.status === 0, `exit ${version.status}`);
  check(
    '--version matches the installed manifest',
    version.stdout.trim() === installedManifest.version,
    `${version.stdout.trim()} vs ${installedManifest.version}`,
  );
  check(
    'the installed manifest declares no dependencies',
    installedManifest.dependencies === undefined,
    JSON.stringify(installedManifest.dependencies),
  );

  const help = run(['--help']);
  check('--help exits 0 and prints usage', help.status === 0 && help.stdout.includes('Usage'));
  check(
    '--help exposes the cross-harness release surfaces',
    ['handoff', 'transfer', 'schedule', 'transfer-record'].every((command) =>
      help.stdout.includes(command),
    ),
  );

  for (const command of ['handoff', 'transfer', 'transfer-record', 'schedule']) {
    const commandHelp = run([command, '--help']);
    check(
      `${command} --help works from the installed package`,
      commandHelp.status === 0 &&
        commandHelp.stderr === '' &&
        commandHelp.stdout.includes(`token-harness ${command}`),
      `${commandHelp.stderr.trim()}\n${commandHelp.stdout.slice(0, 160)}`,
    );
  }

  const handoff = run([
    'handoff',
    '--objective',
    'validate installed release',
    '--next-action',
    'ship the tested package',
    '--max-bytes',
    '512',
  ]);
  check(
    'handoff runs from the installed package within its byte budget',
    handoff.status === 0 &&
      handoff.stderr === '' &&
      handoff.stdout.length > 0 &&
      Buffer.byteLength(handoff.stdout, 'utf8') <= 512,
    `${Buffer.byteLength(handoff.stdout, 'utf8')} bytes\n${handoff.stderr.trim()}`,
  );

  const schedule = run([
    'schedule',
    '--current',
    'claude',
    '--candidate',
    'codex',
    '--task-class',
    'hard',
    '--current-five-hour',
    'over-pace',
    '--current-weekly',
    'on-pace',
    '--candidate-five-hour',
    'under-pace',
    '--candidate-weekly',
    'on-pace',
    '--candidate-quality',
    'passed',
    '--candidate-quality-task',
    'hard',
    '--candidate-quality-samples',
    '1',
    '--handoff-bytes',
    '400',
    '--max-handoff-bytes',
    '2048',
    '--transfer-benefit',
    'proven-positive',
    '--json',
  ]);
  check(
    'schedule reaches a deterministic switch decision from the installed package',
    (() => {
      try {
        const envelope = JSON.parse(schedule.stdout);
        return (
          schedule.status === 0 &&
          schedule.stderr === '' &&
          envelope.command === 'schedule' &&
          envelope.data?.decision === 'switch'
        );
      } catch {
        return false;
      }
    })(),
    `${schedule.stderr.trim()}\n${schedule.stdout.trim()}`,
  );

  /**
   * The installed artifact runs and reports; it is not asked to find an empty machine.
   *
   * This check read `doctor.status === 0` under the name "on a machine with nothing installed" — and
   * it never created that condition. It runs against the real home, so it passed on clean CI runners
   * and failed on any developer machine with a harness configured and a coverage gap, which exits 3.
   * A gate that only works where nobody looks at it is worse than no gate: the red is a false one and
   * it teaches people to ignore the output.
   *
   * What this step is for is proving the *tarball* works, so it accepts either code `doctor` may
   * legitimately produce — 0 for a clean report, 3 for problems found — and rejects anything else,
   * which is what a crash or an unsupported environment would give.
   */
  const doctor = run(['doctor']);
  check(
    'doctor runs and reports, exiting 0 or 3',
    doctor.status === 0 || doctor.status === 3,
    `exit ${String(doctor.status)}\n${doctor.stderr.trim()}`,
  );
  check(
    'doctor reports the real platform',
    /^Token Harness \d+\.\d+\.\d+ — /.test(doctor.stdout),
    doctor.stdout.split('\n')[0],
  );

  const json = run(['doctor', '--json']);
  check(
    'doctor --json emits one document and nothing on stderr',
    (() => {
      try {
        return typeof JSON.parse(json.stdout) === 'object' && json.stderr === '';
      } catch {
        return false;
      }
    })(),
  );

  rmSync(target, { recursive: true, force: true });
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} install check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nsmoke:install: the package installs and runs');
}
