import type { HarnessId, ProcessRunner } from '@token-harness/core';

const MAX_HOOK_OUTPUT_BYTES = 1024 * 1024;
const HOOK_TIMEOUT_MS = 5_000;

export interface RtkHookProxyResult {
  /** Provider-protocol JSON. Empty output means the harness runs the original command. */
  stdout: string;
  /** Provider stderr, or a concise fail-open diagnostic. */
  stderr: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toolNameFromInput(input: string, harness: HarnessId): string | null {
  try {
    const parsed: unknown = JSON.parse(input);
    if (!isRecord(parsed)) return null;
    const name = parsed['tool_name'] ?? parsed['toolName'];
    if (typeof name === 'string') return name;
  } catch {
    return harness === 'codex' ? 'Bash' : null;
  }
  return harness === 'codex' ? 'Bash' : null;
}

function withDatabaseEnvironment(
  command: string,
  databasePath: string,
  toolName: string | null,
): string | null {
  // The native RTK hook rewrites to an `rtk …` command. Do not attach the variable to an
  // arbitrary command or a shell expression: in those cases the provider contract changed and
  // this build cannot guarantee which process will record the measurement.
  if (!/^\s*(?:rtk(?:\.exe)?)(?:\s|$)/i.test(command)) return null;

  if (toolName === 'PowerShell' || toolName === 'powershell') {
    return `$env:RTK_DB_PATH = ${powershellQuote(databasePath)}; ${command}`;
  }
  if (toolName === 'Bash' || toolName === 'bash') {
    return `RTK_DB_PATH=${shellQuote(databasePath)} ${command}`;
  }
  return null;
}

/**
 * Namespaces RTK's own SQLite tracking database to the hook's coding agent.
 *
 * The hook process receives `RTK_DB_PATH` so RTK's hook receipt uses the same source, and the
 * rewritten command receives the assignment too because the harness executes it in a later
 * process. Shared legacy `history.db` is deliberately untouched and remains unattributed.
 */
export function attributeRtkHookResponse(
  stdout: string,
  input: string,
  databasePath: string,
  harness: HarnessId,
): string {
  let response: unknown;
  try {
    response = JSON.parse(stdout.trim());
  } catch {
    return stdout;
  }
  if (!isRecord(response)) return stdout;

  const hookOutput = response['hookSpecificOutput'];
  if (!isRecord(hookOutput)) return stdout;
  const updatedInput = hookOutput['updatedInput'];
  if (!isRecord(updatedInput) || typeof updatedInput['command'] !== 'string') return stdout;

  const attributed = withDatabaseEnvironment(
    updatedInput['command'],
    databasePath,
    toolNameFromInput(input, harness),
  );
  if (attributed === null) return stdout;

  return `${JSON.stringify({
    ...response,
    hookSpecificOutput: {
      ...hookOutput,
      updatedInput: { ...updatedInput, command: attributed },
    },
  })}\n`;
}

/**
 * Execute RTK's native hook without shell interpolation. Fail open: a missing or failing RTK
 * hook emits no protocol JSON, allowing the harness to run the user's original command.
 */
export async function runRtkHookProxy(input: {
  runner: ProcessRunner;
  cwd: string;
  harness: HarnessId;
  databasePath: string;
  stdin: string;
}): Promise<RtkHookProxyResult> {
  const outcome = await input.runner.run({
    executable: 'rtk',
    args: ['hook', input.harness],
    cwd: input.cwd,
    env: { RTK_DB_PATH: input.databasePath },
    stdin: input.stdin,
    timeoutMs: HOOK_TIMEOUT_MS,
    maxOutputBytes: MAX_HOOK_OUTPUT_BYTES,
  });

  if (outcome.failure !== null || outcome.exitCode !== 0) {
    return {
      stdout: '',
      stderr:
        outcome.stderr ||
        `[Token Harness] RTK's ${input.harness} hook did not run; the command will continue unchanged.\n`,
    };
  }

  return {
    stdout: attributeRtkHookResponse(
      outcome.stdout,
      input.stdin,
      input.databasePath,
      input.harness,
    ),
    stderr: outcome.stderr,
  };
}
