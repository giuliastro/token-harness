/**
 * Process entry point.
 *
 * This file is the only place in the CLI that reads `process`, enforced by
 * `tests/integration/architecture.test.ts`. Everything below it takes injected
 * values, which is what lets the whole CLI contract be tested without touching the
 * real machine.
 *
 * Phase 1 carried a provisional platform observer here, with a comment saying the
 * real detector belonged to PLAN §2.1. It does, and it now lives in
 * `@token-harness/platform`, so this file is down to: resolve the host, hand the
 * result to `run`, and set the exit code.
 */

import process from 'node:process';

import { JsonlStore, deriveProjectId } from '@token-harness/core';
import {
  ChildLocalDatabase,
  NodeFileSystem,
  SQLITE_CHILD_FLAG,
  readLocalDatabase,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';

import { run } from './run.js';

/**
 * The internal reader mode.
 *
 * `ChildLocalDatabase` re-invokes this same program with `SQLITE_CHILD_FLAG` rather than
 * shipping a second entry point beside the bundle. Handled here, before anything else,
 * because this is not a command: it takes no options, emits one JSON document, and must not
 * pass through argument parsing, the runtime-floor check, or the envelope — a child that
 * printed a usage page would be indistinguishable from a child that returned no rows.
 *
 * It is checked by exact position. A stray `--internal-read-local-database` further along a
 * real command line is a usage error, not an invitation.
 */
async function runAsDatabaseReader(argv: readonly string[]): Promise<boolean> {
  if (argv[0] !== SQLITE_CHILD_FLAG) return false;

  let request: unknown = null;
  try {
    request = JSON.parse(argv[1] ?? 'null');
  } catch {
    request = null;
  }
  const result = await readLocalDatabase(request);
  process.stdout.write(JSON.stringify(result));
  process.exitCode = 0;
  return true;
}

export async function main(argv: readonly string[]): Promise<void> {
  if (await runAsDatabaseReader(argv)) return;

  const resolution = resolveHostEnvironment();

  /**
   * The ports that need the machine.
   *
   * Assembled only when the host resolved, because each one needs a state directory whose
   * permissions RFC 0004 has already verified. The salt is provisioned as part of that same
   * step; `attribution-salt.ts` records why writing it does not make a read-only command a
   * writing one.
   */
  const fs = resolution.ok ? new NodeFileSystem(resolution.environment.facts) : null;
  const attribution =
    resolution.ok && fs !== null
      ? await resolveAttributionSalt(fs, resolution.environment.paths.state)
      : { salt: null, diagnostics: [] };

  const exitCode = await run({
    argv,
    streams: {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
    // On failure `facts` is null only when the operating system itself is
    // unsupported. An unresolvable state directory still has honest facts to
    // report, and `run` uses them for the runtime-floor check before refusing.
    platform: resolution.ok ? resolution.environment.facts : resolution.facts,
    cwd: process.cwd(),
    home: resolution.ok ? resolution.environment.paths.home : null,
    stateRoot: resolution.ok ? resolution.environment.paths.state : null,
    environmentDiagnostics: resolution.ok ? attribution.diagnostics : resolution.diagnostics,
    // The ports adapters need. Built here because this is the only file allowed to know
    // there is a real machine underneath.
    adapters:
      resolution.ok && fs !== null
        ? {
            fs,
            runner: resolution.environment.runner,
            resolveExecutables: resolution.environment.resolveExecutables,
            paths: resolution.environment.paths,
            localDatabase: new ChildLocalDatabase({
              runner: resolution.environment.runner,
              nodeExecutable: process.execPath,
              // `argv[1]` is what Node was told to run: the bundled artifact in a release,
              // the development launcher in the workspace. Taking it from here rather than
              // from `import.meta.url` keeps the child running the same program the user
              // started, which is what makes the two impossible to drift apart.
              entryScript: process.argv[1] ?? '',
              exists: async (path) => (await fs.stat(path)) !== null,
              databaseDirectory: resolution.environment.paths.state,
            }),
            projectIdFor: (absolutePath) =>
              attribution.salt === null
                ? 'p_unattributed'
                : deriveProjectId(
                    absolutePath,
                    attribution.salt,
                    resolution.environment.facts.os === 'windows',
                  ),
          }
        : null,
    /**
     * The metrics store.
     *
     * A skipped line goes to stderr as a plain warning rather than into the envelope: the
     * store is read while a report is being assembled, long after the command decided what
     * its diagnostics were. Silence is the one thing it must not be — RFC 0005 exists so a
     * lost record is visible.
     */
    metrics:
      resolution.ok && fs !== null
        ? new JsonlStore({
            fs,
            stateRoot: resolution.environment.paths.state,
            now: () => new Date().toISOString(),
            onSkippedLine: (skipped) => {
              const at = `${skipped.path}:${String(skipped.lineNumber)}`;
              process.stderr.write(`warning  metrics-record-skipped: ${skipped.reason} at ${at}\n`);
            },
          })
        : null,
    env: process.env,
    stdoutIsTty: process.stdout.isTTY === true,
  });

  process.exitCode = exitCode;
}
