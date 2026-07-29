/**
 * Authors the `scenario.json` descriptor in each `tests/fixtures/cli` directory.
 *
 * Kept as a script so the seven descriptors stay in step with each other; the
 * generated `stdout.txt` and `stderr.txt` come from `regenerate-golden.mjs`.
 *
 * The roots are Windows paths on purpose. They exercise separator folding and
 * `~` abbreviation on every operating system, which is what keeps one set of
 * golden files valid across the whole CI matrix.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('../fixtures/cli/', import.meta.url));

const shared = {
  source: 'project-local',
  roots: {
    home: 'C:\\Users\\dev',
    stateRoot: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
    projectRoot: 'C:\\work\\demo',
  },
  platform: {
    os: 'windows',
    osDisplayName: 'Windows 11',
    arch: 'x64',
    nodeVersion: '22.14.0',
    isWsl: false,
  },
  toolVersion: '0.1.0',
};

const scenarios = {
  'doctor-empty': {
    title: 'doctor with empty registries',
    argv: ['doctor'],
    expectedExitCode: 0,
    expectStderr: false,
  },
  'doctor-empty-json': {
    title: 'doctor --json with empty registries',
    argv: ['doctor', '--json'],
    expectedExitCode: 0,
    expectStderr: false,
  },
  'plan-empty': {
    title: 'plan with empty registries',
    argv: ['plan'],
    expectedExitCode: 0,
    expectStderr: true,
  },
  'status-empty': {
    title: 'status on a machine with nothing applied',
    argv: ['status'],
    expectedExitCode: 0,
    expectStderr: false,
  },
  'help-root': { title: 'root usage', argv: ['--help'], expectedExitCode: 0, expectStderr: false },
  version: { title: 'version', argv: ['--version'], expectedExitCode: 0, expectStderr: false },
  'usage-unknown-command': {
    title: 'unknown command in human mode',
    argv: ['nope'],
    expectedExitCode: 2,
    expectStderr: true,
  },
};

for (const [name, entry] of Object.entries(scenarios)) {
  const dir = `${CLI_ROOT}${name}/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}scenario.json`,
    `${JSON.stringify({ name, ...entry, ...shared }, null, 2)}\n`,
    'utf8',
  );
  console.log(`scenario ${name}`);
}
