/**
 * `LocalDatabasePort` over a short-lived child process.
 *
 * The child is *this same program*, re-invoked with an internal argv marker. That is
 * deliberate and it is the reason the bundle stays one file: `scripts/bundle.mjs` produces a
 * single self-contained artifact, and a second entry point beside it would be a second thing
 * to ship, to find at runtime, and to keep in step. Re-entering the same artifact means the
 * reader and the CLI cannot drift, for the same reason the bundler already bundles the
 * development launcher rather than a parallel entry point.
 *
 * `--no-warnings` is passed to the child alone. Scoping it there is what answers the
 * objection RFC 0001 recorded against `node:sqlite`; see `local-database.ts` in `core`.
 */

import {
  type LocalDatabasePort,
  type LocalDatabaseQuery,
  type LocalDatabaseResult,
  type LocalDatabaseRow,
  type ProcessRunner,
} from '@token-harness/core';

import { SQLITE_CHILD_FLAG, type SqliteChildResult } from './sqlite-child.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ChildLocalDatabaseInput {
  /** The runner. RFC 0004 §Process policy: nothing here spawns directly. */
  runner: ProcessRunner;
  /** Absolute path to the Node binary running this process. */
  nodeExecutable: string;
  /**
   * Absolute path to the script the child should run — the bundled artifact, or the
   * development launcher. Whatever `apps/cli` was started from.
   */
  entryScript: string;
  /** Reports whether the file exists, so a missing database is `not-found` and not a spawn. */
  exists(path: string): Promise<boolean>;
  /** An absolute directory that certainly exists, used as the child's working directory. */
  databaseDirectory: string;
}

function isChildResult(value: unknown): value is SqliteChildResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record['rows']);
}

export class ChildLocalDatabase implements LocalDatabasePort {
  private readonly input: ChildLocalDatabaseInput;

  constructor(input: ChildLocalDatabaseInput) {
    this.input = input;
  }

  async query(query: LocalDatabaseQuery): Promise<LocalDatabaseResult> {
    // Checked before spawning. A provider that has never run is the ordinary case, and
    // paying for a process to be told so would make `metrics` slower on exactly the
    // machines where it has the least to report.
    if (!(await this.input.exists(query.path))) {
      return { rows: [], failure: 'not-found', detail: query.path };
    }

    const request = JSON.stringify({
      path: query.path,
      sql: query.sql,
      parameters: [...query.parameters],
    });

    const outcome = await this.input.runner.run({
      executable: this.input.nodeExecutable,
      // The request travels as an argument rather than on stdin: the runner's contract is
      // built around bounded output and a terminated tree, and adding a writable stdin to
      // it for one caller would widen that contract. Statements are literals in adapter
      // code and parameters are numbers and short strings, so the command line is small.
      args: ['--no-warnings', this.input.entryScript, SQLITE_CHILD_FLAG, request],
      // The reader takes an absolute path and touches nothing relative, so the working
      // directory is the database's own: it cannot matter, and naming a directory that
      // might not exist is how a spawn fails with ENOENT for no reason.
      cwd: this.input.databaseDirectory,
      timeoutMs: query.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    if (outcome.failure !== null) {
      return {
        rows: [],
        failure: outcome.failure.reason === 'timed-out' ? 'timed-out' : 'unreadable',
        detail: `the database reader could not be run: ${outcome.failure.reason}`,
      };
    }

    if (outcome.exitCode !== 0) {
      return {
        rows: [],
        failure: 'query-failed',
        detail: `the database reader exited with ${String(outcome.exitCode)}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.stdout);
    } catch {
      // Anything that is not the document we asked for is a failed read, never a partial
      // one. A truncated JSON document could otherwise be read as "no rows", and an
      // importer that treats a failure as an empty source silently stops importing.
      return {
        rows: [],
        failure: 'query-failed',
        detail: 'the database reader did not return a JSON document',
      };
    }

    if (!isChildResult(parsed)) {
      return { rows: [], failure: 'query-failed', detail: 'unrecognised reader output' };
    }

    return {
      rows: parsed.rows as readonly LocalDatabaseRow[],
      failure: parsed.failure,
      detail: parsed.detail,
    };
  }
}
