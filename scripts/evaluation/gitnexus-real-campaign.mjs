#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const CLAUDE_VERSION = '2.1.269';
const GITNEXUS_VERSION = '1.6.12';
const CAMPAIGN_ID = 'gitnexus-claude-eval-real1';
const MAX_ATTEMPTS = 2;
const MAX_TURNS = '6';
const MAX_BUDGET_USD = '0.50';
const MODEL = process.env.GITNEXUS_CAMPAIGN_MODEL?.trim() || 'sonnet';
const COMBINED_STACK_BOUNDARY = Object.freeze({
  state: 'not-collected',
  providers: ['rtk', 'harnesstrim'],
  reason:
    'RTK and HarnessTrim are not installed or activated by this evaluation runner; this campaign does not validate the combined production stack on Claude Code 2.1.269.',
});
const TASK_SUFFIX = { mechanical: 'm', standard: 's', hard: 'h', critical: 'c' };

const TASKS = [
  {
    taskClass: 'mechanical',
    run: 1,
    question:
      'How many baseline/optimized pairs per task class does the candidate campaign planner create? Return the exact decimal number as a string.',
    answer: '2',
    evidenceFile: 'apps/cli/src/commands/candidate-benchmark.ts',
  },
  {
    taskClass: 'mechanical',
    run: 2,
    question:
      'List the candidate campaign task classes in their declared order, joined by commas with no spaces.',
    answer: 'mechanical,standard,hard,critical',
    evidenceFile: 'apps/cli/src/commands/candidate-benchmark.ts',
  },
  {
    taskClass: 'standard',
    run: 1,
    question:
      'For a GitNexus plus Claude campaign slot whose baseline has not started, which two Token Harness operations are sequenced before the human task? Answer as comma-separated command names only.',
    answer: 'uninstall,benchmark-start',
    evidenceFile: 'apps/cli/src/commands/candidate-benchmark.ts',
  },
  {
    taskClass: 'standard',
    run: 2,
    question:
      'For a GitNexus plus Claude campaign slot whose optimized side has not started, which two Token Harness operations are sequenced before the human task? Answer as comma-separated command names only.',
    answer: 'apply,benchmark-start',
    evidenceFile: 'apps/cli/src/commands/candidate-benchmark.ts',
  },
  {
    taskClass: 'hard',
    run: 1,
    question:
      'Which candidate id is currently allowed to map campaign activation state directly to the promotion-readiness activation-verification gate? Answer with the candidate id only.',
    answer: 'mcptoon',
    evidenceFile: 'apps/cli/src/guided-candidate-campaign-status.ts',
  },
  {
    taskClass: 'hard',
    run: 2,
    question:
      'Does the reviewed GitNexus candidate lifecycle apply/uninstall path require an up-to-date GitNexus repository index before it can run? Answer exactly true or false.',
    answer: 'false',
    evidenceFile: 'apps/cli/src/commands/gitnexus-candidate-lifecycle.ts',
  },
  {
    taskClass: 'critical',
    run: 1,
    question:
      'What exact Claude configuration key does Token Harness own in the reviewed GitNexus transactional MCP checkpoint? Answer with the dotted key only.',
    answer: 'mcpServers.gitnexus',
    evidenceFile: 'docs/candidates/gitnexus.md',
  },
  {
    taskClass: 'critical',
    run: 2,
    question:
      'What exact license name is recorded for the reviewed GitNexus 1.6.12 package and blocks generic managed commercial-production promotion? Answer with the license name only.',
    answer: 'PolyForm Noncommercial 1.0.0',
    evidenceFile: 'docs/candidates/gitnexus.md',
  },
];

const RESPONSE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    answer: { type: 'string' },
    evidence_files: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['answer', 'evidence_files'],
  additionalProperties: false,
});

function secretValues() {
  return [process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_CODE_OAUTH_TOKEN].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
}

function sanitize(text) {
  let safe = String(text ?? '');
  for (const secret of secretValues()) safe = safe.split(secret).join('[redacted]');
  return safe;
}

async function run(command, args, options = {}) {
  const started = performance.now();
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
    child.on('close', (code, signal) => {
      const result = {
        command,
        args,
        code: code ?? -1,
        signal,
        stdout,
        stderr,
        wallClockMs: Math.round(performance.now() - started),
      };
      if (result.code !== 0 && options.allowFailure !== true) {
        rejectPromise(
          new Error(
            `${command} exited ${String(result.code)}: ${sanitize(stderr || stdout).trim()}`,
          ),
        );
      } else {
        resolvePromise(result);
      }
    });
  });
}

function firstVersion(text) {
  return String(text).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

function parseJsonLines(text) {
  const events = [];
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid stream-json line ${String(index + 1)}: ${String(error)}`);
    }
  }
  return events;
}

function collectToolNames(value, names = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolNames(item, names);
    return names;
  }
  if (value === null || typeof value !== 'object') return names;
  if (value.type === 'tool_use' && typeof value.name === 'string') names.push(value.name);
  for (const child of Object.values(value)) collectToolNames(child, names);
  return names;
}

function summarizeClaudeStream(text) {
  const events = parseJsonLines(text);
  const init =
    events.find((event) => event?.type === 'system' && event?.subtype === 'init') ?? null;
  const result = [...events].reverse().find((event) => event?.type === 'result') ?? null;
  const toolNames = [...new Set(collectToolNames(events))];
  const mcpServers = Array.isArray(init?.mcp_servers)
    ? init.mcp_servers.map((server) => ({
        name: typeof server?.name === 'string' ? server.name : null,
        status: typeof server?.status === 'string' ? server.status : null,
      }))
    : [];
  const gitnexusServer = mcpServers.find((server) => server.name === 'gitnexus') ?? null;
  const gitnexusToolNames = toolNames.filter((name) => name.startsWith('mcp__gitnexus__'));
  const structured =
    result?.structured_output !== undefined
      ? result.structured_output
      : typeof result?.result === 'string'
        ? (() => {
            try {
              return JSON.parse(result.result);
            } catch {
              return null;
            }
          })()
        : null;
  return {
    events: events.length,
    model: typeof init?.model === 'string' ? init.model : null,
    mcpServers,
    gitnexusServer,
    toolNames,
    gitnexusToolNames,
    gitnexusUsed: gitnexusToolNames.length > 0,
    structuredOutput: structured,
    totalCostUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
    usage: result?.usage ?? null,
    isError: result?.is_error === true,
  };
}

function validateAnswer(summary, task) {
  const output = summary.structuredOutput;
  if (output === null || typeof output !== 'object') {
    return { passed: false, reason: 'missing structured output' };
  }
  if (String(output.answer ?? '').trim() !== task.answer) {
    return { passed: false, reason: `answer mismatch: ${String(output.answer ?? '')}` };
  }
  if (!Array.isArray(output.evidence_files) || !output.evidence_files.includes(task.evidenceFile)) {
    return { passed: false, reason: `missing expected evidence file ${task.evidenceFile}` };
  }
  return { passed: true, reason: 'answer and evidence file match' };
}

function promptFor(task) {
  return [
    'This is a read-only Token Harness evaluation. Do not modify files or configuration.',
    'Answer from the checked-out repository, not from prior knowledge.',
    'If a GitNexus MCP tool is available, call at least one mcp__gitnexus__* tool before answering and use it as part of repository exploration. If it is unavailable, use the built-in read-only repository tools.',
    task.question,
    `Return evidence_files as repository-relative paths. The expected fact has a primary source in the repository; cite the file you actually used.`,
  ].join('\n');
}

async function assertTrackedTreeClean(repo) {
  const unstaged = await run('git', ['diff', '--quiet', '--ignore-submodules', '--'], {
    cwd: repo,
    allowFailure: true,
  });
  const staged = await run('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--'], {
    cwd: repo,
    allowFailure: true,
  });
  if (unstaged.code !== 0 || staged.code !== 0) {
    throw new Error('tracked repository files changed during the read-only campaign');
  }
}

async function tokenHarness(repo, args) {
  const entry = resolve(repo, process.env.TOKEN_HARNESS_CLI || 'dist/bundle/token-harness.mjs');
  return await run(process.execPath, [entry, ...args], { cwd: repo });
}

async function lifecycle(repo, action) {
  return await tokenHarness(repo, [
    action,
    '--candidate',
    'gitnexus',
    '--harness',
    'claude',
    '--project',
    repo,
    '--yes',
    '--json',
  ]);
}

async function benchmarkStart(repo, benchmarkId, variant, taskClass) {
  return await tokenHarness(repo, [
    'benchmark-start',
    '--benchmark-id',
    benchmarkId,
    '--candidate',
    'gitnexus',
    '--variant',
    variant,
    '--task',
    taskClass,
    '--harness',
    'claude',
    '--project',
    repo,
    '--json',
  ]);
}

async function benchmarkFinish(repo, benchmarkId, variant, passed, attempts, failedAttempts) {
  return await tokenHarness(repo, [
    'benchmark-finish',
    '--benchmark-id',
    benchmarkId,
    '--variant',
    variant,
    '--quality',
    passed ? 'passed' : 'failed',
    '--attempts',
    String(attempts),
    '--failed-attempts',
    String(failedAttempts),
    '--project',
    repo,
    '--json',
  ]);
}

async function runClaudeAttempt(repo, task, variant, attempt, logDir) {
  const args = [
    '-p',
    promptFor(task),
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--model',
    MODEL,
    '--tools',
    'Read,Glob,Grep',
    '--allowedTools',
    'Read,Glob,Grep,mcp__gitnexus__*',
    '--disallowedTools',
    'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--max-turns',
    MAX_TURNS,
    '--max-budget-usd',
    MAX_BUDGET_USD,
    '--json-schema',
    RESPONSE_SCHEMA,
  ];
  const execution = await run('claude', args, { cwd: repo, allowFailure: true });
  const safeStdout = sanitize(execution.stdout);
  const safeStderr = sanitize(execution.stderr);
  await writeFile(
    join(logDir, `${task.taskClass}-${String(task.run)}-${variant}-${String(attempt)}.jsonl`),
    safeStdout,
  );
  if (safeStderr.trim() !== '') {
    await writeFile(
      join(
        logDir,
        `${task.taskClass}-${String(task.run)}-${variant}-${String(attempt)}.stderr.txt`,
      ),
      safeStderr,
    );
  }

  let summary = null;
  let validation = { passed: false, reason: `claude exited ${String(execution.code)}` };
  if (execution.code === 0) {
    try {
      summary = summarizeClaudeStream(execution.stdout);
      validation = validateAnswer(summary, task);
      if (summary.isError) validation = { passed: false, reason: 'Claude result marked is_error' };
    } catch (error) {
      validation = { passed: false, reason: String(error) };
    }
  }
  return {
    attempt,
    exitCode: execution.code,
    wallClockMs: execution.wallClockMs,
    validation,
    model: summary?.model ?? null,
    mcpServers: summary?.mcpServers ?? [],
    gitnexusServer: summary?.gitnexusServer ?? null,
    toolNames: summary?.toolNames ?? [],
    gitnexusToolNames: summary?.gitnexusToolNames ?? [],
    gitnexusUsed: summary?.gitnexusUsed ?? false,
    totalCostUsd: summary?.totalCostUsd ?? null,
    usage: summary?.usage ?? null,
  };
}

async function runVariant(repo, task, variant, logDir) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runClaudeAttempt(repo, task, variant, attempt, logDir);
    attempts.push(result);
    await assertTrackedTreeClean(repo);
    if (result.validation.passed) break;
  }
  const passed = attempts.at(-1)?.validation.passed === true;
  return {
    passed,
    attempts,
    failedAttempts: attempts.filter((attempt) => !attempt.validation.passed).length,
    wallClockMs: attempts.reduce((sum, attempt) => sum + attempt.wallClockMs, 0),
    gitnexusUsed: attempts.some((attempt) => attempt.gitnexusUsed),
    gitnexusToolNames: [...new Set(attempts.flatMap((attempt) => attempt.gitnexusToolNames))],
    models: [...new Set(attempts.map((attempt) => attempt.model).filter(Boolean))],
    totalCostUsd: attempts.every((attempt) => typeof attempt.totalCostUsd === 'number')
      ? attempts.reduce((sum, attempt) => sum + attempt.totalCostUsd, 0)
      : null,
  };
}

async function ensureIndexReady(repo) {
  const readStatus = async () => {
    const result = await run('gitnexus', ['status', '--json'], { cwd: repo, allowFailure: true });
    if (result.code !== 0) return { ready: false, status: null, rawExitCode: result.code };
    try {
      const status = JSON.parse(result.stdout);
      return {
        ready: status?.schemaVersion === 1 && status?.status === 'up-to-date',
        status: { schemaVersion: status?.schemaVersion ?? null, status: status?.status ?? null },
        rawExitCode: result.code,
      };
    } catch {
      return { ready: false, status: null, rawExitCode: result.code };
    }
  };

  const before = await readStatus();
  let indexWallClockMs = 0;
  let indexed = false;
  if (!before.ready) {
    const analysis = await run('gitnexus', ['analyze', '--index-only'], { cwd: repo });
    indexWallClockMs = analysis.wallClockMs;
    indexed = true;
  }
  const after = await readStatus();
  if (!after.ready) {
    throw new Error(
      `GitNexus index is not ready after preparation: ${JSON.stringify(after.status)}`,
    );
  }
  await assertTrackedTreeClean(repo);
  return { indexed, indexWallClockMs, before: before.status, after: after.status };
}

async function campaignMatrix(repo) {
  const result = await tokenHarness(repo, [
    'benchmark-matrix',
    '--benchmark-id',
    CAMPAIGN_ID,
    '--candidate',
    'gitnexus',
    '--harness',
    'claude',
    '--project',
    repo,
    '--json',
  ]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('benchmark-matrix did not return JSON');
  }
}

function benchmarkIdFor(task) {
  return `${CAMPAIGN_ID}-${TASK_SUFFIX[task.taskClass]}-${String(task.run)}`;
}

async function writeSummary(report) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const optimizedUsed = report.pairs.filter((pair) => pair.optimized.gitnexusUsed).length;
  const qualityPairs = report.pairs.filter(
    (pair) => pair.baseline.passed && pair.optimized.passed,
  ).length;
  const text = [
    '# GitNexus real Claude campaign',
    '',
    `- Claude Code: ${report.environment.claudeVersion}`,
    `- GitNexus: ${report.environment.gitnexusVersion}`,
    `- Model setting: ${report.environment.modelSetting}`,
    `- Quality-passed pairs: ${String(qualityPairs)}/${String(report.pairs.length)}`,
    `- Optimized pairs with real mcp__gitnexus__* use: ${String(optimizedUsed)}/${String(report.pairs.length)}`,
    `- Index preparation cost: ${String(report.index.indexWallClockMs)} ms (kept separate from task savings)`,
    `- Combined RTK + HarnessTrim evidence: ${report.combinedProductionStackEvidence.state}`,
    '',
    'MCP availability and actual tool use are reported separately. API/headless usage is not Claude Pro 5h/7d quota evidence.',
    '',
  ].join('\n');
  await writeFile(summaryPath, text, { flag: 'a' });
}

async function selfTest() {
  const baselineFixture = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'fixture-model', mcp_servers: [] }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read' }] },
    }),
    JSON.stringify({
      type: 'result',
      structured_output: {
        answer: '2',
        evidence_files: ['apps/cli/src/commands/candidate-benchmark.ts'],
      },
      total_cost_usd: 0.01,
    }),
  ].join('\n');
  const optimizedFixture = [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'fixture-model',
      mcp_servers: [{ name: 'gitnexus', status: 'connected' }],
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'mcp__gitnexus__query' }] },
    }),
    JSON.stringify({
      type: 'result',
      structured_output: {
        answer: '2',
        evidence_files: ['apps/cli/src/commands/candidate-benchmark.ts'],
      },
      total_cost_usd: 0.01,
    }),
  ].join('\n');
  const availabilityOnlyFixture = [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'fixture-model',
      mcp_servers: [{ name: 'gitnexus', status: 'connected' }],
    }),
    JSON.stringify({ type: 'result', structured_output: { answer: 'x', evidence_files: ['x'] } }),
  ].join('\n');

  const baseline = summarizeClaudeStream(baselineFixture);
  const optimized = summarizeClaudeStream(optimizedFixture);
  const availabilityOnly = summarizeClaudeStream(availabilityOnlyFixture);
  if (baseline.gitnexusServer !== null || baseline.gitnexusUsed) {
    throw new Error('self-test: baseline contamination was not kept absent');
  }
  if (optimized.gitnexusServer?.status !== 'connected' || !optimized.gitnexusUsed) {
    throw new Error('self-test: optimized availability/use witness was not detected');
  }
  if (availabilityOnly.gitnexusServer === null || availabilityOnly.gitnexusUsed) {
    throw new Error('self-test: MCP availability was confused with actual tool use');
  }
  if (COMBINED_STACK_BOUNDARY.state !== 'not-collected') {
    throw new Error('self-test: combined production-stack boundary is not fail-closed');
  }
  const answer = validateAnswer(optimized, TASKS[0]);
  if (!answer.passed) throw new Error(`self-test: valid answer rejected: ${answer.reason}`);
  const wrong = validateAnswer(
    summarizeClaudeStream(
      optimizedFixture.replace('apps/cli/src/commands/candidate-benchmark.ts', 'README.md'),
    ),
    TASKS[0],
  );
  if (wrong.passed) throw new Error('self-test: wrong evidence file was accepted');
  process.stdout.write('gitnexus real campaign runner self-test: ok\n');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    return;
  }

  const repo = resolve(process.cwd());
  const artifactRoot = resolve(
    repo,
    process.env.GITNEXUS_CAMPAIGN_ARTIFACT_DIR || 'artifacts/gitnexus-real-campaign',
  );
  const logDir = join(artifactRoot, 'streams');
  await mkdir(logDir, { recursive: true });

  if (process.platform !== 'linux') throw new Error('real GitNexus campaign requires native Linux');
  let procVersion = '';
  try {
    procVersion = await readFile('/proc/version', 'utf8');
  } catch {
    procVersion = '';
  }
  if (process.env.WSL_DISTRO_NAME || /microsoft/i.test(procVersion)) {
    throw new Error('real GitNexus campaign refuses WSL; reviewed row is native Linux only');
  }
  if (secretValues().length === 0) {
    throw new Error(
      'Claude authentication is missing. Configure repository secret ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.',
    );
  }

  const [claudeVersionResult, gitnexusVersionResult] = await Promise.all([
    run('claude', ['--version']),
    run('gitnexus', ['--version']),
  ]);
  const claudeVersion = firstVersion(claudeVersionResult.stdout || claudeVersionResult.stderr);
  const gitnexusVersion = firstVersion(
    gitnexusVersionResult.stdout || gitnexusVersionResult.stderr,
  );
  if (claudeVersion !== CLAUDE_VERSION) {
    throw new Error(`expected Claude Code ${CLAUDE_VERSION}, observed ${String(claudeVersion)}`);
  }
  if (gitnexusVersion !== GITNEXUS_VERSION) {
    throw new Error(`expected GitNexus ${GITNEXUS_VERSION}, observed ${String(gitnexusVersion)}`);
  }

  await assertTrackedTreeClean(repo);
  const index = await ensureIndexReady(repo);
  await campaignMatrix(repo);

  const pairs = [];
  let observedModel = null;
  try {
    for (const task of TASKS) {
      const benchmarkId = benchmarkIdFor(task);

      await lifecycle(repo, 'uninstall');
      await benchmarkStart(repo, benchmarkId, 'baseline', task.taskClass);
      const baseline = await runVariant(repo, task, 'baseline', logDir);
      if (
        baseline.attempts.some((attempt) => attempt.gitnexusServer !== null || attempt.gitnexusUsed)
      ) {
        throw new Error(`baseline contamination detected in ${benchmarkId}`);
      }
      await benchmarkFinish(
        repo,
        benchmarkId,
        'baseline',
        baseline.passed,
        baseline.attempts.length,
        baseline.failedAttempts,
      );

      await lifecycle(repo, 'apply');
      await benchmarkStart(repo, benchmarkId, 'optimized', task.taskClass);
      const optimized = await runVariant(repo, task, 'optimized', logDir);
      if (optimized.attempts.some((attempt) => attempt.gitnexusServer === null)) {
        throw new Error(
          `optimized GitNexus MCP server missing from Claude system/init in ${benchmarkId}`,
        );
      }
      await benchmarkFinish(
        repo,
        benchmarkId,
        'optimized',
        optimized.passed,
        optimized.attempts.length,
        optimized.failedAttempts,
      );
      await lifecycle(repo, 'uninstall');

      const models = [...new Set([...baseline.models, ...optimized.models])];
      if (models.length !== 1) {
        throw new Error(`model drift inside ${benchmarkId}: ${models.join(', ') || 'unknown'}`);
      }
      if (observedModel === null) observedModel = models[0];
      if (models[0] !== observedModel) {
        throw new Error(`model drift across campaign: ${String(observedModel)} -> ${models[0]}`);
      }

      pairs.push({
        benchmarkId,
        taskClass: task.taskClass,
        run: task.run,
        expectedAnswer: task.answer,
        expectedEvidenceFile: task.evidenceFile,
        baseline,
        optimized,
      });
    }
  } finally {
    try {
      await lifecycle(repo, 'uninstall');
    } catch (error) {
      process.stderr.write(
        `warning: final GitNexus lifecycle cleanup failed: ${sanitize(error)}\n`,
      );
    }
  }

  const matrix = await campaignMatrix(repo);
  const report = {
    schemaVersion: 1,
    campaignId: CAMPAIGN_ID,
    recordedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || null,
    environment: {
      platform: process.platform,
      nativeLinux: true,
      claudeVersion,
      gitnexusVersion,
      modelSetting: MODEL,
      observedModel,
      authentication: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription-oauth' : 'api-key',
    },
    combinedProductionStackEvidence: COMBINED_STACK_BOUNDARY,
    index,
    pairs,
    actualUseWitness: {
      optimizedPairsWithGitNexusUse: pairs.filter((pair) => pair.optimized.gitnexusUsed).length,
      totalOptimizedPairs: pairs.length,
      note: 'Actual use requires an observed mcp__gitnexus__* tool_use event. MCP server presence alone is not counted.',
    },
    tokenHarnessMatrix: matrix,
    interpretationBoundary:
      'Headless/API usage and cost are evaluation evidence only and are not Claude Pro five-hour or seven-day subscription-quota savings. This run does not validate the combined RTK + HarnessTrim production stack on Claude Code 2.1.269.',
  };
  await writeFile(join(artifactRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeSummary(report);
  process.stdout.write(
    `${JSON.stringify({
      campaignId: CAMPAIGN_ID,
      pairs: pairs.length,
      qualityPassedPairs: pairs.filter((pair) => pair.baseline.passed && pair.optimized.passed)
        .length,
      optimizedPairsWithGitNexusUse: report.actualUseWitness.optimizedPairsWithGitNexusUse,
      combinedProductionStackEvidence: report.combinedProductionStackEvidence.state,
      observedModel,
      report: join(artifactRoot, 'report.json'),
    })}\n`,
  );
}

main().catch(async (error) => {
  const message = sanitize(error instanceof Error ? error.stack || error.message : String(error));
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});