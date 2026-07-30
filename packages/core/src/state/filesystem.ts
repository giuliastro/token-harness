/**
 * The filesystem port.
 *
 * `core` may not import `node:fs` or `node:path`, and the state layer has to read
 * and write files. So the state layer states what it needs and
 * `@token-harness/platform` provides it — the same seam RFC 0005 already uses for
 * `MetricsStore` and RFC 0002 §Process abstraction uses for the process runner.
 *
 * Path helpers are on the port rather than imported, because path grammar is
 * platform behaviour: `join` uses a different separator on Windows and `isInside`
 * is case-insensitive there and nowhere else. A core module that built paths by
 * string concatenation would be making a platform assumption silently.
 *
 * Content is bytes, not text. Every guarantee in RFC 0004 is byte-for-byte —
 * "rollback restores fixtures byte-for-byte", "configuration the user wrote is
 * preserved byte-for-byte" — and a decode/encode round trip through a string loses
 * exactly the things that matter: a byte-order mark, a CRLF line ending, a file
 * that is not valid UTF-8 at all.
 */

export type FileEntryKind = 'file' | 'directory' | 'other';

export interface FileStat {
  kind: FileEntryKind;
  byteLength: number;
  /**
   * Four-digit octal POSIX mode, or null on a platform where the mode carries no
   * access information. Native Windows reports null, so nothing in `core` can
   * accidentally treat a Windows mode as meaningful — the mistake RFC 0004 §State
   * directory permissions calls out for `fs.chmod`.
   */
  mode: string | null;
}

export interface FileSystemPort {
  join(...segments: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  /** True when `candidate` is `parent` or lives beneath it, with the platform's case rules. */
  isInside(candidate: string, parent: string): boolean;

  /** Null when the path does not exist. Any other failure throws. */
  stat(path: string): Promise<FileStat | null>;
  readFile(path: string): Promise<Uint8Array>;
  /** Creates parent directories as needed. `mode` is ignored where it means nothing. */
  writeFile(path: string, content: Uint8Array, mode?: string | null): Promise<void>;
  createDirectory(path: string): Promise<void>;
  /** Succeeds when the path is already gone: removal is idempotent. */
  remove(path: string): Promise<void>;
  /** Direct children, names only, sorted. Empty when the directory does not exist. */
  readDirectory(path: string): Promise<string[]>;
}
