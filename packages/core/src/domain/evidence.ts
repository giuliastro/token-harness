/**
 * Evidence.
 *
 * RFC 0002 refers to `Evidence[]` in `ProviderDetection` and in every
 * verification check but never defines the type. The shape below is the minimum
 * that satisfies the properties the RFC *does* state:
 *
 * - "Detection must not infer success solely from a configuration string" —
 *   so evidence records its kind and can be counted by kind;
 * - the listed sources (executable resolution, `--version` output,
 *   package-manager inventory, hook/config presence, provider doctor output,
 *   smoke test) become the `kind` union;
 * - RFC 0005 §Identity and privacy forbids raw output in stored records, so
 *   `detail` is a short human-readable summary and never a captured payload.
 *
 * This gap is reported against RFC 0002 rather than silently widened.
 */

export type EvidenceKind =
  | 'executable-resolution'
  | 'version-output'
  | 'package-inventory'
  | 'config-entry'
  | 'provider-doctor'
  | 'smoke-test'
  | 'absence';

export interface Evidence {
  kind: EvidenceKind;
  /** What produced the observation: an executable, a file, a command name. */
  source: string;
  /** Absolute path when the observation is file-scoped, otherwise null. */
  path: string | null;
  /** A short summary. Never raw command output, prompts, or source code. */
  detail: string;
}

export function evidence(init: {
  kind: EvidenceKind;
  source: string;
  detail: string;
  path?: string | null;
}): Evidence {
  return {
    kind: init.kind,
    source: init.source,
    path: init.path ?? null,
    detail: init.detail,
  };
}

/**
 * RFC 0002 §Detection: a configuration string alone is not detection. Anything
 * other than `config-entry` and `absence` is corroborating evidence.
 */
export function hasCorroboratingEvidence(items: readonly Evidence[]): boolean {
  return items.some((item) => item.kind !== 'config-entry' && item.kind !== 'absence');
}
