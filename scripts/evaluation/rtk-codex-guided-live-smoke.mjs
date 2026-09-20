/**
 * Real Linux smoke for the RTK -> Codex connection exposed by the guided product.
 *
 * Installs current Codex into an isolated npm prefix, downloads the reviewed RTK 0.49.0
 * release binary, then exercises the same GuideService preview/apply path as the browser.
 * No model call or login is required.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGuideCall, GuideService } from '../../apps/cli/dist/src/guided.js';
import { NodeFileSystem, resolveHostEnvironment } from '../../packages/platform/dist/src/index.js';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error('This live smoke is intentionally Linux x64 only.');
  process.exit(2);
}

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const root = join(repoRoot, 'dist', 'rtk-codex-guided-live-smoke');
const home = join(root, 'home');
const prefix = join(root, 'npm-prefix');
const bin = join(root, 'bin');
const archive = join(root, 'rtk.tar.gz');
const rtkUrl =
  'https://github.com/rtk-ai/rtk/releases/download/v0.49.0/rtk-x86_64-unknown-linux-musl.tar.gz';

rmSync(root, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
mkdirSync(prefix, { recursive: true });
mkdirSync(bin, { recursive: true });

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
function run(executable, args, env, accepted = [0], timeout = 600_000) {
  const result = spawnSync(executable, args, {
    cwd: home,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) fail(`${executable} starts`, result.error.message);
  if (!accepted.includes(result.status))
    fail(
      `${executable} ${args.join(' ')} exits as expected`,
      `exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  return result;
}

const installEnv = { ...process.env, HOME: home };
try {
  const codexInstall = run(
    'npm',
    ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', '@openai/codex@latest'],
    installEnv,
  );
  assert(codexInstall.status === 0, 'current Codex installs into isolated npm prefix');

  const response = await fetch(rtkUrl);
  assert(response.ok, 'reviewed RTK 0.49.0 release downloads', String(response.status));
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  run('tar', ['-xzf', archive, '-C', bin], installEnv);

  const env = { ...installEnv };
  env.PATH = [bin, join(prefix, 'bin'), process.env.PATH || ''].join(delimiter);
  env.NO_COLOR = '1';
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const codex = run(join(prefix, 'bin', 'codex'), ['--version'], env);
  assert(codex.stdout.trim().length > 0, 'current Codex executable starts');
  const rtk = run(join(bin, 'rtk'), ['--version'], env);
  assert(/0\.49\.0/.test(`${rtk.stdout}\n${rtk.stderr}`), 'RTK 0.49.0 executable starts');

  const resolution = resolveHostEnvironment();
  if (!resolution.ok) fail('isolated Token Harness host environment resolves', JSON.stringify(resolution));
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
      projectIdFor: () => 'p_rtk_codex_live',
    },
    metrics: null,
    env: process.env,
    stdoutIsTty: false,
  });
  let ticketCounter = 0;
  const guide = new GuideService(guideCall, () => Date.now(), () => `rtk-codex-live-${++ticketCounter}`);

  const before = await guide.overview('all', true);
  const codexAgent = before.agents.find((agent) => agent.id === 'codex');
  const target = codexAgent?.setup.find((item) => item.providerId === 'rtk');
  assert(target?.state === 'actionable', 'guided UI exposes RTK -> Codex as actionable', JSON.stringify(target));

  const preview = await guide.preview({ action: 'setup', harness: 'codex', provider: 'rtk' });
  assert(typeof preview.ticket === 'string', 'RTK -> Codex preview produces approval ticket', JSON.stringify(preview));
  assert(
    preview.changes.some((change) => /Codex/i.test(change.title + ' ' + change.description)),
    'preview names the Codex configuration change',
    JSON.stringify(preview.changes),
  );

  const applied = await guide.apply({ ticket: preview.ticket });
  assert(applied.ok === true && applied.appliedPlans === 1, 'approved RTK -> Codex setup commits');

  const agentsPath = join(home, '.codex', 'AGENTS.md');
  const agents = readFileSync(agentsPath, 'utf8');
  assert(
    agents.includes('token-harness:rtk-codex:start') &&
      agents.includes('Prefix shell commands with `rtk`') &&
      agents.includes('token-harness:rtk-codex:end'),
    'Codex global AGENTS.md contains the owned RTK instruction block',
    agents,
  );

  const after = await guide.overview('all', true);
  const afterCodex = after.agents.find((agent) => agent.id === 'codex');
  const afterTarget = afterCodex?.setup.find((item) => item.providerId === 'rtk');
  assert(afterTarget?.state === 'connected', 'doctor/guided refresh observes RTK connected to Codex', JSON.stringify(afterTarget));

  console.log('\nRTK -> Codex guided live smoke passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
