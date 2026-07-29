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
 */
export interface ImportCursor {
  providerId: string;
  /** The provider-native source this cursor tracks, e.g. a metrics file. */
  sourceId: string;
  absolutePath: string;
  /** `dev:ino` on POSIX, volume serial plus file index on Windows. */
  fileIdentity: string;
  byteOffset: number;
  /** Digest of the last imported line; a mismatch means truncation or rotation. */
  lastLineDigest: string | null;
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
