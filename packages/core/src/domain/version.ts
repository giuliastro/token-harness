/**
 * Semantic versions and tested ranges.
 *
 * RFC 0002 §Versioning: "Provider compatibility is expressed as tested version
 * ranges. Unknown newer provider versions produce a warning and default to
 * conservative behavior." RFC 0002 §Harness versioning is symmetric extends the
 * same rule to harnesses, so this module is deliberately free of any
 * provider/harness distinction.
 */

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  build: string | null;
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = SEMVER.exec(value.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

export function formatSemanticVersion(version: SemanticVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const pre = version.prerelease === null ? '' : `-${version.prerelease}`;
  const build = version.build === null ? '' : `+${version.build}`;
  return `${core}${pre}${build}`;
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  // A release outranks any prerelease of the same core version.
  if (a === null) return 1;
  if (b === null) return -1;
  const left = a.split('.');
  const right = b.split('.');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** Build metadata is ignored, per the semver specification. */
export function compareVersions(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * A tested range is a closed interval over versions the project has actually
 * exercised. It is not a semver range expression: RFC 0002 speaks of *tested*
 * versions, and a caret range would claim coverage nobody produced.
 */
export interface TestedVersionRange {
  /** Inclusive lower bound. */
  minimum: string;
  /**
   * Inclusive upper bound, or null when the range is open-ended because the
   * upstream has not shipped a newer release yet.
   */
  maximum: string | null;
}

export type VersionVerdict =
  | 'in-range'
  | 'below-range'
  /** Newer than anything tested: warn and behave conservatively. */
  | 'unknown-newer'
  /** The observed value is not a semantic version at all. */
  | 'unparseable';

export function classifyVersion(observed: string, range: TestedVersionRange): VersionVerdict {
  const version = parseSemanticVersion(observed);
  const minimum = parseSemanticVersion(range.minimum);
  if (version === null || minimum === null) return 'unparseable';
  if (compareVersions(version, minimum) < 0) return 'below-range';
  if (range.maximum === null) return 'in-range';
  const maximum = parseSemanticVersion(range.maximum);
  if (maximum === null) return 'unparseable';
  return compareVersions(version, maximum) > 0 ? 'unknown-newer' : 'in-range';
}

export function formatTestedRange(range: TestedVersionRange): string {
  return range.maximum === null ? `>=${range.minimum}` : `${range.minimum}–${range.maximum}`;
}
