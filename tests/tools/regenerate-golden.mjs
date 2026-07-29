/**
 * Regenerates the derived halves of the golden fixtures.
 *
 * What it regenerates:
 *
 * - `tests/fixtures/golden/<name>/expected.json` — the envelope rendering of the
 *   committed `result.json`;
 * - `tests/fixtures/cli/<name>/{stdout,stderr}.txt` — the live output of the
 *   Phase 1 shell for a fixed, fully injected environment.
 *
 * What it never touches: `expected.txt` under `tests/fixtures/golden/`. Those
 * five files are transcribed from RFC 0006 §Golden path and are normative. A
 * script that could rewrite them would let a rendering change quietly become the
 * expected output, which is the one thing golden files exist to prevent.
 *
 * Run `pnpm build` first, then `pnpm golden`. Review the diff.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { serializeEnvelope, toEnvelope } from '@token-harness/core';
import { run } from 'token-harness';

const GOLDEN_ROOT = fileURLToPath(new URL('../fixtures/golden/', import.meta.url));
const CLI_ROOT = fileURLToPath(new URL('../fixtures/cli/', import.meta.url));

function directories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

for (const name of directories(GOLDEN_ROOT)) {
  const dir = `${GOLDEN_ROOT}${name}/`;
  const scenario = readJson(`${dir}scenario.json`);
  const result = readJson(`${dir}result.json`);
  writeFileSync(
    `${dir}expected.json`,
    serializeEnvelope(toEnvelope(result, scenario.toolVersion)),
    'utf8',
  );
  console.log(`golden  ${name}/expected.json`);
}

for (const name of directories(CLI_ROOT)) {
  const dir = `${CLI_ROOT}${name}/`;
  const scenario = readJson(`${dir}scenario.json`);
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    argv: scenario.argv,
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
    platform: scenario.platform,
    cwd: scenario.roots.projectRoot,
    home: scenario.roots.home,
    stateRoot: scenario.roots.stateRoot,
    env: {},
    stdoutIsTty: false,
    toolVersion: scenario.toolVersion,
  });
  if (exitCode !== scenario.expectedExitCode) {
    throw new Error(
      `cli scenario ${name} exited ${exitCode}, but scenario.json declares ${scenario.expectedExitCode}`,
    );
  }
  writeFileSync(`${dir}stdout.txt`, stdout, 'utf8');
  writeFileSync(`${dir}stderr.txt`, stderr, 'utf8');
  console.log(`cli     ${name}/{stdout,stderr}.txt  exit ${exitCode}`);
}
