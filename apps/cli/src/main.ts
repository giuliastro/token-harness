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

import { NodeFileSystem, resolveHostEnvironment } from '@token-harness/platform';

import { run } from './run.js';

export async function main(argv: readonly string[]): Promise<void> {
  const resolution = resolveHostEnvironment();

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
    environmentDiagnostics: resolution.ok ? [] : resolution.diagnostics,
    // The ports adapters need. Built here because this is the only file allowed to know
    // there is a real machine underneath.
    adapters: resolution.ok
      ? {
          fs: new NodeFileSystem(resolution.environment.facts),
          runner: resolution.environment.runner,
          paths: resolution.environment.paths,
        }
      : null,
    env: process.env,
    stdoutIsTty: process.stdout.isTTY === true,
  });

  process.exitCode = exitCode;
}
