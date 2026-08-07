/**
 * Provider and harness identifiers.
 *
 * RFC 0002 §Manifest: "Provider IDs are lowercase, stable, and never reused.
 * Display names can change." The same rule is applied to harness IDs, because
 * RFC 0002 §Harness versioning is symmetric removes the provider/harness
 * asymmetry everywhere else.
 */

declare const providerIdBrand: unique symbol;
declare const harnessIdBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: true };
export type HarnessId = string & { readonly [harnessIdBrand]: true };

/** Lowercase alphanumeric segments separated by single hyphens. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && ID_PATTERN.test(value);
}

export function isProviderId(value: string): value is ProviderId {
  return isValidId(value);
}

export function isHarnessId(value: string): value is HarnessId {
  return isValidId(value);
}

export function providerId(value: string): ProviderId {
  if (!isProviderId(value)) {
    throw new TypeError(`invalid provider id: ${JSON.stringify(value)}`);
  }
  return value;
}

export function harnessId(value: string): HarnessId {
  if (!isHarnessId(value)) {
    throw new TypeError(`invalid harness id: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The reserved owner identity for capabilities Token Harness holds itself, such
 * as `metrics.observe` in RFC 0003 §MVP ownership.
 */
export const TOKEN_HARNESS_OWNER = 'token-harness' as ProviderId;

/**
 * The project identity for an event that names no project.
 *
 * RTK's history records a `project_path` that can be empty, and "attributing the event to the
 * directory `metrics` happens to run in would invent an attribution". Such an event belongs to no
 * project, so a project-scoped report excludes it and says how many it excluded rather than
 * letting it inflate whichever project was asked about.
 */
export const UNATTRIBUTED_PROJECT_ID = 'p_unattributed';

/** Harnesses managed at 0.1.0 — PLAN §8.1. */
export const MANAGED_HARNESS_IDS = ['claude', 'codex', 'hermes', 'opencode', 'pi'] as const;

/** Providers in the 0.1.0 MVP — RFC 0001 §Initial provider strategy. */
export const MVP_PROVIDER_IDS = ['rtk', 'harnesstrim'] as const;
