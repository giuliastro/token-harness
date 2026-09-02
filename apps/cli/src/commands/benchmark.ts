/**
 * `token-harness benchmark` — compare two user-supplied paired task receipts.
 *
 * Read-only. This command does not run a harness, mutate configuration, or derive subscription
 * quota from local tokens. It only parses two receipt files and applies the deterministic RFC 0011
 * comparator.
 */

import {
  EXIT_CODES,
  commandResult,
  compareTaskBenchmarkReceipts,
  diagnostic,
  parseTaskBenchmarkReceipt,
  type CommandResult,
  type Diagnostic,
  type TaskBenchmarkCompareReport,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

function isAbsolutePath(context: CommandContext, path: string): boolean {
  if (context.platform.os === 'windows') {
    return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path);
  }
  return path.startsWith('/');
}

function receiptPath(context: CommandContext, path: string): string {
  if (isAbsolutePath(context, path) || context.adapters === null) return path;
  return context.adapters.fs.join(context.projectRoot, path);
}

async function readReceipt(
  context: CommandContext,
  path: string,
  role: 'baseline' | 'optimized',
): Promise<{ receipt: TaskBenchmarkReceipt | null; diagnostic: Diagnostic | null }> {
  if (context.adapters === null) {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'benchmark-filesystem-unavailable',
        message: 'No filesystem adapter is available to read benchmark receipts',
        remediation: 'Run Token Harness in its normal local CLI environment',
      }),
    };
  }

  const absolute = receiptPath(context, path);
  const stat = await context.adapters.fs.stat(absolute);
  if (stat === null || stat.kind !== 'file') {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'benchmark-receipt-not-found',
        message: `The ${role} benchmark receipt is not a readable file`,
        path: absolute,
        remediation: `Pass --${role} <receipt.json> with an existing JSON receipt`,
      }),
    };
  }

  let text: string;
  try {
    text = new TextDecoder().decode(await context.adapters.fs.readFile(absolute));
  } catch {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'benchmark-receipt-read-failed',
        message: `The ${role} benchmark receipt could not be read`,
        path: absolute,
        remediation: 'Check the file permissions and retry',
      }),
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'benchmark-receipt-invalid-json',
        message: `The ${role} benchmark receipt is not valid JSON`,
        path: absolute,
        remediation: 'Fix or regenerate the receipt before comparing it',
      }),
    };
  }

  const parsed = parseTaskBenchmarkReceipt(parsedJson);
  if (!parsed.ok) {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code:
          parsed.reason === 'unsupported-schema'
            ? 'benchmark-receipt-schema-unsupported'
            : 'benchmark-receipt-invalid-shape',
        message: `The ${role} benchmark receipt is invalid: ${parsed.message}`,
        path: absolute,
        remediation:
          parsed.reason === 'unsupported-schema'
            ? 'Upgrade Token Harness before comparing a newer receipt schema'
            : 'Regenerate the receipt using the paired task benchmark contract',
      }),
    };
  }

  if (parsed.receipt.variant !== role) {
    return {
      receipt: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'benchmark-receipt-role-mismatch',
        message: `--${role} received a receipt whose variant is ${parsed.receipt.variant}`,
        path: absolute,
        remediation: `Pass a receipt with variant ${role} to --${role}`,
      }),
    };
  }

  return { receipt: parsed.receipt, diagnostic: null };
}

export async function runBenchmark(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCompareReport | null>> {
  const baselinePath = context.baselineReceipt ?? null;
  const optimizedPath = context.optimizedReceipt ?? null;
  if (baselinePath === null || optimizedPath === null) {
    return commandResult({
      command: 'benchmark',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-receipts-required',
          message: 'Benchmark comparison requires both --baseline and --optimized receipt files',
          remediation:
            'Run token-harness benchmark --baseline baseline.json --optimized optimized.json',
        }),
      ],
    });
  }

  const baseline = await readReceipt(context, baselinePath, 'baseline');
  if (baseline.diagnostic !== null || baseline.receipt === null) {
    return commandResult({
      command: 'benchmark',
      exitCode:
        baseline.diagnostic?.code === 'benchmark-filesystem-unavailable'
          ? EXIT_CODES['unsupported-environment']
          : EXIT_CODES['usage-error'],
      data: null,
      diagnostics: baseline.diagnostic === null ? [] : [baseline.diagnostic],
    });
  }

  const optimized = await readReceipt(context, optimizedPath, 'optimized');
  if (optimized.diagnostic !== null || optimized.receipt === null) {
    return commandResult({
      command: 'benchmark',
      exitCode:
        optimized.diagnostic?.code === 'benchmark-filesystem-unavailable'
          ? EXIT_CODES['unsupported-environment']
          : EXIT_CODES['usage-error'],
      data: null,
      diagnostics: optimized.diagnostic === null ? [] : [optimized.diagnostic],
    });
  }

  const report: TaskBenchmarkCompareReport = {
    baseline: baseline.receipt,
    optimized: optimized.receipt,
    comparison: compareTaskBenchmarkReceipts(baseline.receipt, optimized.receipt),
  };

  return commandResult({
    command: 'benchmark',
    exitCode: EXIT_CODES.ok,
    data: report,
  });
}
