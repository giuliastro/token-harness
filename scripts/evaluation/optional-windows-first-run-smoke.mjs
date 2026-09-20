/**
 * Windows-only real first-run gate for the optional-provider path users exercise from the guided UI.
 *
 * It deliberately starts with current Claude Code present and GitNexus absent, inside isolated user
 * and npm-global directories. The exact built Token Harness bundle must:
 *   1. report GitNexus as an actionable Claude setup instead of "No compatible automatic setup";
 *   2. preview an npm installation plus the reviewed MCP registration;
 *   3. apply both through the normal stored-plan transaction;
 *   4. re-detect the newly installed GitNexus runtime and exact Claude MCP entry.
 *
 * No model prompt, login, repository indexing, gitnexus setup, or MCP server is started.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGuideCall, GuideService } from '../../apps/cli/dist/src/guided.js';
import {
  buildCommandInterpreterCommandLine,
  NodeFileSystem,
  resolveCommandInterpreter,
  resolveHostEnvironment,
} from '../../packages/platform/dist/src/index.js';

if (process.platform !== 'win32') {
  console.error('This live smoke is intentionally Windows-only.');
  process.exit(2);
}

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(repoRoot, 'dist', 'bundle', 'token-harness.mjs');
const root = join(repoRoot, 'dist', 'optional-windows-first-run-smoke');
const home = join(root, 'home');
const prefix = join(root, 'npm-prefix');
const nodeDir = dirname(process.execPath);

rmSync(root, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
mkdirSync(prefix, { recursive: true });

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'path' || key.toLowerCase() === 'npm_config_prefix') delete env[key];
}
env.HOME = home;
env.USERPROFILE = home;
env.APPDATA = join(home, 'AppData', 'Roaming');
env.LOCALAPPDATA = join(home, 'AppData', 'Local');
env.NPM_CONFIG_PREFIX = prefix;
// npm.cmd ships beside node.exe on the setup-node Windows runner. Keep only that runtime plus the
// isolated global prefix so a pre-existing GitNexus elsewhere on the runner can never satisfy this test.
env.Path = [prefix, nodeDir].join(delimiter);
env.NO_COLOR = '1';

function fail(label, detail = '') {
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
  process.exit(1);
}

function ok(label) {
  console.log(`ok    ${label}`);
}

function run(executable, args, accepted = [0], timeout = 600_000) {
  const result = spawnSync(executable, args, {
    cwd: home,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) fail(`${executable} ${args.join(' ')} starts`, result.error.message);
  if (!accepted.includes(result.status)) {
    fail(
      `${executable} ${args.join(' ')} exits as expected`,
      `exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function runBatchShim(path, args, accepted = [0], timeout = 600_000) {
  const interpreter = resolveCommandInterpreter(env, win32.join);
  if (interpreter === null) fail('Windows command interpreter resolves');
  const built = buildCommandInterpreterCommandLine(interpreter, path, args);
  if (!built.ok) fail('Windows batch-shim command line is safe', JSON.stringify(built));
  const result = spawnSync(built.invocation.interpreter, [...built.invocation.args], {
    cwd: home,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  if (result.error) fail(`${path} ${args.join(' ')} starts`, result.error.message);
  if (!accepted.includes(result.status)) {
    fail(
      `${path} ${args.join(' ')} exits as expected`,
      `exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function thJson(args, accepted = [0]) {
  const result = run(process.execPath, [entry, ...args, '--json'], accepted);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `token-harness ${args.join(' ')} returns JSON`,
      `${error instanceof Error ? error.message : String(error)}\n${result.stdout}`,
    );
  }
}

function provider(report, id) {
  return report.data?.providers?.find((item) => item.providerId === id) ?? null;
}

function assert(condition, label, detail = '') {
  if (!condition) fail(label, detail);
  ok(label);
}

// Use the same in-process browser boundary as the real guided application. In particular this
// preserves read-only update/savings translation while letting approved mutations reach the normal
// transaction commands.
for (const key of Object.keys(process.env)) {
  if (key.toLowerCase() === 'path' || key.toLowerCase() === 'npm_config_prefix') {
    delete process.env[key];
  }
}
for (const [key, value] of Object.entries(env)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const resolution = resolveHostEnvironment();
if (!resolution.ok)
  fail('isolated Windows Token Harness host environment resolves', JSON.stringify(resolution));
const localFs = new NodeFileSystem(resolution.environment.facts);
const guideCall = createGuideCall({
  platform: resolution.environment.facts,
  cwd: home,
  home: resolution.environment.paths.home,
  stateRoot: resolution.environment.paths.state,
  environmentDiagnostics: [],
  adapters: {
    fs: localFs,
    runner: resolution.environment.runner,
    resolveExecutables: resolution.environment.resolveExecutables,
    paths: resolution.environment.paths,
    localDatabase: null,
    projectIdFor: () => 'p_optional_windows_first_run',
  },
  metrics: null,
  env: process.env,
  stdoutIsTty: false,
});

let ticketCounter = 0;
const guide = new GuideService(
  guideCall,
  () => Date.now(),
  () => `windows-live-ticket-${++ticketCounter}`,
);

try {
  const installClaude = runBatchShim(join(nodeDir, 'npm.cmd'), [
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    '@anthropic-ai/claude-code@latest',
  ]);
  assert(installClaude.status === 0, 'current Claude Code installs into isolated npm prefix');

  const claude = runBatchShim(join(prefix, 'claude.cmd'), ['--version']);
  assert(claude.stdout.trim().length > 0, 'current Claude Code executable starts');

  const before = thJson(['doctor']);
  const beforeGitNexus = provider(before, 'gitnexus');
  assert(beforeGitNexus?.state === 'absent', 'doctor observes GitNexus absent');
  assert(
    beforeGitNexus?.assignableHarnesses?.includes('claude'),
    'doctor still exposes the reviewed npm → Claude setup path while GitNexus is absent',
    JSON.stringify(beforeGitNexus),
  );

  const overview = await guide.overview('all', true);
  const claudeAgent = overview.agents.find((agent) => agent.id === 'claude');
  const target = claudeAgent?.setup.find((item) => item.providerId === 'gitnexus');
  assert(
    target?.state === 'actionable',
    'guided UI marks absent GitNexus actionable on Windows',
    JSON.stringify(target),
  );
  assert(
    !String(target?.reason ?? '').includes('No compatible automatic setup surface'),
    'guided UI does not emit the old generic no-compatible-surface failure',
    String(target?.reason ?? ''),
  );

  const preview = await guide.preview({
    action: 'setup',
    harness: 'claude',
    provider: 'gitnexus',
  });
  assert(
    typeof preview.ticket === 'string' && preview.ticket.length > 0,
    'GitNexus first-run setup produces an approval ticket',
    JSON.stringify(preview),
  );
  assert(
    preview.changes.length >= 2,
    'preview includes package installation plus Claude MCP configuration',
    JSON.stringify(preview.changes),
  );
  assert(preview.network === true, 'preview declares the npm network action');

  const applied = await guide.apply({ ticket: preview.ticket });
  assert(
    applied.ok === true && applied.appliedPlans === 1,
    'approved GitNexus first-run setup commits through the guided transaction',
    JSON.stringify(applied),
  );

  const gitnexus = runBatchShim(join(prefix, 'gitnexus.cmd'), ['--version']);
  assert(
    /1\.6\.12/.test(`${gitnexus.stdout}\n${gitnexus.stderr}`),
    'active PATH resolves the exact reviewed GitNexus 1.6.12 runtime',
    `${gitnexus.stdout}\n${gitnexus.stderr}`,
  );

  const after = thJson(['doctor']);
  const afterGitNexus = provider(after, 'gitnexus');
  assert(
    afterGitNexus?.configuredHarnesses?.includes('claude'),
    'doctor observes GitNexus connected to Claude after apply',
    JSON.stringify(afterGitNexus),
  );

  const claudeConfig = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
  assert(
    claudeConfig?.mcpServers?.gitnexus?.command === 'gitnexus' &&
      JSON.stringify(claudeConfig?.mcpServers?.gitnexus?.args) === JSON.stringify(['mcp']),
    'Claude user config contains exactly the reviewed GitNexus MCP registration',
    JSON.stringify(claudeConfig?.mcpServers?.gitnexus),
  );

  console.log('\nWindows optional-provider first-run smoke passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
