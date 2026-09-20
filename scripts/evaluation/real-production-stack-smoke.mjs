#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const cli = join(root, 'dist', 'bundle', 'token-harness.mjs');
// Keep the machine-local state outside the scratch project exactly as a normal user home would be.
const home = mkdtempSync(join(dirname(root), '.token-harness-real-home-'));
const projectRoot = join(root, '.real-production-project');
mkdirSync(projectRoot, { recursive: true });
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  XDG_STATE_HOME: join(home, '.local', 'state'),
};

function run(args, { allowFailure = false } = {}) {
  process.stdout.write(`\n$ token-harness ${args.join(' ')}\n`);
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args, '--json'], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    process.stdout.write(stdout);
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.stdout) process.stdout.write(String(error.stdout));
    if (allowFailure && error?.stdout) return JSON.parse(String(error.stdout));
    throw error;
  }
}

function planAndApply(harness, provider) {
  const planned = run(['plan', '--harness', harness, '--provider', provider]);
  const id = planned?.data?.planId;
  if (!id || planned?.data?.persisted !== true || !Array.isArray(planned?.data?.actions) || planned.data.actions.length === 0) {
    throw new Error(`Expected an actionable persisted ${provider} plan for ${harness}: ${JSON.stringify(planned)}`);
  }
  const applied = run(['apply', '--plan', id, '--yes']);
  if (applied?.data?.outcome !== 'committed') {
    throw new Error(`Expected committed ${provider} setup for ${harness}: ${JSON.stringify(applied)}`);
  }
  return { planned, applied };
}

function provider(doctor, id) {
  return doctor?.data?.providers?.find((entry) => entry.providerId === id);
}

if (process.env.TOKEN_HARNESS_REAL_STACK !== '1') {
  throw new Error('This live smoke requires TOKEN_HARNESS_REAL_STACK=1');
}

// These are the exact versions from the reported broken Linux setup.
const initial = run(['doctor'], { allowFailure: true });
const h0 = provider(initial, 'harnesstrim');
const r0 = provider(initial, 'rtk');
if (h0?.version !== '0.2.1') throw new Error(`Expected HarnessTrim 0.2.1, got ${h0?.version}`);
if (r0?.version !== '0.44.0') throw new Error(`Expected RTK 0.44.0, got ${r0?.version}`);

// HarnessTrim must be independently setup-able for both current agents.
planAndApply('codex', 'harnesstrim');
let afterCodex = run(['doctor'], { allowFailure: true });
if (!provider(afterCodex, 'harnesstrim')?.configuredHarnesses?.includes('codex')) {
  throw new Error('HarnessTrim setup committed but Codex was not detected as configured');
}

planAndApply('claude', 'harnesstrim');
let afterClaude = run(['doctor'], { allowFailure: true });
for (const harness of ['claude', 'codex']) {
  if (!provider(afterClaude, 'harnesstrim')?.configuredHarnesses?.includes(harness)) {
    throw new Error(`HarnessTrim setup committed but ${harness} was not detected as configured`);
  }
}

// RTK is currently a Claude integration. Its plan/apply path must really commit and then be detected.
planAndApply('claude', 'rtk');
let afterRtk = run(['doctor'], { allowFailure: true });
if (!provider(afterRtk, 'rtk')?.configuredHarnesses?.includes('claude')) {
  throw new Error('RTK setup committed but Claude was not detected as configured');
}

// Update must actually replace HarnessTrim, not just report that an update was applied.
const latest = execFileSync('npm', ['view', 'harnesstrim', 'version'], {
  encoding: 'utf8',
  env,
}).trim();
if (!latest || latest === '0.2.1') throw new Error(`Expected a newer HarnessTrim than 0.2.1, npm returned ${latest}`);

const preview = run(['update', '--provider', 'harnesstrim'], { allowFailure: true });
const confirmation = preview?.diagnostics?.find((entry) => entry.code === 'confirmation-required');
if (
  preview?.exitCode !== 8 ||
  typeof confirmation?.message !== 'string' ||
  !confirmation.message.includes('0.2.1') ||
  !confirmation.message.includes(latest)
) {
  throw new Error(`Expected a reviewed HarnessTrim 0.2.1 → ${latest} update preview: ${JSON.stringify(preview)}`);
}

const updated = run(['update', '--provider', 'harnesstrim', '--yes']);
if (updated?.data?.execution?.outcome !== 'committed') {
  throw new Error(`Expected HarnessTrim update transaction to commit: ${JSON.stringify(updated)}`);
}
if (!updated?.data?.execution?.results?.some((entry) => entry.status === 'applied' || entry.status === 'already-satisfied')) {
  throw new Error(`Update claimed success without an applied transaction entry: ${JSON.stringify(updated)}`);
}

const activeVersion = execFileSync('harnesstrim', ['--version'], { encoding: 'utf8', env }).trim();
if (!activeVersion.includes(latest)) {
  throw new Error(`HarnessTrim update returned success but active executable is ${activeVersion}; expected ${latest}`);
}

const finalDoctor = run(['doctor'], { allowFailure: true });
if (provider(finalDoctor, 'harnesstrim')?.version !== latest) {
  throw new Error(`Token Harness still detects HarnessTrim ${provider(finalDoctor, 'harnesstrim')?.version}; expected ${latest}`);
}

// If the new version changes its skill artifacts, setup must remain usable and converge again.
for (const harness of ['codex', 'claude']) {
  const final = run(['plan', '--harness', harness, '--provider', 'harnesstrim']);
  const actions = final?.data?.actions ?? [];
  if (actions.length > 0) {
    const id = final?.data?.planId;
    if (!id || final?.data?.persisted !== true) throw new Error(`Unpersisted post-update plan for ${harness}`);
    const applied = run(['apply', '--plan', id, '--yes']);
    if (applied?.data?.outcome !== 'committed') throw new Error(`Post-update setup failed for ${harness}`);
  }
}

const converged = run(['doctor'], { allowFailure: true });
for (const harness of ['claude', 'codex']) {
  if (!provider(converged, 'harnesstrim')?.configuredHarnesses?.includes(harness)) {
    throw new Error(`Final HarnessTrim state is not connected to ${harness}`);
  }
}

console.log('\nReal production-stack smoke passed.');
