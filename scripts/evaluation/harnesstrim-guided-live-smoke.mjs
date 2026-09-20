/**
 * Live release gate for the exact first-run/update path that previously passed mocks and failed on
 * a real machine.
 *
 * This intentionally uses real npm packages and the real bundled Token Harness CLI. It starts from
 * HarnessTrim 0.2.1, installs the latest public Claude Code and Codex CLIs, makes the working scope
 * the user's home, and puts >1 MiB of unrelated data in both agent directories. That combination
 * reproduces the two bugs the unit fixtures missed:
 *
 * - machine-local Token Harness state lives below HOME, so HOME must not be mistaken for a repo;
 * - HarnessTrim setup must snapshot only its reviewed skill/protected paths, not all of .claude or
 *   .codex.
 *
 * It then performs real plan/apply/verify for Claude and Codex, a real npm update of HarnessTrim to
 * the registry's current release, verifies that the active PATH executable changed, removes only
 * the Claude integration, and sets Claude back up on the updated runtime.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuideService } from '../../apps/cli/src/guided.ts';

if (process.platform !== 'linux') {
  console.error('This live smoke is intentionally Linux-only in CI.');
  process.exit(2);
}

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(repoRoot, 'dist', 'bundle', 'token-harness.mjs');
const root = join(repoRoot, 'dist', 'harnesstrim-live-smoke');
const home = join(root, 'home');
const prefix = join(root, 'npm-prefix');
const bin = join(prefix, 'bin');

rmSync(root, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
mkdirSync(prefix, { recursive: true });

const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  XDG_STATE_HOME: join(home, '.local', 'state'),
  XDG_CACHE_HOME: join(home, '.cache'),
  npm_config_prefix: prefix,
  PATH: [bin, process.env.PATH ?? ''].filter(Boolean).join(':'),
  NO_COLOR: '1',
};

function fail(label, detail = '') {
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
  process.exit(1);
}

function ok(label) {
  console.log(`ok    ${label}`);
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? home,
    env,
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    fail(`${executable} ${args.join(' ')} started`, result.error.message);
  }
  return result;
}

function expectExit(label, result, accepted = [0]) {
  if (!accepted.includes(result.status)) {
    fail(
      label,
      `exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  ok(label);
}

function npm(args, options = {}) {
  return run('npm', args, { ...options, cwd: root, timeout: 600_000 });
}

function th(args, accepted = [0]) {
  const result = run(process.execPath, [entry, ...args], { cwd: home });
  expectExit(`token-harness ${args.join(' ')}`, result, accepted);
  return result;
}

function thJson(args, accepted = [0]) {
  const result = th([...args, '--json'], accepted);
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (error) {
    fail(
      `token-harness ${args.join(' ')} returned JSON`,
      `${error instanceof Error ? error.message : String(error)}\n${result.stdout}`,
    );
  }
}

function normalizeVersion(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '');
}

function doctor() {
  return thJson(['doctor']);
}

function provider(report, id) {
  return report.data?.providers?.find((item) => item.providerId === id) ?? null;
}

function harness(report, id) {
  return report.data?.harnesses?.find((item) => item.harnessId === id) ?? null;
}

function assert(condition, label, detail = '') {
  if (!condition) fail(label, detail);
  ok(label);
}

let ticketCounter = 0;
const guide = new GuideService(
  async (args) => thJson([...args]),
  () => Date.now(),
  () => `live-ticket-${++ticketCounter}`,
);

async function guidedSetup(agent) {
  const preview = await guide.preview({
    action: 'setup',
    harness: agent,
    provider: 'harnesstrim',
  });
  assert(
    typeof preview.ticket === 'string' && preview.ticket.length > 0,
    `${agent}: guided Finish setup produces an approval ticket`,
    JSON.stringify(preview),
  );
  assert(
    preview.changes.length > 0,
    `${agent}: guided Finish setup previews a concrete HarnessTrim change`,
    JSON.stringify(preview),
  );

  const applied = await guide.apply({ ticket: preview.ticket });
  assert(
    applied.ok === true && applied.appliedPlans > 0,
    `${agent}: guided Finish setup applies and verifies instead of returning Needs attention`,
    JSON.stringify(applied),
  );
}

async function guidedUpdate() {
  const preview = await guide.checkUpdates();
  assert(
    preview.ok === true && typeof preview.ticket === 'string' && preview.ticket.length > 0,
    'guided Check for updates returns a concrete install approval',
    JSON.stringify(preview),
  );
  const applied = await guide.apply({ ticket: preview.ticket });
  assert(
    applied.ok === true && applied.appliedPlans > 0,
    'guided Install updates verifies the active runtime before reporting success',
    JSON.stringify(applied),
  );
  assert(
    !applied.messages.some((message) => message.includes('No optimizer needed an update')),
    'guided update does not emit the stale false-green "No optimizer needed an update" message',
    JSON.stringify(applied.messages),
  );
  return applied;
}

function verifyHarness(agent) {
  const result = thJson(['verify', '--harness', agent, '--provider', 'harnesstrim']);
  const row = result.data?.results?.find(
    (item) => item.providerId === 'harnesstrim' && item.harnessId === agent,
  );
  assert(
    result.data?.healthyAtDeclaredTier === true && row !== undefined,
    `${agent}: HarnessTrim verification is healthy at its declared tier`,
    JSON.stringify(result),
  );
}

try {
  const installed = npm([
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    'harnesstrim@0.2.1',
    '@anthropic-ai/claude-code@latest',
    '@openai/codex@latest',
  ]);
  expectExit('real HarnessTrim 0.2.1 + latest Claude Code + latest Codex install', installed);

  const htVersion = run('harnesstrim', ['--version']);
  expectExit('HarnessTrim executable starts', htVersion);
  assert(
    normalizeVersion(htVersion.stdout) === '0.2.1',
    'HarnessTrim starts at 0.2.1',
    htVersion.stdout.trim(),
  );

  const claudeVersion = run('claude', ['--version']);
  expectExit('latest Claude Code executable starts', claudeVersion);
  const codexVersion = run('codex', ['--version']);
  expectExit('latest Codex executable starts', codexVersion);

  mkdirSync(join(home, '.claude', 'history'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'history', 'unrelated.bin'), Buffer.alloc(1_400_000, 0x41));
  writeFileSync(join(home, '.codex', 'sessions', 'unrelated.bin'), Buffer.alloc(1_400_000, 0x42));

  const protectedFiles = new Map([
    [join(home, 'CLAUDE.md'), '# user Claude instructions\n'],
    [join(home, '.claude', 'settings.json'), '{}\n'],
    [join(home, 'AGENTS.md'), '# user Codex instructions\n'],
    [join(home, '.codex', 'hooks.json'), '{}\n'],
  ]);
  for (const [path, text] of protectedFiles) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  const before = doctor();
  assert(harness(before, 'claude')?.version !== null, 'doctor detects the real latest Claude Code');
  assert(harness(before, 'codex')?.version !== null, 'doctor detects the real latest Codex');
  assert(
    normalizeVersion(provider(before, 'harnesstrim')?.version) === '0.2.1',
    'doctor detects the real HarnessTrim 0.2.1 runtime',
    JSON.stringify(provider(before, 'harnesstrim')),
  );

  await guidedSetup('claude');
  await guidedSetup('codex');

  for (const [path, expected] of protectedFiles) {
    assert(
      readFileSync(path, 'utf8') === expected,
      `setup leaves protected user file unchanged: ${path.slice(home.length + 1)}`,
    );
  }
  assert(
    readFileSync(join(home, '.claude', 'history', 'unrelated.bin')).byteLength === 1_400_000,
    'Claude unrelated >1 MiB state survives setup',
  );
  assert(
    readFileSync(join(home, '.codex', 'sessions', 'unrelated.bin')).byteLength === 1_400_000,
    'Codex unrelated >1 MiB state survives setup',
  );

  let configured = doctor();
  let ht = provider(configured, 'harnesstrim');
  assert(
    ht?.configuredHarnesses?.includes('claude') && ht?.configuredHarnesses?.includes('codex'),
    'doctor observes HarnessTrim connected to both real coding agents',
    JSON.stringify(ht),
  );
  verifyHarness('claude');
  verifyHarness('codex');

  const latestResult = npm(['view', 'harnesstrim', 'version', '--json']);
  expectExit('npm registry returns the current HarnessTrim version', latestResult);
  const latest = normalizeVersion(JSON.parse(latestResult.stdout));
  assert(latest !== '', 'current HarnessTrim version is readable', latestResult.stdout);
  assert(
    latest !== '0.2.1',
    'live update smoke has a newer HarnessTrim target than 0.2.1',
    `registry latest is ${latest}`,
  );

  await guidedUpdate();

  const activeAfterUpdate = run('harnesstrim', ['--version']);
  expectExit('updated HarnessTrim executable starts from the active PATH', activeAfterUpdate);
  assert(
    normalizeVersion(activeAfterUpdate.stdout) === latest,
    'active PATH now resolves the registry HarnessTrim version',
    `${activeAfterUpdate.stdout.trim()} vs ${latest}`,
  );

  configured = doctor();
  ht = provider(configured, 'harnesstrim');
  assert(
    normalizeVersion(ht?.version) === latest,
    'doctor refresh observes the updated HarnessTrim version',
    JSON.stringify(ht),
  );
  assert(
    ht?.configuredHarnesses?.includes('claude') && ht?.configuredHarnesses?.includes('codex'),
    'HarnessTrim connections survive the real package update',
    JSON.stringify(ht),
  );
  verifyHarness('claude');
  verifyHarness('codex');

  const removed = thJson([
    'uninstall',
    '--harness',
    'claude',
    '--provider',
    'harnesstrim',
    '--yes',
  ]);
  assert(
    removed.data?.outcome === 'committed' || removed.data?.outcome === 'nothing-to-do',
    'Claude HarnessTrim removal completes transactionally',
    JSON.stringify(removed),
  );

  const afterRemoval = doctor();
  const afterRemovalHt = provider(afterRemoval, 'harnesstrim');
  assert(
    !afterRemovalHt?.configuredHarnesses?.includes('claude') &&
      afterRemovalHt?.configuredHarnesses?.includes('codex'),
    'removal is scoped to Claude and leaves Codex connected',
    JSON.stringify(afterRemovalHt),
  );

  await guidedSetup('claude');
  const finalDoctor = doctor();
  const finalHt = provider(finalDoctor, 'harnesstrim');
  assert(
    finalHt?.configuredHarnesses?.includes('claude') &&
      finalHt?.configuredHarnesses?.includes('codex'),
    'latest HarnessTrim can reconnect Claude after removal',
    JSON.stringify(finalHt),
  );

  for (const [path, expected] of protectedFiles) {
    assert(
      readFileSync(path, 'utf8') === expected,
      `full lifecycle leaves protected user file unchanged: ${path.slice(home.length + 1)}`,
    );
  }

  console.log(
    '\nlive smoke: real first-run setup, update, verification, removal and re-setup passed',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
