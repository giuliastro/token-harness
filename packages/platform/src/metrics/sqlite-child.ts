/**
 * The body of the child process that reads a provider's SQLite database.
 *
 * This is the only file in the workspace that touches `node:sqlite`, and
 * `tests/integration/architecture.test.ts` says so as a rule. The restriction is the whole
 * design: importing the driver emits `ExperimentalWarning` on stderr, and RFC 0006 permits
 * nothing on stderr in `--json` mode. Contained in a child spawned with `--no-warnings`,
 * the warning never reaches the user's terminal.
 *
 * Two details keep that true.
 *
 * The import is *dynamic*, and inside the function rather than at module scope. A top-level
 * `import 'node:sqlite'` would be hoisted by the bundler to the top of the single-file
 * artifact, and the driver would then load in the parent process — where `--no-warnings` is
 * not in force and the warning lands on the user's stderr. The parent imports this module
 * freely; only calling the function loads the driver.
 *
 * And the child writes its result to stdout as one JSON document. Its stderr is the channel
 * for the driver's own noise, which the parent discards rather than forwards.
 */

// `import type` and nothing else. With `verbatimModuleSyntax` a type-only import is erased
// entirely, so naming the driver's types here costs no runtime load — the value still arrives
// through the dynamic import below.
import type { DatabaseSync } from 'node:sqlite';

import type {
  LocalDatabaseFailure,
  LocalDatabaseRow,
  LocalDatabaseValue,
} from '@token-harness/core';

/** What the child prints. The parent parses exactly this. */
export interface SqliteChildResult {
  rows: LocalDatabaseRow[];
  failure: LocalDatabaseFailure | null;
  detail: string | null;
}

/** The argv marker that turns the CLI into this reader. Not a documented command. */
export const SQLITE_CHILD_FLAG = '--internal-read-local-database';

interface SqliteChildRequest {
  path: string;
  sql: string;
  parameters: (string | number)[];
}

function isRequest(value: unknown): value is SqliteChildRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['path'] === 'string' &&
    typeof record['sql'] === 'string' &&
    Array.isArray(record['parameters'])
  );
}

/**
 * Coerces a driver value into the three the port admits.
 *
 * `bigint` is the case that matters: `node:sqlite` returns one for a large INTEGER, and
 * `JSON.stringify` throws on it rather than degrading. A row identifier arriving as a
 * bigint would otherwise fail the whole import with a message about serialization.
 */
function toValue(value: unknown): LocalDatabaseValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  // A BLOB reaches us as a Uint8Array. Its bytes are not a metric, and turning them into a
  // string would put arbitrary content into an event; the column is reported as absent.
  return null;
}

function classify(error: unknown): { failure: LocalDatabaseFailure; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ERR_UNKNOWN_BUILTIN_MODULE' || /Cannot find module 'node:sqlite'/.test(message)) {
    return { failure: 'driver-unavailable', detail: 'this runtime has no node:sqlite' };
  }
  if (/unable to open database file|not a database|file is encrypted/i.test(message)) {
    return { failure: 'unreadable', detail: message };
  }
  return { failure: 'query-failed', detail: message };
}

/**
 * Runs one read-only statement.
 *
 * `readOnly: true` is the enforcement, not a hint: a provider's own records must not be
 * alterable by being measured, and a bug in a statement literal should fail rather than
 * write. It also means Token Harness cannot create the file by looking for it — with WAL
 * journaling, opening a database read-write would produce `-wal` and `-shm` files beside a
 * database it does not own.
 */
export async function readLocalDatabase(request: unknown): Promise<SqliteChildResult> {
  if (!isRequest(request)) {
    return { rows: [], failure: 'query-failed', detail: 'malformed request' };
  }

  let construct: typeof DatabaseSync;
  try {
    // Dynamic, and deliberately not hoisted — see the module comment.
    ({ DatabaseSync: construct } = await import('node:sqlite'));
  } catch (error) {
    return { rows: [], ...classify(error) };
  }

  let database: DatabaseSync | null = null;
  try {
    database = new construct(request.path, { readOnly: true });
    const statement = database.prepare(request.sql);
    const raw = statement.all(...request.parameters) as Record<string, unknown>[];
    const rows = raw.map((row) => {
      const mapped: Record<string, LocalDatabaseValue> = {};
      for (const [column, value] of Object.entries(row)) mapped[column] = toValue(value);
      return mapped;
    });
    return { rows, failure: null, detail: null };
  } catch (error) {
    return { rows: [], ...classify(error) };
  } finally {
    try {
      database?.close();
    } catch {
      // Nothing useful to do: the result is already decided, and a failed close on a
      // read-only handle cannot have corrupted anything.
    }
  }
}
