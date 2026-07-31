/**
 * Reading a provider's own local database — RFC 0005 §Importers §RTK.
 *
 * `MetricsDeclaration.source` has always had a `local-database` member, and RTK is the
 * first provider that needs it: its CLI exposes no per-operation output in any format
 * (`--history` silently ignores both `--format json` and `--format csv`), while
 * `%LOCALAPPDATA%\rtk\history.db` holds one immutable row per intercepted command.
 *
 * ## Why this is a port and not a driver
 *
 * RFC 0001 and RFC 0005 both examined `node:sqlite` and rejected it, on a ground that
 * still holds: importing it emits `ExperimentalWarning` on stderr, and RFC 0006 permits
 * nothing on stderr in `--json` mode except a serialization failure. The recorded
 * reasoning was that silencing it "means either `--no-warnings` process-wide or mutating
 * the process warning listeners — both worse than not needing it".
 *
 * There is a third mechanism, and it is the one behind this port: read the database in a
 * short-lived child process that Token Harness spawns itself, with `--no-warnings` scoped
 * to that child alone. The parent's streams are untouched, so the objection is answered
 * rather than argued with. That mechanism is a platform workaround, which is exactly why
 * it lives behind an interface: `core` states what it needs, and nothing here knows that a
 * process is involved.
 *
 * The rejection of `node:sqlite` as the *storage backend* for Token Harness's own metrics
 * is unaffected. That would be an in-process import in the CLI itself, where the warning
 * lands on the user's stderr and no child boundary exists to contain it.
 */

/** A cell. Databases return these three; anything else is a driver detail, not a value. */
export type LocalDatabaseValue = string | number | null;

export type LocalDatabaseRow = Readonly<Record<string, LocalDatabaseValue>>;

export interface LocalDatabaseQuery {
  /** Absolute path to the database file. */
  path: string;
  /**
   * The statement to run. Always a literal in adapter code, never assembled from anything
   * a user or a configuration file supplied — `parameters` is what carries values.
   */
  sql: string;
  parameters: readonly (string | number)[];
  /** Bounded because an import is not allowed to hang a read-only command. */
  timeoutMs?: number;
}

export type LocalDatabaseFailure =
  /** The file is not there. Expected, and not an error: the provider may never have run. */
  | 'not-found'
  /**
   * No SQLite driver on this runtime. A supported steady state, not a defect: RFC 0005
   * §Importer degradation policy makes the consequence `mode: 'unavailable'`, and an
   * importer that reports nothing is better than one that invents figures.
   */
  | 'driver-unavailable'
  /** Present but could not be opened — permissions, or a file that is not a database. */
  | 'unreadable'
  /** Opened, but the statement failed. A schema change upstream reaches us here. */
  | 'query-failed'
  | 'timed-out';

export interface LocalDatabaseResult {
  rows: readonly LocalDatabaseRow[];
  /** Null on success. Rows are empty whenever this is set. */
  failure: LocalDatabaseFailure | null;
  /** What went wrong, for the evidence trail. Never contains a row value. */
  detail: string | null;
}

/**
 * Read-only by contract and by construction: the implementation opens the file read-only,
 * so a provider's own records cannot be altered by being measured. There is deliberately
 * no `execute`.
 */
export interface LocalDatabasePort {
  query(input: LocalDatabaseQuery): Promise<LocalDatabaseResult>;
}

/** Reads a cell as a number, or null when the source did not supply one. */
export function numberAt(row: LocalDatabaseRow, column: string): number | null {
  const value = row[column];
  return typeof value === 'number' ? value : null;
}

/** Reads a cell as a string, or null when the source did not supply one. */
export function stringAt(row: LocalDatabaseRow, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' ? value : null;
}
