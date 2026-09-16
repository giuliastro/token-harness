#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const CLAUDE_VERSION = '2.1.269';
const GITNEXUS_VERSION = '1.6.12';
const MODEL = 'haiku';
const MAX_BUDGET_USD = '0.10';
const MAX_TURNS = '3';
const EXPECTED_ANSWER = '2';
const EXPECTED_FILE = 'apps/cli/src/commands/candidate-benchmark.ts';
const RESPONSE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    answer: { type: 'string' },
    evidence_files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
  },
  required: ['answer', 'evidence_files'],
  additionalProperties: false,
});

function secrets() {
  return [process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_CODE_OAUTH_TOKEN].filter(Boolean);
}

function sanitize(value) {
  let text = String(value ?? '');
  for (const secret of secrets()) text = text.split(secret).join('[redacted]');
  return text;
}

async function run(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        rejectPromise(new Error(`${command} exited ${result.code}: ${sanitize(stderr || stdout).trim()}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function versionOf(text) {
  return String(text).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

function parseStream(text) {
  const events = String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const init = events.find((event) => event?.type === 'system' && event?.subtype === 'init') ?? null;
  const result = [...events].reverse().find((event) => event?.type === 'result') ?? null;
  const toolNames = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.type === 'tool_use' && typeof value.name === 'string') toolNames.push(value.name);
    Object.values(value).forEach(walk);
  };
  walk(events);
  const mcpServers = Array.isArray(init?.mcp_servers) ? init.mcp_servers : [];
  const gitnexus = mcpServers.find((server) => server?.name === 'gitnexus') ?? null;
  const structured = result?.structured_output ?? null;
  return {
    model: init?.model ?? null,
    gitnexusServer: gitnexus,
    gitnexusTools: [...new Set(toolNames.filter((name) => name.startsWith('mcp__gitnexus__')))],
    answer: structured?.answer ?? null,
    evidenceFiles: structured?.evidence_files ?? [],
    totalCostUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
    usage: result?.usage ?? null,
    isError: result?.is_error === true,
  };
}

async function tokenHarness(repo, args) {
  return await run(process.execPath, [resolve(repo, 'dist/bundle/token-harness.mjs'), ...args], { cwd: repo });
}

async function lifecycle(repo, action) {
  return await tokenHarness(repo, [
    action,
    '--candidate', 'gitnexus',
    '--harness', 'claude',
    '--project', repo,
    '--yes',
    '--json',
  ]);
}

async function ensureIndex(repo) {
  const status = await run('gitnexus', ['status', '--json'], { cwd: repo, allowFailure: true });
  let ready = false;
  if (status.code === 0) {
    try {
      const parsed = JSON.parse(status.stdout);
      ready = parsed?.schemaVersion === 1 && parsed?.status === 'up-to-date';
    } catch {
      ready = false;
    }
  }
  if (!ready) await run('gitnexus', ['analyze', '--index-only'], { cwd: repo });
  const after = await run('gitnexus', ['status', '--json'], { cwd: repo });
  const parsed = JSON.parse(after.stdout);
  if (parsed?.schemaVersion !== 1 || parsed?.status !== 'up-to-date') {
    throw new Error('GitNexus index is not up-to-date after isolated preparation');
  }
}

async function callClaude(repo, optimized) {
  const prompt = [
    'This is a read-only Token Harness smoke test. Do not modify files or configuration.',
    'Answer from the checked-out repository, not from prior knowledge.',
    optimized
      ? 'A GitNexus MCP server should be available. Call at least one mcp__gitnexus__* tool and use it before answering.'
      : 'GitNexus must not be available. Use only the built-in read-only repository tools.',
    'How many baseline/optimized pairs per task class does the candidate campaign planner create? Return the exact decimal number as a string.',
    'Return evidence_files as repository-relative paths.',
  ].join('\n');
  const execution = await run(
    'claude',
    [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--model', MODEL,
      '--tools', 'Read,Glob,Grep',
      '--allowedTools', 'Read,Glob,Grep,mcp__gitnexus__*',
      '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task',
      '--permission-mode', 'dontAsk',
      '--max-turns', MAX_TURNS,
      '--max-budget-usd', MAX_BUDGET_USD,
      '--json-schema', RESPONSE_SCHEMA,
    ],
    { cwd: repo, allowFailure: true },
  );
  if (execution.code !== 0) {
    throw new Error(`Claude smoke call failed: ${sanitize(execution.stderr || execution.stdout).trim()}`);
  }
  return parseStream(execution.stdout);
}

function validateQuality(label, result) {
  if (result.isError) throw new Error(`${label}: Claude result marked is_error`);
  if (String(result.answer).trim() !== EXPECTED_ANSWER) {
    throw new Error(`${label}: expected answer ${EXPECTED_ANSWER}, observed ${String(result.answer)}`);
  }
  if (!Array.isArray(result.evidenceFiles) || !result.evidenceFiles.includes(EXPECTED_FILE)) {
    throw new Error(`${label}: expected evidence file ${EXPECTED_FILE} was not returned`);
  }
}

async function main() {
  const repo = resolve(process.cwd());
  const artifactDir = resolve(repo, 'artifacts/gitnexus-frugal-smoke');
  await mkdir(artifactDir, { recursive: true });
  if (process.platform !== 'linux' || process.env.WSL_DISTRO_NAME) {
    throw new Error('frugal smoke requires native Linux');
  }
  if (secrets().length !== 1) {
    throw new Error('Configure exactly one Claude credential for an unambiguous smoke run');
  }

  const [claudeVersionResult, gitnexusVersionResult] = await Promise.all([
    run('claude', ['--version']),
    run('gitnexus', ['--version']),
  ]);
  const claudeVersion = versionOf(claudeVersionResult.stdout || claudeVersionResult.stderr);
  const gitnexusVersion = versionOf(gitnexusVersionResult.stdout || gitnexusVersionResult.stderr);
  if (claudeVersion !== CLAUDE_VERSION) throw new Error(`expected Claude ${CLAUDE_VERSION}, observed ${claudeVersion}`);
  if (gitnexusVersion !== GITNEXUS_VERSION) throw new Error(`expected GitNexus ${GITNEXUS_VERSION}, observed ${gitnexusVersion}`);

  await ensureIndex(repo);
  let baseline;
  let optimized;
  try {
    await lifecycle(repo, 'uninstall');
    baseline = await callClaude(repo, false);
    validateQuality('baseline', baseline);
    if (baseline.gitnexusServer !== null || baseline.gitnexusTools.length > 0) {
      throw new Error('baseline contamination: GitNexus was visible or used');
    }

    await lifecycle(repo, 'apply');
    optimized = await callClaude(repo, true);
    validateQuality('optimized', optimized);
    if (optimized.gitnexusServer === null) {
      throw new Error('optimized: GitNexus MCP server missing from Claude init');
    }
    if (optimized.gitnexusTools.length === 0) {
      throw new Error('optimized: no mcp__gitnexus__* tool_use event observed');
    }
  } finally {
    await lifecycle(repo, 'uninstall').catch(() => undefined);
  }

  const report = {
    schemaVersion: 1,
    kind: 'frugal-smoke-not-selection-evidence',
    commit: process.env.GITHUB_SHA ?? null,
    claudeVersion,
    gitnexusVersion,
    modelSetting: MODEL,
    maxBudgetUsdPerCall: Number(MAX_BUDGET_USD),
    maxCalls: 2,
    authentication: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription-oauth' : 'api-key',
    baseline,
    optimized,
  };
  await writeFile(join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    observedModels: [...new Set([baseline.model, optimized.model])],
    baselineCostUsd: baseline.totalCostUsd,
    optimizedCostUsd: optimized.totalCostUsd,
    optimizedGitNexusTools: optimized.gitnexusTools,
    report: join(artifactDir, 'report.json'),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${sanitize(error instanceof Error ? error.stack || error.message : String(error))}\n`);
  process.exitCode = 1;
});
