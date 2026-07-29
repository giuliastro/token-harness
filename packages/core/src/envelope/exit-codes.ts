/**
 * Exit codes — RFC 0006 §Exit codes.
 *
 * The table is normative and stable within a major version: "New conditions get
 * new codes; existing codes are never redefined." It is expressed as data so a
 * test can assert the whole table rather than a sample of it.
 */

export const EXIT_CODE_TABLE = [
  { code: 0, name: 'ok', meaning: 'The command completed and found nothing actionable' },
  { code: 1, name: 'internal-error', meaning: 'Unexpected failure; a bug in Token Harness' },
  { code: 2, name: 'usage-error', meaning: 'Unknown command, bad flag, or invalid argument' },
  {
    code: 3,
    name: 'problems-found',
    meaning: 'A read-only command completed and reported actionable problems',
  },
  {
    code: 4,
    name: 'blocked-by-conflict',
    meaning: 'Planning succeeded but a hard conflict prevents apply',
  },
  {
    code: 5,
    name: 'precondition-drift',
    meaning: 'The environment no longer matches the plan or journal',
  },
  {
    code: 6,
    name: 'apply-failed-rolled-back',
    meaning: 'A mutation failed and the rollback was verified',
  },
  {
    code: 7,
    name: 'apply-failed-dirty',
    meaning: 'A mutation failed and rollback did not fully restore state',
  },
  {
    code: 8,
    name: 'confirmation-required',
    meaning: 'A mutation needs approval that was not granted',
  },
  {
    code: 9,
    name: 'unsupported-environment',
    meaning: 'The runtime, OS, or harness combination is unsupported',
  },
] as const;

export type ExitCodeName = (typeof EXIT_CODE_TABLE)[number]['name'];
export type ExitCode = (typeof EXIT_CODE_TABLE)[number]['code'];

export const EXIT_CODES: Readonly<Record<ExitCodeName, ExitCode>> = Object.freeze(
  Object.fromEntries(EXIT_CODE_TABLE.map((entry) => [entry.name, entry.code])) as Record<
    ExitCodeName,
    ExitCode
  >,
);

const NAMES_BY_CODE: ReadonlyMap<number, ExitCodeName> = new Map(
  EXIT_CODE_TABLE.map((entry) => [entry.code, entry.name]),
);

export function exitCodeName(code: number): ExitCodeName | null {
  return NAMES_BY_CODE.get(code) ?? null;
}

export function isExitCode(code: number): code is ExitCode {
  return NAMES_BY_CODE.has(code);
}

/**
 * RFC 0006: "Exit code 7 is the only critical code. It always names the exact
 * affected paths and the transaction ID on stderr" — the one documented
 * exception to keeping diagnostics off stderr in `--json` mode.
 */
export function isCriticalExitCode(code: number): boolean {
  return code === EXIT_CODES['apply-failed-dirty'];
}

/**
 * RFC 0006: "Exit code 3 is reserved for `doctor`, `status`, and `verify`."
 */
export const PROBLEMS_FOUND_COMMANDS: readonly string[] = ['doctor', 'status', 'verify'];
