import {
  EXIT_CODES,
  assessCrossHarnessTransferBenefit,
  commandResult,
  diagnostic,
  isTaskBenchmarkId,
  serializeEnvelope,
  toEnvelope,
  type CrossHarnessTransferAssessment,
  type ExitCode,
} from '@token-harness/core';

import type { TransferObservation } from './transfer-runtime.js';
import { TOOL_VERSION } from './version.js';

const DEFAULT_MAX_HANDOFF_BYTES = 2048;

const HELP = `token-harness transfer — evaluate one empirical cross-harness handoff

Usage
  token-harness transfer --benchmark-id <id> --handoff-file <path> [options]

Required
  --benchmark-id <id>        Existing paired benchmark id
  --handoff-file <path>      Exact compact handoff used by the optimized/switch run

Options
  --max-handoff-bytes <n>    Handoff byte budget (default: 2048)
  --json                     RFC 0006 JSON envelope
  --version                  Print version and exit 0
  --help                     Print help and exit 0

Collection workflow
  Capture baseline with benchmark-start/finish on the current harness.
  Capture optimized with the same benchmark id/task class on a different candidate harness,
  using the compact handoff saved in --handoff-file.
  Then run this command to evaluate the pair.

The evaluator compares explicit quality, failed attempts, runtime/provider error count, attempts,
and the actual handoff byte budget. Claude/Codex quota percentages and local token counts are never
subtracted or converted across providers. This command is read-only and never launches or switches a harness.`;

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

export interface TransferRuntime {
  observeExperiment?: (input: {
    benchmarkId: string;
    handoffFile: string;
  }) => Promise<TransferObservation>;
}

interface Args {
  benchmarkId: string | null;
  handoffFile: string | null;
  maxHandoffBytes: number;
  json: boolean;
  help: boolean;
  version: boolean;
}

interface TransferEvaluationReport {
  taskClass: string;
  assessment: CrossHarnessTransferAssessment;
}

function parse(argv: readonly string[]): { args: Args; errors: string[] } {
  const args: Args = {
    benchmarkId: null,
    handoffFile: null,
    maxHandoffBytes: DEFAULT_MAX_HANDOFF_BYTES,
    json: false,
    help: false,
    version: false,
  };
  const errors: string[] = [];

  // RFC 0006 precedence: help/version win even when other arguments are malformed.
  args.help = argv.includes('--help');
  args.version = argv.includes('--version');
  args.json = argv.includes('--json');
  if (args.help || args.version) return { args, errors };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--json') continue;
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (name !== '--benchmark-id' && name !== '--handoff-file' && name !== '--max-handoff-bytes') {
      errors.push(`unknown transfer flag ${JSON.stringify(name)}`);
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

function render(report: TransferEvaluationReport): string {
  const a = report.assessment;
  return [
    `Cross-harness transfer evidence: ${a.benefit}`,
    `Benchmark: ${a.benchmarkId}`,
    `Route: ${a.currentHarness} -> ${a.candidateHarness}`,
    `Task class: ${report.taskClass}`,
    `Basis: ${a.basis}`,
    `Handoff: ${String(a.handoffBytes)} / ${String(a.maxHandoffBytes)} bytes`,
    'Reasons:',
    ...a.reasons.map((reason) => `- ${reason}`),
    '',
  ].join('\n');
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
    remediation:
      'Run `token-harness transfer --help` and verify the benchmark pair and handoff file',
  });
  const result = commandResult({ command: 'transfer', exitCode, data: null, diagnostics: [entry] });
  if (json) streams.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else streams.err(`${code}: ${message}\n`);
  return exitCode;
}

export async function transferMain(
  argv: readonly string[],
  streams?: Streams,
  runtime?: TransferRuntime,
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
      'invalid-transfer-input',
      parsed.errors.join('; '),
      EXIT_CODES['usage-error'],
      parsed.args.json,
      output,
    );
  }
  if (runtime?.observeExperiment === undefined) {
    return emitError(
      'transfer-runtime-unavailable',
      'local transfer experiment observation is unavailable',
      EXIT_CODES['unsupported-environment'],
      parsed.args.json,
      output,
    );
  }

  let observation: TransferObservation;
  try {
    observation = await runtime.observeExperiment({
      benchmarkId: parsed.args.benchmarkId!,
      handoffFile: parsed.args.handoffFile!,
    });
  } catch {
    observation = {
      status: 'unavailable',
      experiment: null,
      reason: 'local transfer experiment observation failed',
    };
  }

  if (observation.status !== 'observed' || observation.experiment === null) {
    return emitError(
      `transfer-${observation.status}`,
      observation.reason ?? 'transfer experiment could not be observed safely',
      observation.status === 'unavailable'
        ? EXIT_CODES['unsupported-environment']
        : EXIT_CODES['precondition-drift'],
      parsed.args.json,
      output,
    );
  }

  const assessment = assessCrossHarnessTransferBenefit({
    stay: observation.experiment.stay,
    switched: observation.experiment.switched,
    handoffBytes: observation.experiment.handoffBytes,
    maxHandoffBytes: parsed.args.maxHandoffBytes,
  });
  const report: TransferEvaluationReport = {
    taskClass: observation.experiment.stay.taskClass,
    assessment,
  };
  const result = commandResult({ command: 'transfer', exitCode: EXIT_CODES.ok, data: report });
  if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else output.out(render(report));
  return EXIT_CODES.ok;
}
