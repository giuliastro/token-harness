/**
 * RFC 0009 gate rows for fake environments.
 *
 * The integration suites run the whole CLI against a temporary home and a fake process runner.
 * RFC 0009 makes a compatibility row the precondition of every managed mutation, and the shipped
 * table is deliberately empty — so a fake environment must both *observe versions* and *inject
 * rows* for the machinery under test to be reachable at all.
 *
 * Observing versions means resolving the fake executables to the running Node binary: `rtk
 * --version` and `claude --version` then print Node's version, which `VERSION_PATTERN` extracts
 * as exactly `process.versions.node`. No upstream executable is involved, so AGENTS.md's ban on
 * third-party software in tests is respected.
 */

import {
  harnessId,
  providerId,
  type CompatibilityRow,
  type PlatformFacts,
} from '@token-harness/core';

/** The version every fake executable reports: the Node this suite runs on. */
export const NODE_VERSION = process.versions.node;

/** A resolved executable, in the shape `NodeProcessRunner.resolve` expects. */
export interface ResolvedFakeExecutable {
  requested: string;
  path: string;
  kind: 'native';
}

/**
 * Resolves `rtk` and `claude` to the Node binary and nothing else. `harnesstrim` stays
 * unresolved so detection keeps its config-file-only path.
 */
export function fakeResolve(name: string): ResolvedFakeExecutable | null {
  if (name !== 'rtk' && name !== 'claude') return null;
  return { requested: name, path: process.execPath, kind: 'native' };
}

/** A row that admits exactly what `fakeResolve` observes, for one provider on one harness. */
export function rowFor(
  provider: string,
  harness: string,
  platform: PlatformFacts,
): CompatibilityRow {
  return {
    harness: harnessId(harness),
    harnessVersion: { minimum: NODE_VERSION, maximum: NODE_VERSION },
    provider: providerId(provider),
    providerVersion: NODE_VERSION,
    platform: { os: platform.os, wsl: platform.isWsl, supported: true, limitation: null },
    configSchema: `config-schema-${harness}`,
    fixture: `fixtures/${provider}-${harness}-${NODE_VERSION}`,
    verificationTier: 'config-only',
  };
}

/** The default set: RTK on Claude Code, the only managed provider at Phase 1. */
export function nodeVersionRows(platform: PlatformFacts): readonly CompatibilityRow[] {
  return [rowFor('rtk', 'claude', platform)];
}
