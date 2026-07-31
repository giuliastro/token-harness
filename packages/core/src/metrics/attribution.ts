/**
 * Project attribution — RFC 0005 §Privacy: "`projectId` is a local stable hash with a
 * machine-local salt."
 *
 * One sentence, and every word in it is load-bearing.
 *
 * *Local* and *machine-local salt*: the identifier must not be reversible into a path, and
 * it must not collide across machines in a way that would let two developers' events be
 * matched up if a store were ever shared. The salt supplies both — without it, a hash of
 * `C:\Software\TokenHarness` is the same everywhere and a dictionary of plausible paths
 * recovers it immediately.
 *
 * *Stable*: the same project must hash the same way on every run, or every report
 * fragments. That is why the salt is stored rather than derived, and why normalization
 * happens here rather than at each call site.
 *
 * The salt is passed in. `core` cannot read or create files, and the state directory is
 * where it belongs.
 */

import { digestText } from '../domain/digest.js';

/** Length of the hex body. Short enough to read in a report, wide enough not to collide. */
const PROJECT_ID_LENGTH = 12;

/**
 * Normalizes a project path before hashing.
 *
 * Everything here answers a real difference observed between two spellings of the same
 * directory, not a hypothetical one:
 *
 * - RTK records `\\?\C:\Software\TokenHarness`. The extended-length prefix is how Windows
 *   spells a path that bypasses `MAX_PATH`, and it denotes the same directory as the plain
 *   form. Left in, one project would hash as two.
 * - Backslashes and forward slashes both reach us on Windows, from different tools.
 * - A trailing separator is not a different directory.
 * - Windows paths are case-insensitive, so `C:\Software` and `c:\software` are one project.
 *   POSIX paths are not, and folding them would merge two real directories.
 */
export function normalizeProjectPath(path: string, caseInsensitive: boolean): string {
  let normalized = path.trim();

  // `\\?\C:\x` and the UNC form `\\?\UNC\server\share`.
  if (normalized.startsWith('\\\\?\\')) {
    const rest = normalized.slice(4);
    normalized = rest.startsWith('UNC\\') ? `\\\\${rest.slice(4)}` : rest;
  }

  normalized = normalized.replace(/\\/g, '/');
  // Collapse repeated separators, but keep a leading `//` — that is a UNC root, not noise.
  const leading = normalized.startsWith('//') ? '//' : '';
  normalized = leading + normalized.slice(leading.length).replace(/\/{2,}/g, '/');
  // A trailing separator is not a different directory — except on a root, where it is the
  // whole path. `C:` is not the root of drive C: on Windows it means the *current* directory
  // on that drive, so stripping the separator from `C:\` would change which directory the
  // identifier refers to.
  if (normalized.length > 1) {
    const stripped = normalized.replace(/\/+$/, '');
    normalized = stripped === '' || stripped.endsWith(':') ? `${stripped}/` : stripped;
  }

  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/**
 * The identifier for a project directory.
 *
 * `p_` prefixed so it is recognisable in a report and never mistaken for a path, a digest,
 * or a provider identifier.
 */
export function deriveProjectId(
  absolutePath: string,
  salt: string,
  caseInsensitive: boolean,
): string {
  const normalized = normalizeProjectPath(absolutePath, caseInsensitive);
  // The salt goes first and is separated by a byte that cannot occur in either operand, so
  // no pair of (salt, path) values can produce the same input as a different pair.
  const digest = digestText(`${salt}\u0000${normalized}`);
  return `p_${digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 1 + PROJECT_ID_LENGTH)}`;
}

/** Bytes of entropy in a generated salt. */
export const PROJECT_SALT_BYTES = 32;

/**
 * Whether a stored salt is usable.
 *
 * A short or empty salt is worse than no salt at all, because it looks like one. A file
 * truncated to zero bytes by a crash would otherwise silently turn every `projectId` on
 * the machine into an unsalted, reversible hash.
 */
export function isUsableSalt(value: string): boolean {
  return /^[0-9a-f]{32,}$/i.test(value.trim());
}
