import {
  EXIT_CODES,
  buildCompactHandoff,
  commandResult,
  diagnostic,
  serializeEnvelope,
  toEnvelope,
  type CompactHandoffResult,
  type Diagnostic,
} from '@token-harness/core';

import { TOOL_VERSION } from './version.js';

const DEFAULT_MAX_BYTES = 2048;
const MIN_MAX_BYTES = 256;

const HELP = `token-harness handoff — build a compact cross-harness handoff

Usage
  token-harness handoff --objective <text> --next-action <text> [flags]

Flags
  --decision <text>       Repeatable decision to preserve
  --changed-file <path>   Repeatable changed file to preserve
  --validation <text>     Repeatable validation result to preserve
  --unresolved <text>     Repeatable unresolved item to preserve
  --max-bytes <n>         Hard UTF-8 byte ceiling; default 2048, minimum 256
  --json                  Emit one RFC 0006 JSON envelope
  --help                  Print this help and exit 0

The command is read-only. It never reads a transcript, calls a model, infers quota,
or switches harnesses. Human output is only the compact Markdown payload so it can
be copied directly into another harness.`;

export interface HandoffStreams {
  out(text: string): void;
  err(text: string): void;
}

interface ParsedHandoffArgs {
  objective: string | null;
  decisions: string[];
  changedFiles: string[];
  validation: string[];
  unresolved: string[];
  nextAction: string | null;
  maxBytes: number;
  json: boolean;
  help: boolean;
}

function parseValue(
  argv: readonly string[],
  index: number,
): { value: string | null; consumed: number } {
  const token = argv[index] as string;
  const equals = token.indexOf('=');
  if (equals !== -1) {
    const value = token.slice(equals + 1);
    return { value: value === '' ? null : value, consumed: 0 };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) return { value: null, consumed: 0 };
  return { value: next, consumed: 1 };
}

function parseArgs(argv: readonly string[]): {
  args: ParsedHandoffArgs;
  diagnostics: Diagnostic[];
} {
  const args: ParsedHandoffArgs = {
    objective: null,
    decisions: [],
    changedFiles: [],
    validation: [],
    unresolved: [],
    nextAction: null,
    maxBytes: DEFAULT_MAX_BYTES,
    json: false,
    help: false,
  };
  const diagnostics: Diagnostic[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);

    if (name === '--help') {
      args.help = true;
      continue;
    }
    if (name === '--json') {
      if (equals !== -1) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'flag-takes-no-value',
            message: 'The flag `--json` does not take a value',
            remediation: 'Pass `--json` on its own',
          }),
        );
      } else {
        args.json = true;
      }
      continue;
    }

    const valueFlags = new Set([
      '--objective',
      '--decision',
      '--changed-file',
      '--validation',
      '--unresolved',
      '--next-action',
      '--max-bytes',
    ]);
    if (!valueFlags.has(name)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'unknown-flag',
          message: `Unknown handoff flag ${JSON.stringify(name)}`,
          remediation: 'Run `token-harness handoff --help` to see the accepted flags',
        }),
      );
      continue;
    }

    const parsed = parseValue(argv, index);
    if (parsed.value === null) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'flag-missing-value',
          message: `The flag \`${name}\` requires a non-empty value`,
          remediation: `Pass a value, for example \`${name} <value>\``,
        }),
      );
      continue;
    }
    index += parsed.consumed;

    switch (name) {
      case '--objective':
        args.objective = parsed.value;
        break;
      case '--decision':
        args.decisions.push(parsed.value);
        break;
      case '--changed-file':
        args.changedFiles.push(parsed.value);
        break;
      case '--validation':
        args.validation.push(parsed.value);
        break;
      case '--unresolved':
        args.unresolved.push(parsed.value);
        break;
      case '--next-action':
        args.nextAction = parsed.value;
        break;
      case '--max-bytes': {
        const numeric = Number(parsed.value);
        if (!Number.isInteger(numeric) || numeric < MIN_MAX_BYTES) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-handoff-max-bytes',
              message: `Handoff max bytes ${JSON.stringify(parsed.value)} must be an integer >= ${MIN_MAX_BYTES}`,
              remediation: `Use --max-bytes ${DEFAULT_MAX_BYTES} or another integer >= ${MIN_MAX_BYTES}`,
            }),
          );
        } else {
          args.maxBytes = numeric;
        }
        break;
      }
      default:
        break;
    }
  }

  if (!args.help) {
    if (args.objective === null) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'handoff-objective-required',
          message: 'A compact handoff requires --objective',
          remediation: 'Pass the task objective with --objective <text>',
        }),
      );
    }
    if (args.nextAction === null) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'handoff-next-action-required',
          message: 'A compact handoff requires --next-action',
          remediation: 'Pass the next concrete step with --next-action <text>',
        }),
      );
    }
  }

  return { args, diagnostics };
}

function emitDiagnostics(diagnostics: readonly Diagnostic[], streams: HandoffStreams): void {
  for (const entry of diagnostics) streams.err(`${entry.code}: ${entry.message}\n`);
}

function successResult(data: CompactHandoffResult) {
  return commandResult({
    command: 'handoff',
    exitCode: EXIT_CODES.ok,
    data,
  });
}

export async function handoffMain(
  argv: readonly string[],
  streams?: HandoffStreams,
): Promise<number> {
  const output: HandoffStreams =
    streams ??
    ({
      out: (text: string) => process.stdout.write(text),
      err: (text: string) => process.stderr.write(text),
    } satisfies HandoffStreams);

  const parsed = parseArgs(argv);
  if (parsed.args.help) {
    output.out(`${HELP}\n`);
    return EXIT_CODES.ok;
  }

  if (parsed.diagnostics.length > 0) {
    const result = commandResult({
      command: 'handoff',
      exitCode: EXIT_CODES['usage-error'],
      diagnostics: parsed.diagnostics,
    });
    if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
    else emitDiagnostics(parsed.diagnostics, output);
    return EXIT_CODES['usage-error'];
  }

  const handoff = buildCompactHandoff({
    objective: parsed.args.objective as string,
    decisions: parsed.args.decisions,
    changedFiles: parsed.args.changedFiles,
    validation: parsed.args.validation,
    unresolved: parsed.args.unresolved,
    nextAction: parsed.args.nextAction as string,
    maxBytes: parsed.args.maxBytes,
  });
  const result = successResult(handoff);

  if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else output.out(`${handoff.markdown}\n`);
  return EXIT_CODES.ok;
}
