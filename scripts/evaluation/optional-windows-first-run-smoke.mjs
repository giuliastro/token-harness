/**
 * Windows-only real first-run gate for every optional provider exposed by the guided UI.
 *
 * The gate uses an isolated HOME and package-manager state, current Claude Code and Codex, and the
 * exact built Token Harness bundle. It proves two Windows paths that unit fixtures cannot:
 *
 * 1. without pipx/uv, mcptoon and Headroom show precise prerequisite guidance instead of the old
 *    "No compatible automatic setup surface detected" dead end;
 * 2. once reviewed package-manager prerequisites are present, GitNexus, mcptoon and Headroom are
 *    installed, configured and re-detected through the same guided preview/apply boundary a user
 *    clicks.
 *
 * No model prompt, login, repository indexing, MCP server process, or destructive MCP call is run.
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
const prefix = join(root, 'tool-bin');
const nodeDir = dirname(process.execPath);
const pythonLocation = process.env.pythonLocation ?? null;
const pythonScripts = pythonLocation === null ? null : join(pythonLocation, 'Scripts');

rmSync(root, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
mkdirSync(prefix, { recursive: true });

const baseEnv = { ...process.env };
for (const key of Object.keys(baseEnv)) {
  if (key.toLowerCase() === 'path' || key.toLowerCase() === 'npm_config_prefix')
    delete baseEnv[key];
}
baseEnv.HOME = home;
baseEnv.USERPROFILE = home;
baseEnv.APPDATA = join(home, 'AppData', 'Roaming');
baseEnv.LOCALAPPDATA = join(home, 'AppData', 'Local');
baseEnv.NPM_CONFIG_PREFIX = prefix;
baseEnv.PIPX_HOME = join(root, 'pipx-home');
baseEnv.PIPX_BIN_DIR = prefix;
baseEnv.UV_TOOL_DIR = join(root, 'uv-tools');
baseEnv.UV_TOOL_BIN_DIR = prefix;
baseEnv.NO_COLOR = '1';
baseEnv.PYTHONUTF8 = '1';
baseEnv.Path = [prefix, nodeDir].join(delimiter);

function fail(label, detail = '') {
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
  process.exit(1);
}

function ok(label) {
  console.log(`ok    ${label}`);
}

function assert(condition, label, detail = '') {
  if (!condition) fail(label, detail);
  ok(label);
}

assert(
  pythonLocation !== null && pythonScripts !== null,
  'setup-python exposed pythonLocation for the Windows optional-provider gate',
  String(process.env.pythonLocation ?? ''),
);

baseEnv.PIPX_DEFAULT_PYTHON = join(pythonLocation, 'python.exe');
baseEnv.UV_PYTHON = join(pythonLocation, 'python.exe');

const installerEnv = {
  ...baseEnv,
  Path: [prefix, nodeDir, pythonLocation, pythonScripts].join(delimiter),
};

let activeEnv = baseEnv;

function activate(nextEnv) {
  activeEnv = nextEnv;
  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === 'path' || key.toLowerCase() === 'npm_config_prefix') {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function run(executable, args, accepted = [0], timeout = 600_000) {
  const result = spawnSync(executable, args, {
    cwd: home,
    env: activeEnv,
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

function runBatchShim(pathname, args, accepted = [0], timeout = 600_000) {
  const interpreter = resolveCommandInterpreter(activeEnv, win32.join);
  if (interpreter === null) fail('Windows command interpreter resolves');
  const built = buildCommandInterpreterCommandLine(interpreter, pathname, args);
  if (!built.ok) fail('Windows batch-shim command line is safe', JSON.stringify(built));
  const result = spawnSync(built.invocation.interpreter, [...built.invocation.args], {
    cwd: home,
    env: activeEnv,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  if (result.error) fail(`${pathname} ${args.join(' ')} starts`, result.error.message);
  if (!accepted.includes(result.status)) {
    fail(
      `${pathname} ${args.join(' ')} exits as expected`,
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

function normalizeVersion(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '');
}

function createGuide(projectId) {
  activate(activeEnv);
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) {
    fail('isolated Windows Token Harness host environment resolves', JSON.stringify(resolution));
  }
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
      projectIdFor: () => projectId,
    },
    metrics: null,
    env: process.env,
    stdoutIsTty: false,
  });

  let ticketCounter = 0;
  return new GuideService(
    guideCall,
    () => Date.now(),
    () => `windows-live-ticket-${projectId}-${++ticketCounter}`,
  );
}

function setupTarget(overview, harness, providerId) {
  const agent = overview.agents.find((item) => item.id === harness);
  return agent?.setup.find((item) => item.providerId === providerId) ?? null;
}

async function guidedSetup(guide, harness, providerId, minimumChanges, expectNetwork) {
  const preview = await guide.preview({
    action: 'setup',
    harness,
    provider: providerId,
  });
  assert(
    typeof preview.ticket === 'string' && preview.ticket.length > 0,
    `${providerId}/${harness}: first-run setup produces an approval ticket`,
    JSON.stringify(preview),
  );
  assert(
    preview.changes.length >= minimumChanges,
    `${providerId}/${harness}: preview contains the expected concrete changes`,
    JSON.stringify(preview.changes),
  );
  if (expectNetwork) {
    assert(
      preview.network === true,
      `${providerId}/${harness}: first-run preview declares its package-manager network action`,
    );
  }

  const applied = await guide.apply({ ticket: preview.ticket });
  assert(
    applied.ok === true && applied.appliedPlans === 1,
    `${providerId}/${harness}: approved setup commits and verifies through the guided transaction`,
    JSON.stringify(applied),
  );
}

function verifyManaged(providerId, harness) {
  const result = thJson(['verify', '--harness', harness, '--provider', providerId]);
  const row = result.data?.results?.find(
    (item) => item.providerId === providerId && item.harnessId === harness,
  );
  assert(
    result.data?.healthyAtDeclaredTier === true && row !== undefined,
    `${providerId}/${harness}: verify is healthy at the declared tier`,
    JSON.stringify(result),
  );
}

try {
  activate(baseEnv);
  const installHarnesses = runBatchShim(join(nodeDir, 'npm.cmd'), [
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    '@anthropic-ai/claude-code@latest',
    '@openai/codex@latest',
  ]);
  assert(
    installHarnesses.status === 0,
    'current Claude Code and Codex install into the isolated npm prefix',
  );

  const claude = runBatchShim(join(prefix, 'claude.cmd'), ['--version']);
  assert(claude.stdout.trim().length > 0, 'current Claude Code executable starts');
  const codex = runBatchShim(join(prefix, 'codex.cmd'), ['--version']);
  assert(codex.stdout.trim().length > 0, 'current Codex executable starts');

  const noPrereqDoctor = thJson(['doctor']);
  const noPrereqGitNexus = provider(noPrereqDoctor, 'gitnexus');
  const noPrereqMcptoon = provider(noPrereqDoctor, 'mcptoon');
  const noPrereqHeadroom = provider(noPrereqDoctor, 'headroom');

  assert(noPrereqGitNexus?.state === 'absent', 'doctor observes GitNexus absent');
  assert(
    noPrereqGitNexus?.assignableHarnesses?.includes('claude'),
    'GitNexus remains installable because npm is present',
    JSON.stringify(noPrereqGitNexus),
  );
  assert(
    noPrereqMcptoon?.state === 'absent' &&
      (noPrereqMcptoon?.assignableHarnesses?.length ?? -1) === 0,
    'mcptoon is unavailable only while pipx is intentionally hidden',
    JSON.stringify(noPrereqMcptoon),
  );
  assert(
    noPrereqHeadroom?.state === 'absent' &&
      (noPrereqHeadroom?.assignableHarnesses?.length ?? -1) === 0,
    'Headroom is unavailable only while uv is intentionally hidden',
    JSON.stringify(noPrereqHeadroom),
  );

  const noPrereqGuide = createGuide('p_optional_windows_missing_prereqs');
  const noPrereqOverview = await noPrereqGuide.overview('all', true);
  for (const [providerId, prerequisite] of [
    ['mcptoon', 'pipx'],
    ['headroom', 'uv'],
  ]) {
    for (const harness of ['claude', 'codex']) {
      const target = setupTarget(noPrereqOverview, harness, providerId);
      assert(
        target?.state === 'unavailable',
        `${providerId}/${harness}: missing prerequisite is explicit and non-actionable`,
        JSON.stringify(target),
      );
      const reason = String(target?.reason ?? '');
      assert(
        !reason.includes('No compatible automatic setup surface'),
        `${providerId}/${harness}: old generic no-compatible-surface dead end is gone`,
        reason,
      );
      assert(
        reason.toLowerCase().includes(prerequisite),
        `${providerId}/${harness}: guidance names the missing ${prerequisite} prerequisite`,
        reason,
      );
    }
  }

  activate(installerEnv);
  const pipx = run('pipx', ['--version']);
  assert(pipx.stdout.trim().length > 0, 'pipx prerequisite starts in the isolated Windows gate');
  const uv = run('uv', ['--version']);
  assert(uv.stdout.trim().length > 0, 'uv prerequisite starts in the isolated Windows gate');

  const guide = createGuide('p_optional_windows_first_run');
  const before = thJson(['doctor']);
  const beforeGitNexus = provider(before, 'gitnexus');
  const beforeMcptoon = provider(before, 'mcptoon');
  const beforeHeadroom = provider(before, 'headroom');

  assert(
    beforeGitNexus?.state === 'absent' && beforeGitNexus?.assignableHarnesses?.includes('claude'),
    'doctor exposes the reviewed npm → GitNexus → Claude setup path',
    JSON.stringify(beforeGitNexus),
  );
  assert(
    beforeMcptoon?.state === 'absent' &&
      beforeMcptoon?.assignableHarnesses?.includes('claude') &&
      beforeMcptoon?.assignableHarnesses?.includes('codex'),
    'doctor exposes the reviewed pipx → mcptoon setup path for Claude and Codex',
    JSON.stringify(beforeMcptoon),
  );
  assert(
    beforeHeadroom?.state === 'absent' &&
      beforeHeadroom?.assignableHarnesses?.includes('claude') &&
      beforeHeadroom?.assignableHarnesses?.includes('codex'),
    'doctor exposes the reviewed uv → Headroom setup path for Claude and Codex',
    JSON.stringify(beforeHeadroom),
  );

  const overview = await guide.overview('all', true);
  for (const [providerId, harnesses] of [
    ['gitnexus', ['claude']],
    ['mcptoon', ['claude', 'codex']],
    ['headroom', ['claude', 'codex']],
  ]) {
    for (const harness of harnesses) {
      const target = setupTarget(overview, harness, providerId);
      assert(
        target?.state === 'actionable',
        `${providerId}/${harness}: guided UI marks the absent provider actionable on Windows`,
        JSON.stringify(target),
      );
      assert(
        !String(target?.reason ?? '').includes('No compatible automatic setup surface'),
        `${providerId}/${harness}: guided UI never emits the old generic failure`,
        String(target?.reason ?? ''),
      );
    }
  }

  await guidedSetup(guide, 'claude', 'gitnexus', 2, true);
  await guidedSetup(guide, 'claude', 'mcptoon', 2, true);
  await guidedSetup(guide, 'codex', 'mcptoon', 1, false);
  await guidedSetup(guide, 'claude', 'headroom', 2, true);
  await guidedSetup(guide, 'codex', 'headroom', 1, false);

  const gitnexus = runBatchShim(join(prefix, 'gitnexus.cmd'), ['--version']);
  assert(
    /1\.6\.12/.test(`${gitnexus.stdout}\n${gitnexus.stderr}`),
    'active PATH resolves the exact reviewed GitNexus 1.6.12 runtime',
    `${gitnexus.stdout}\n${gitnexus.stderr}`,
  );

  const mcptoon = run(join(prefix, 'mcptoon.exe'), ['--version']);
  assert(
    /0\.7\.10/.test(`${mcptoon.stdout}\n${mcptoon.stderr}`),
    'active PATH resolves the exact reviewed mcptoon 0.7.10 runtime',
    `${mcptoon.stdout}\n${mcptoon.stderr}`,
  );

  const headroom = run(join(prefix, 'headroom.exe'), ['--version']);
  assert(
    /0\.37\.0/.test(`${headroom.stdout}\n${headroom.stderr}`),
    'active PATH resolves the exact reviewed Headroom 0.37.0 runtime',
    `${headroom.stdout}\n${headroom.stderr}`,
  );

  const after = thJson(['doctor']);
  const afterGitNexus = provider(after, 'gitnexus');
  const afterMcptoon = provider(after, 'mcptoon');
  const afterHeadroom = provider(after, 'headroom');

  assert(
    afterGitNexus?.configuredHarnesses?.includes('claude'),
    'doctor observes GitNexus connected to Claude after apply',
    JSON.stringify(afterGitNexus),
  );
  assert(
    afterMcptoon?.configuredHarnesses?.includes('claude') &&
      afterMcptoon?.configuredHarnesses?.includes('codex'),
    'doctor observes mcptoon connected to Claude and Codex after apply',
    JSON.stringify(afterMcptoon),
  );
  assert(
    afterHeadroom?.configuredHarnesses?.includes('claude') &&
      afterHeadroom?.configuredHarnesses?.includes('codex'),
    'doctor observes Headroom connected to Claude and Codex after apply',
    JSON.stringify(afterHeadroom),
  );

  verifyManaged('gitnexus', 'claude');
  verifyManaged('mcptoon', 'claude');
  verifyManaged('mcptoon', 'codex');
  verifyManaged('headroom', 'claude');
  verifyManaged('headroom', 'codex');

  const claudeConfig = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
  assert(
    claudeConfig?.mcpServers?.gitnexus?.command === 'gitnexus' &&
      JSON.stringify(claudeConfig?.mcpServers?.gitnexus?.args) === JSON.stringify(['mcp']),
    'Claude user config contains exactly the reviewed GitNexus MCP registration',
    JSON.stringify(claudeConfig?.mcpServers?.gitnexus),
  );
  assert(
    claudeConfig?.mcpServers?.headroom?.command === 'headroom' &&
      JSON.stringify(claudeConfig?.mcpServers?.headroom?.args) === JSON.stringify(['mcp', 'serve']),
    'Claude user config contains exactly the reviewed Headroom MCP registration',
    JSON.stringify(claudeConfig?.mcpServers?.headroom),
  );

  const mcptoonSkill = readFileSync(join(home, '.claude', 'skills', 'mcptoon', 'SKILL.md'), 'utf8');
  assert(
    mcptoonSkill.includes('name: mcptoon') && mcptoonSkill.includes('mcptoon manifest --compact'),
    'Claude mcptoon skill contains the reviewed managed guidance',
  );

  const agents = readFileSync(join(home, 'AGENTS.md'), 'utf8');
  assert(
    agents.includes('TOKEN-HARNESS:MCPTOON:BEGIN') &&
      agents.includes('TOKEN-HARNESS:MCPTOON:END') &&
      agents.includes('mcptoon manifest --compact'),
    'Codex AGENTS.md contains exactly one managed mcptoon guidance block',
  );

  const codexConfig = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert(
    codexConfig.includes('TOKEN-HARNESS:HEADROOM-MCP:BEGIN') &&
      codexConfig.includes('[mcp_servers.headroom]') &&
      codexConfig.includes('command = "headroom"') &&
      codexConfig.includes('args = ["mcp", "serve"]') &&
      codexConfig.includes('TOKEN-HARNESS:HEADROOM-MCP:END'),
    'Codex config contains the reviewed managed Headroom MCP block',
  );

  // Reproduce the original Windows guided HarnessTrim regression on the same isolated machine:
  // start from 0.2.1, finish setup for both real harnesses, update through the guided UI boundary,
  // prove the active executable changed, and verify both integrations survived the package update.
  const installHarnessTrim = runBatchShim(join(nodeDir, 'npm.cmd'), [
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    'harnesstrim@0.2.1',
  ]);
  assert(installHarnessTrim.status === 0, 'HarnessTrim 0.2.1 installs into the isolated npm prefix');

  const harnesstrim021 = runBatchShim(join(prefix, 'harnesstrim.cmd'), ['--version']);
  assert(
    normalizeVersion(harnesstrim021.stdout) === '0.2.1',
    'active Windows PATH starts with HarnessTrim 0.2.1',
    harnesstrim021.stdout.trim(),
  );

  const harnessTrimGuide = createGuide('p_windows_harnesstrim_lifecycle');
  await guidedSetup(harnessTrimGuide, 'claude', 'harnesstrim', 1, false);
  await guidedSetup(harnessTrimGuide, 'codex', 'harnesstrim', 1, false);

  let harnessTrimDoctor = thJson(['doctor']);
  let harnessTrim = provider(harnessTrimDoctor, 'harnesstrim');
  assert(
    normalizeVersion(harnessTrim?.version) === '0.2.1' &&
      harnessTrim?.configuredHarnesses?.includes('claude') &&
      harnessTrim?.configuredHarnesses?.includes('codex'),
    'doctor observes HarnessTrim 0.2.1 connected to both real Windows harnesses',
    JSON.stringify(harnessTrim),
  );
  verifyManaged('harnesstrim', 'claude');
  verifyManaged('harnesstrim', 'codex');

  const latestHarnessTrimResult = runBatchShim(join(nodeDir, 'npm.cmd'), [
    'view',
    'harnesstrim',
    'version',
    '--json',
  ]);
  const latestHarnessTrim = normalizeVersion(JSON.parse(latestHarnessTrimResult.stdout));
  assert(
    latestHarnessTrim !== '' && latestHarnessTrim !== '0.2.1',
    'npm exposes a newer HarnessTrim release for the Windows guided update',
    latestHarnessTrimResult.stdout,
  );

  const updatePreview = await harnessTrimGuide.checkUpdates();
  assert(
    updatePreview.ok === true &&
      typeof updatePreview.ticket === 'string' &&
      updatePreview.ticket.length > 0,
    'Windows guided Check for updates returns a concrete HarnessTrim approval ticket',
    JSON.stringify(updatePreview),
  );
  const updateApplied = await harnessTrimGuide.apply({ ticket: updatePreview.ticket });
  assert(
    updateApplied.ok === true && updateApplied.appliedPlans > 0,
    'Windows guided HarnessTrim update commits and verifies instead of returning a false green',
    JSON.stringify(updateApplied),
  );
  assert(
    !updateApplied.messages.some((message) => message.includes('No optimizer needed an update')),
    'Windows guided HarnessTrim update never emits the stale "No optimizer needed an update" result',
    JSON.stringify(updateApplied.messages),
  );

  const activeHarnessTrim = runBatchShim(join(prefix, 'harnesstrim.cmd'), ['--version']);
  assert(
    normalizeVersion(activeHarnessTrim.stdout) === latestHarnessTrim,
    'active Windows PATH resolves the registry HarnessTrim version after guided update',
    `${activeHarnessTrim.stdout.trim()} vs ${latestHarnessTrim}`,
  );

  harnessTrimDoctor = thJson(['doctor']);
  harnessTrim = provider(harnessTrimDoctor, 'harnesstrim');
  assert(
    normalizeVersion(harnessTrim?.version) === latestHarnessTrim &&
      harnessTrim?.configuredHarnesses?.includes('claude') &&
      harnessTrim?.configuredHarnesses?.includes('codex'),
    'doctor refresh observes the updated HarnessTrim runtime and both connections',
    JSON.stringify(harnessTrim),
  );
  verifyManaged('harnesstrim', 'claude');
  verifyManaged('harnesstrim', 'codex');

  console.log(
    '\nWindows live guided smoke passed for GitNexus, mcptoon, Headroom and HarnessTrim on Claude Code/Codex.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
