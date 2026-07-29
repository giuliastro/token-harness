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
 * Only `--version` and `--help` are exercised. Both are pure and touch nothing
 * on the machine, which keeps this from reading the developer's real home.
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
