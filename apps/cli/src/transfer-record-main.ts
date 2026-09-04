import {
  EXIT_CODES,
  commandResult,
  diagnostic,
  isTaskBenchmarkId,
  serializeEnvelope,
  toEnvelope,
  type CrossHarnessTransferReceipt,
  type ExitCode,
} from '@token-harness/core';

import type { TransferRecordResult } from './transfer-runtime.js';
import { TOOL_VERSION } from './version.js';

const DEFAULT_MAX_HANDOFF_BYTES = 2048;

const HELP = `token-harness transfer-record — persist one immutable transfer evidence receipt

Usage
  token-harness transfer-record --benchmark-id <id> --handoff-file <path> [options]

Required
  --benchmark-id <id>        Existing cross-harness benchmark pair
  --handoff-file <path>      Exact compact handoff used by the optimized/switch run

Options
  --max-handoff-bytes <n>    Handoff byte budget used for the assessment (default: 2048)
  --json                     RFC 0006 JSON envelope
  --version                  Print version and exit 0
  --help                     Print help and exit 0

The command re-validates the project-scoped baseline/optimized pair, measures and hashes the exact
handoff, evaluates it with the conservative transfer comparator, then writes transfer.json beside
the benchmark pair. Existing transfer evidence is never overwritten. No harness is launched or
modified, and Claude/Codex quota percentages are never converted across providers.`;

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

export interface TransferRecordRuntime {
  recordEvidence?: (input: {
    benchmarkId: string;
    handoffFile: string;
    maxHandoffBytes: number;
    recordedAt: string;
  }) => Promise<TransferRecordResult>;
  now?: () => string;
}

interface Args {
  benchmarkId: string | null;
  handoffFile: string | null;
  maxHandoffBytes: number;
  json: boolean;
  help: boolean;
  version: boolean;
}

interface TransferRecordReport {
  receipt: CrossHarnessTransferReceipt;
  receiptPath: string;
}

function parse(argv: readonly string[]): { args: Args; errors: string[] } {
  const args: Args = {
    benchmarkId: null,
    handoffFile: null,
    maxHandoffBytes: DEFAULT_MAX_HANDOFF_BYTES,
    json: argv.includes('--json'),
    help: argv.includes('--help'),
    version: argv.includes('--version'),
  };
  const errors: string[] = [];
  if (args.help || args.version) return { args, errors };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--json') continue;
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (name !== '--benchmark-id' && name !== '--handoff-file' && name !== '--max-handoff-bytes') {
      errors.push(`unknown transfer-record flag ${JSON.stringify(name)}`);
      continue;
    }

    const inline = equals >= 0 ? token.slice(equals + 1) : null;
    const next = inline ?? argv[index + 1] ?? null;
    if (next === null || next === '' || (inline === null && next.startsWith('-'))) {
      errors.push(`${name} requires a value`);
      continue;
    }
    if (inline === null) index += 1;

    if (name === '--benchmark-id') args.benchmarkId = next;
    else if (name === '--handoff-file') args.handoffFile = next;
    else {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        errors.push('--max-handoff-bytes must be a positive integer');
      } else {
        args.maxHandoffBytes = parsed;
      }
    }
  }

  if (args.benchmarkId === null || !isTaskBenchmarkId(args.benchmarkId)) {
    errors.push('--benchmark-id must be a safe existing benchmark id');
  }
  if (args.handoffFile === null) errors.push('--handoff-file is required');
  return { args, errors };
}

function emitSpecial(kind: 'help' | 'version', json: boolean, streams: Streams): void {
  const data = kind === 'help' ? { usage: HELP } : { version: TOOL_VERSION };
  if (json) {
    streams.out(
      serializeEnvelope(
        toEnvelope(commandResult({ command: kind, exitCode: EXIT_CODES.ok, data }), TOOL_VERSION),
      ),
    );
  } else {
    streams.out(kind === 'help' ? `${HELP}\n` : `${TOOL_VERSION}\n`);
  }
}

function emitError(
  code: string,
  message: string,
  exitCode: ExitCode,
  json: boolean,
  streams: Streams,
): ExitCode {
  const entry = diagnostic({
    severity: 'error',
    code,
    message,
    remediation: 'Run `token-harness transfer-record --help` and verify local benchmark state',
  });
  const result = commandResult({
    command: 'transfer-record',
    exitCode,
    data: null,
    diagnostics: [entry],
  });
  if (json) streams.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else streams.err(`${code}: ${message}\n`);
  return exitCode;
}

function render(report: TransferRecordReport): string {
  const receipt = report.receipt;
  return [
    'Cross-harness transfer evidence recorded',
    `Benchmark: ${receipt.benchmarkId}`,
    `Route: ${receipt.currentHarness} -> ${receipt.candidateHarness}`,
    `Task class: ${receipt.taskClass}`,
    `Benefit: ${receipt.benefit}`,
    `Basis: ${receipt.basis}`,
    `Handoff: ${String(receipt.handoffBytes)} / ${String(receipt.maxHandoffBytes)} bytes`,
    `Handoff digest: ${receipt.handoffDigest}`,
    `Receipt: ${report.receiptPath}`,
    '',
  ].join('\n');
}

function recordFailureExit(status: TransferRecordResult['status']): ExitCode {
  return status === 'unavailable' || status === 'write-failed'
    ? EXIT_CODES['unsupported-environment']
    : EXIT_CODES['precondition-drift'];
}

export async function transferRecordMain(
  argv: readonly string[],
  streams?: Streams,
  runtime?: TransferRecordRuntime,
): Promise<ExitCode> {
  const output =
    streams ??
    ({
      out: (text: string) => process.stdout.write(text),
      err: (text: string) => process.stderr.write(text),
    } satisfies Streams);
  const parsed = parse(argv);

  if (parsed.args.help) {
    emitSpecial('help', parsed.args.json, output);
    return EXIT_CODES.ok;
  }
  if (parsed.args.version) {
    emitSpecial('version', parsed.args.json, output);
    return EXIT_CODES.ok;
  }
  if (parsed.errors.length > 0) {
    return emitError(
      'invalid-transfer-record-input',
      parsed.errors.join('; '),
      EXIT_CODES['usage-error'],
      parsed.args.json,
      output,
    );
  }
  if (runtime?.recordEvidence === undefined) {
    return emitError(
      'transfer-record-runtime-unavailable',
      'local transfer evidence recording is unavailable',
      EXIT_CODES['unsupported-environment'],
      parsed.args.json,
      output,
    );
  }

  let recorded: TransferRecordResult;
  try {
    recorded = await runtime.recordEvidence({
      benchmarkId: parsed.args.benchmarkId!,
      handoffFile: parsed.args.handoffFile!,
      maxHandoffBytes: parsed.args.maxHandoffBytes,
      recordedAt: runtime.now?.() ?? new Date().toISOString(),
    });
  } catch {
    recorded = {
      status: 'unavailable',
      receipt: null,
      receiptPath: null,
      reason: 'local transfer evidence recording failed',
    };
  }

  if (
    recorded.status !== 'recorded' ||
    recorded.receipt === null ||
    recorded.receiptPath === null
  ) {
    return emitError(
      `transfer-record-${recorded.status}`,
      recorded.reason ?? 'transfer evidence could not be recorded safely',
      recordFailureExit(recorded.status),
      parsed.args.json,
      output,
    );
  }

  const report: TransferRecordReport = {
    receipt: recorded.receipt,
    receiptPath: recorded.receiptPath,
  };
  const result = commandResult({
    command: 'transfer-record',
    exitCode: EXIT_CODES.ok,
    data: report,
  });
  if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else output.out(render(report));
  return EXIT_CODES.ok;
}
