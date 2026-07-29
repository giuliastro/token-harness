/**
 * Composition root for the platform layer.
 *
 * One function that turns a machine into the facts, paths, and runner the rest of
 * Token Harness works against. It exists so that `apps/cli/src/main.ts` stays what
 * `tests/integration/architecture.test.ts` requires it to be — the only file in
 * the CLI that touches the operating system — and so that the assembly order
 * (probe, then facts, then paths, then a runner that needs the facts to resolve
 * executables) is written down once instead of at each call site.
 */

import type {
  Diagnostic,
  DiscoveredPackageManager,
  PlatformFacts,
  PlatformPaths,
  ProcessRunner,
  ResolvedExecutable,
} from '@token-harness/core';

import { detectPlatform } from './platform/detect.js';
import { createExecutableResolver, nodeExecutableProbe } from './platform/executable.js';
import { discoverPackageManagers } from './platform/package-managers.js';
import { resolvePlatformPaths } from './platform/paths.js';
import { nodeSystemProbe, type SystemProbe } from './platform/probe.js';
import { NodeProcessRunner } from './process/node-runner.js';

export interface HostEnvironment {
  facts: PlatformFacts;
  paths: PlatformPaths;
  runner: ProcessRunner;
  resolveExecutable(name: string): ResolvedExecutable | null;
  /**
   * Deferred rather than eager: it is a `PATH` scan per candidate, and `--version`
   * has no business doing ten of them.
   */
  discoverPackageManagers(): DiscoveredPackageManager[];
}

export type HostEnvironmentResolution =
  | { readonly ok: true; readonly environment: HostEnvironment }
  | {
      readonly ok: false;
      readonly facts: PlatformFacts | null;
      readonly diagnostics: readonly Diagnostic[];
    };

export interface HostEnvironmentOptions {
  probe?: SystemProbe;
  /** Receives redacted process log lines. */
  log?: (line: string) => void;
}

export function resolveHostEnvironment(
  options: HostEnvironmentOptions = {},
): HostEnvironmentResolution {
  const probe = options.probe ?? nodeSystemProbe();

  const detection = detectPlatform(probe);
  if (!detection.ok) return { ok: false, facts: null, diagnostics: detection.diagnostics };
  const facts = detection.facts;

  const paths = resolvePlatformPaths({
    facts,
    env: probe.env,
    home: probe.homeDirectory,
    temporaryDirectory: probe.temporaryDirectory,
  });
  if (!paths.ok) return { ok: false, facts, diagnostics: paths.diagnostics };

  const resolve = createExecutableResolver({
    facts,
    env: probe.env,
    cwd: paths.paths.home,
    probe: nodeExecutableProbe(),
  });

  const runner = new NodeProcessRunner({
    facts,
    env: probe.env,
    resolve,
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  return {
    ok: true,
    environment: {
      facts,
      paths: paths.paths,
      runner,
      resolveExecutable: resolve,
      discoverPackageManagers: () => discoverPackageManagers({ facts, resolve }),
    },
  };
}
