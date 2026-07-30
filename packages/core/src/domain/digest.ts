/**
 * Content digests.
 *
 * RFC 0004 §Ownership makes a digest the thing that decides whether Token Harness
 * may remove a file: "files it created and whose digest or ownership marker still
 * matches". RFC 0004 §Backup policy captures one with every snapshot, and RFC 0006
 * §Plan persistence makes a plan ID "a digest over the plan's normalized content".
 * Three separate contracts, one primitive, so it lives at the bottom of `core`.
 *
 * `node:crypto` is the one Node built-in `core` imports. That is within the rule
 * the architecture test enforces rather than an exception to it: the rule forbids
 * `node:fs`, `node:os`, `node:path`, `node:child_process`, and `node:process` —
 * the operating system — and hashing is arithmetic. The architecture test now
 * states the permission positively, so the boundary is a decision on the record
 * instead of a gap in a list.
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256, named in every digest string.
 *
 * The algorithm is part of the stored value rather than an implicit convention,
 * because a receipt written today is compared against a live file by a version of
 * Token Harness that may have moved on. A digest that cannot say what produced it
 * can only be trusted by assumption.
 */
export const DIGEST_ALGORITHM = 'sha256';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function digestBytes(content: Uint8Array): string {
  return `${DIGEST_ALGORITHM}:${createHash(DIGEST_ALGORITHM).update(content).digest('hex')}`;
}

/** UTF-8, with no byte-order mark. Callers holding raw bytes use {@link digestBytes}. */
export function digestText(text: string): string {
  return digestBytes(new TextEncoder().encode(text));
}

export function isDigest(value: string): boolean {
  return DIGEST_PATTERN.test(value);
}

/**
 * Constant-time-ish comparison is deliberately *not* used here.
 *
 * These digests are integrity markers for local configuration, not secrets, and
 * there is no remote party timing the comparison. Pretending otherwise would
 * suggest a threat model this does not have.
 */
export function digestsMatch(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left === right;
}
