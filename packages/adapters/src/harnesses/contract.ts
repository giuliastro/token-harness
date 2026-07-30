/**
 * The harness adapter contract — PLAN §3.1, RFC 0007 §The harness adapter contract.
 *
 * Separate from the registry in `index.ts` so that an adapter can import the contract
 * without importing the list it appears in. They were one file until the cycle made
 * TypeScript infer `{}` for the exported adapter.
 *
 * Phase 1 shipped this file with `detect` alone, and a comment saying the rest was
 * "deliberately absent until RFC 0007 exists (PLAN §2.5), because guessing them here is
 * what the spike is scheduled to prevent". RFC 0007 exists, so the rest is here, and
 * every clause traces to something the spike observed rather than to symmetry with the
 * provider contract.
 *
 * `plan` is still absent. It needs the capability resolver of Phase 4 to know which
 * scopes this harness is being asked to own, and an adapter that planned without one
 * would be choosing ownership by itself — the decision RFC 0003 exists to centralise.
 */

import type {
  Diagnostic,
  FileSystemPort,
  HarnessConfigFile,
  HarnessDetection,
  HarnessId,
  HarnessManifest,
  HarnessToolFamily,
  PlatformFacts,
  PlatformPaths,
  ProcessRunner,
  VerificationCheck,
  VerificationTier,
} from '@token-harness/core';

/**
 * Everything an adapter is allowed to reach.
 *
 * All four capabilities arrive as the *ports* declared in `core`, never as the
 * implementations in `@token-harness/platform`: an adapter that could import `node:fs`
 * could also read the developer's home during a unit test, and the fixture discipline in
 * RFC 0004 §Test requirements rests on it not being able to.
 */
export interface HarnessContext {
  readonly fs: FileSystemPort;
  /** RFC 0002 §Process abstraction: adapters never call the operating system directly. */
  readonly runner: ProcessRunner;
  readonly facts: PlatformFacts;
  readonly paths: PlatformPaths;
  readonly projectRoot: string;
}

/** A configuration file the adapter located, with the parser its content requires. */
export interface ResolvedHarnessConfig {
  declaration: HarnessConfigFile;
  /** Absolute, resolved against the home directory or the project root. */
  path: string;
  exists: boolean;
  /** False when the file exists and its declared parser rejected it. */
  parsed: boolean;
  /** Interception points carrying at least one entry, by `scopeId`. */
  configuredPoints: string[];
  /** Matcher values found on those entries, for the tool-family comparison. */
  matchers: string[];
}

/**
 * What `inspect` reports. Configuration and activation are separate fields, because RFC
 * 0007 §Configuration presence is not evidence establishes that a harness can have the
 * first without the second.
 */
export interface HarnessInspection {
  harnessId: HarnessId;
  configs: ResolvedHarnessConfig[];
  /**
   * Families the harness exposes on *this* platform, which is not the whole declared
   * list: the PowerShell family is Windows-only.
   */
  activeToolFamilies: HarnessToolFamily[];
  /**
   * Shell-executing families no configured matcher covers. Non-empty means an
   * integration that is installed and partly ineffective, which RFC 0003 models as an
   * unowned scope.
   */
  uncoveredToolFamilies: string[];
  /**
   * Null when the manifest declares `requiresEnablement: false`, and null again when the
   * state exists but could not be read. Never defaulted to true.
   */
  enabled: boolean | null;
  diagnostics: Diagnostic[];
}

export interface HarnessVerification {
  harnessId: HarnessId;
  declaredTier: VerificationTier;
  /** The strongest tier actually reached, or null when nothing could be established. */
  achievedTier: VerificationTier | null;
  checks: VerificationCheck[];
}

export interface HarnessAdapter {
  readonly manifest: HarnessManifest;
  /** RFC 0002 §Detection: read-only, evidence-based, never inferred from configuration alone. */
  detect(context: HarnessContext): Promise<HarnessDetection>;
  inspect(context: HarnessContext): Promise<HarnessInspection>;
  /**
   * RFC 0007: at the declared tier, defaulting to passive, reporting `not-exercised`
   * rather than `pass` when nothing has been observed.
   */
  verify(context: HarnessContext): Promise<HarnessVerification>;
}

/** The absolute path a declaration resolves to. Shared by every adapter. */
export function resolveConfigPath(declaration: HarnessConfigFile, context: HarnessContext): string {
  const base = declaration.scope === 'user' ? context.paths.home : context.projectRoot;
  return context.fs.join(base, ...declaration.path.split('/'));
}

/** The families this platform exposes. Shared by every adapter. */
export function familiesOnThisPlatform(
  manifest: HarnessManifest,
  facts: PlatformFacts,
): HarnessToolFamily[] {
  return manifest.toolFamilies.filter((family) => family.platforms.includes(facts.os));
}
