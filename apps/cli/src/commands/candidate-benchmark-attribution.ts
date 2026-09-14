/** Shared candidate-benchmark attribution sidecar helpers. */
import { GITNEXUS_REVIEWED_BENCHMARK_VERSION, parseGitNexusVersion } from '@token-harness/adapters';
import {
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type OptimizationCandidateId,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export const CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION = 1;
export const OPTIMIZATION_CANDIDATES: readonly OptimizationCandidateId[] = [
  'headroom',
  'mcptoon',
  'gitnexus',
];

const CANDIDATE_SET = new Set<string>(OPTIMIZATION_CANDIDATES);

type GitNexusBaselinePurity = 'clean' | 'absent' | 'invalid';

export interface CandidateBenchmarkAttribution {
  schemaVersion: typeof CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION;
  benchmarkId: string;
  candidateId: OptimizationCandidateId;
  projectId: string;
  /** Exact candidate build observed when the experiment requires pinned provenance. */
  candidateVersion?: string;
}

export function candidateBenchmarkAttributionPath(
  context: CommandContext,
  benchmarkId: string,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, 'candidate.json');
}

function benchmarkArtifactPath(
  context: CommandContext,
  benchmarkId: string,
  filename: string,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, filename);
}

export function parseCandidateBenchmarkAttribution(
  value: unknown,
): CandidateBenchmarkAttribution | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const candidateVersion = row['candidateVersion'];
  if (
    row['schemaVersion'] !== CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION ||
    typeof row['benchmarkId'] !== 'string' ||
    typeof row['candidateId'] !== 'string' ||
    !CANDIDATE_SET.has(row['candidateId']) ||
    typeof row['projectId'] !== 'string' ||
    row['projectId'] === '' ||
    (candidateVersion !== undefined &&
      (typeof candidateVersion !== 'string' || candidateVersion === ''))
  ) {
    return null;
  }

  return {
    schemaVersion: CANDIDATE_BENCHMARK_ATTRIBUTION_SCHEMA_VERSION,
    benchmarkId: row['benchmarkId'],
    candidateId: row['candidateId'] as OptimizationCandidateId,
    projectId: row['projectId'],
    ...(candidateVersion === undefined ? {} : { candidateVersion }),
  };
}

async function observedReviewedGitNexusVersion(context: CommandContext): Promise<string | null> {
  if (context.adapters === null) return null;
  const outcome = await context.adapters.runner.run({
    executable: 'gitnexus',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (outcome.failure !== null || outcome.exitCode !== 0) return null;
  const version = parseGitNexusVersion(`${outcome.stdout}\n${outcome.stderr}`);
  return version === GITNEXUS_REVIEWED_BENCHMARK_VERSION ? version : null;
}

async function readJsonArtifact(
  context: CommandContext,
  path: string,
): Promise<'absent' | 'invalid' | unknown> {
  if (context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';
  try {
    return JSON.parse(new TextDecoder().decode(await context.adapters.fs.readFile(path))) as unknown;
  } catch {
    return 'invalid';
  }
}

/**
 * GitNexus selection evidence needs a production-stack-only baseline. The binary may be installed
 * so its exact version can be witnessed, but the harness-native MCP inventory must report GitNexus
 * absent at both task boundaries. A running capture can prove only the start boundary; a completed
 * receipt must prove both. Missing/legacy/ambiguous witness data fails closed without rewriting it.
 */
async function gitNexusBaselinePurity(
  context: CommandContext,
  benchmarkId: string,
): Promise<GitNexusBaselinePurity> {
  const receiptPath = benchmarkArtifactPath(context, benchmarkId, 'baseline.json');
  const capturePath = benchmarkArtifactPath(context, benchmarkId, 'baseline.capture.json');
  if (receiptPath === null || capturePath === null) return 'absent';

  const rawReceipt = await readJsonArtifact(context, receiptPath);
  if (rawReceipt !== 'absent') {
    if (rawReceipt === 'invalid') return 'invalid';
    const parsed = parseTaskBenchmarkReceipt(rawReceipt);
    if (
      !parsed.ok ||
      parsed.receipt.benchmarkId !== benchmarkId ||
      parsed.receipt.variant !== 'baseline'
    ) {
      return 'invalid';
    }
    return parsed.receipt.contextAtStart?.gitNexusMcpRuntimeState === 'absent' &&
      parsed.receipt.contextAtFinish?.gitNexusMcpRuntimeState === 'absent'
      ? 'clean'
      : 'invalid';
  }

  const rawCapture = await readJsonArtifact(context, capturePath);
  if (rawCapture === 'absent') return 'absent';
  if (rawCapture === 'invalid') return 'invalid';
  const parsed = parseTaskBenchmarkCapture(rawCapture);
  if (
    !parsed.ok ||
    parsed.capture.benchmarkId !== benchmarkId ||
    parsed.capture.variant !== 'baseline'
  ) {
    return 'invalid';
  }
  return parsed.capture.contextAtStart?.gitNexusMcpRuntimeState === 'absent' ? 'clean' : 'invalid';
}

export async function readCandidateBenchmarkAttribution(
  context: CommandContext,
  benchmarkId: string,
): Promise<'absent' | 'invalid' | CandidateBenchmarkAttribution> {
  const path = candidateBenchmarkAttributionPath(context, benchmarkId);
  if (path === null || context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';

  try {
    const raw = JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
    const parsed = parseCandidateBenchmarkAttribution(raw);
    if (parsed === null) return 'invalid';
    // Legacy GitNexus sidecars stay parseable for inspection, but without the exact reviewed build
    // and a clean native-MCP baseline they cannot close a candidate evidence gate. Historical
    // receipts are never rewritten.
    if (parsed.candidateId === 'gitnexus') {
      if (parsed.candidateVersion !== GITNEXUS_REVIEWED_BENCHMARK_VERSION) return 'invalid';
      if ((await gitNexusBaselinePurity(context, benchmarkId)) !== 'clean') return 'invalid';
    }
    return parsed;
  } catch {
    return 'invalid';
  }
}

export async function writeCandidateBenchmarkAttribution(
  context: CommandContext,
  value: CandidateBenchmarkAttribution,
): Promise<boolean> {
  const path = candidateBenchmarkAttributionPath(context, value.benchmarkId);
  if (path === null || context.adapters === null) return false;

  let persisted = value;
  if (value.candidateId === 'gitnexus') {
    const candidateVersion = await observedReviewedGitNexusVersion(context);
    if (candidateVersion === null) return false;
    if ((await gitNexusBaselinePurity(context, value.benchmarkId)) !== 'clean') return false;
    persisted = { ...value, candidateVersion };
  }

  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify(persisted, null, 2) + '\n'),
    );
    return true;
  } catch {
    return false;
  }
}
