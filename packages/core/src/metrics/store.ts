/**
 * The storage seam — RFC 0005 §Storage.
 *
 * "The domain layer depends on a storage interface. No provider, planner, or
 * report knows which backend is in use." Only the interface exists at Phase 1;
 * `JsonlStore` is Phase 2 (PLAN §2.4).
 *
 * `ImportCursor` and `EventFilter` are named by RFC 0005 but not defined there.
 * The cursor is defined from RFC 0005 §Deduplicating a stream without event IDs,
 * which does specify its members exactly.
 */

import type { VerificationReceipt } from '../domain/verification.js';
import type { MeasurementClass, OptimizationEvent } from './events.js';

/**
 * RFC 0005: "the cursor is `(absolute path, device/inode or volume identity,
 * byte offset, digest of the last imported line)`".
 *
 * Every member of that tuple is shaped for an append-only *file*, which is the only
 * source RFC 0005 originally described. A source whose records carry their own
 * monotonic identifier — RTK's `commands` table is the first — has no byte offset and
 * no last line, and filling those fields with placeholders would make the cursor a
 * record of nothing. `highWaterMark` is the amendment; RFC 0005 §Importers §RTK now
 * states which fields are authoritative for which kind of source.
 */
export interface ImportCursor {
  providerId: string;
  /** The provider-native source this cursor tracks, e.g. a metrics file. */
  sourceId: string;
  absolutePath: string;
  /**
   * `dev:ino` on POSIX, volume serial plus file index on Windows. For a source with a
   * native identifier it carries the *generation* instead — something that changes when
   * the source is reset rather than appended to, which is the property RFC 0005 wanted
   * from the digest.
   */
  fileIdentity: string;
  /** Authoritative for a file source. Zero, and meaningless, for any other. */
  byteOffset: number;
  /** Digest of the last imported line; a mismatch means truncation or rotation. */
  lastLineDigest: string | null;
  /**
   * The highest native record identifier already imported, for a source whose records
   * carry one. Null for a file source, where the offset and the digest are the
   * authority.
   *
   * A string rather than a number because the identifier's type belongs to the source:
   * a SQLite `INTEGER PRIMARY KEY` and a ULID are both high-water marks, and coercing
   * either into the other's shape loses ordering.
   */
  highWaterMark: string | null;
  updatedAt: string;
}

export interface EventFilter {
  /** Inclusive ISO 8601 lower bound. */
  since?: string;
  /** Exclusive ISO 8601 upper bound. */
  until?: string;
  providerIds?: string[];
  harnessIds?: string[];
  projectId?: string;
  pipelineId?: string;
  classes?: MeasurementClass[];
}

export interface MetricsStore {
  appendEvents(events: OptimizationEvent[]): Promise<void>;
  readCursor(providerId: string, sourceId: string): Promise<ImportCursor | null>;
  writeCursor(cursor: ImportCursor): Promise<void>;
  query(filter: EventFilter): AsyncIterable<OptimizationEvent>;
  upsertReceipt(receipt: VerificationReceipt): Promise<void>;
}
