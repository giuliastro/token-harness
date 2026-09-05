/**
 * Package smoke test — PLAN §1.1 acceptance.
 *
 * "Bundled CLI prints version and help on all three operating systems" and
 * "package smoke test runs without workspace resolution."
 *
 * The bundle is copied into a temporary directory outside the repository, with
 * no `node_modules` anywhere above it, and executed there. If anything failed to
 * inline, module resolution fails and the test does too.
 *
 * The smoke paths are read-only and use explicit scheduler evidence, so this
 * never needs to inspect the developer's real harness state.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(repoRoot, 'dist', 'bundle', 'token-harness.mjs');

const sandbox = mkdtempSync(join(tmpdir(), 'token-harness-smoke-'));
const target = join(sandbox, 'token-harness.mjs');
copyFileSync(bundle, target);

function runBundle(args) {
  const result = spawnSync(process.execPath, [target, ...args], {
    cwd: sandbox,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
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

try {
  const version = runBundle(['--version']);
  check('--version exits 0', version.status === 0, `exit ${version.status}`);
  check(
    '--version writes nothing to stderr',
    version.stderr === '',
    JSON.stringify(version.stderr),
  );
  check(
    '--version prints a semantic version',
    /^\d+\.\d+\.\d+\r?\n$/.test(version.stdout),
    JSON.stringify(version.stdout),
  );

  const help = runBundle(['--help']);
  check('--help exits 0', help.status === 0, `exit ${help.status}`);
  check('--help writes nothing to stderr', help.stderr === '', JSON.stringify(help.stderr));
  check(
    '--help prints usage',
    help.stdout.includes('Usage'),
    JSON.stringify(help.stdout.slice(0, 120)),
  );
  check(
    '--help lists doctor, plan, and status',
    ['doctor', 'plan', 'status'].every((c) => help.stdout.includes(c)),
  );
  check(
    '--help leads with setup and the local dashboard',
    ['token-harness setup', 'ui          Open the local dashboard'].every((text) =>
      help.stdout.includes(text),
    ),
  );
  check(
    '--help lists cross-harness surfaces',
    ['handoff', 'transfer', 'schedule', 'transfer-record'].every((c) => help.stdout.includes(c)),
  );

  for (const command of ['handoff', 'transfer', 'transfer-record', 'schedule']) {
    const commandHelp = runBundle([command, '--help']);
    check(`${command} --help exits 0`, commandHelp.status === 0, `exit ${commandHelp.status}`);
    check(
      `${command} --help writes nothing to stderr`,
      commandHelp.stderr === '',
      JSON.stringify(commandHelp.stderr),
    );
    check(
      `${command} --help identifies the command`,
      commandHelp.stdout.includes(`token-harness ${command}`),
      JSON.stringify(commandHelp.stdout.slice(0, 160)),
    );
  }

  for (const command of ['setup', 'ui']) {
    const commandHelp = runBundle([command, '--help']);
    check(
      `${command} --help works from the bundle`,
      commandHelp.status === 0 &&
        commandHelp.stderr === '' &&
        commandHelp.stdout.includes(`token-harness ${command}`),
      `${commandHelp.stderr.trim()}\n${commandHelp.stdout.slice(0, 160)}`,
    );
  }

  const handoff = runBundle([
    'handoff',
    '--objective',
    'validate bundled release',
    '--next-action',
    'ship the tested artifact',
    '--max-bytes',
    '512',
  ]);
  check('handoff builds a compact payload', handoff.status === 0 && handoff.stdout.length > 0);
  check(
    'handoff respects the configured UTF-8 byte budget',
    Buffer.byteLength(handoff.stdout, 'utf8') <= 512,
    `${Buffer.byteLength(handoff.stdout, 'utf8')} bytes`,
  );

  const schedule = runBundle([
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
    'schedule evaluates explicit cross-harness evidence from the bundle',
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

  const bad = runBundle(['definitely-not-a-command']);
  check('an unknown command exits 2', bad.status === 2, `exit ${bad.status}`);
  check(
    'an unknown command writes nothing to stdout',
    bad.stdout === '',
    JSON.stringify(bad.stdout),
  );

  const json = runBundle(['--version', '--json']);
  check(
    '--version --json emits one JSON document',
    (() => {
      try {
        return typeof JSON.parse(json.stdout) === 'object' && json.stderr === '';
      } catch {
        return false;
      }
    })(),
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nsmoke: all checks passed');
}
