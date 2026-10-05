/** Full-stream hashes and a bounded tail with safe redaction at its left boundary. */
import { createHash } from 'node:crypto';
import {
  MINIMUM_REDACTABLE_LENGTH,
  REDACTED,
  redactText,
  type ProcessOutputStreamEvidence,
  type RedactionPolicy,
} from '@token-harness/core';

const TAIL_BYTES = 8192;
export function outputEvidenceCapture(policy: RedactionPolicy): {
  append(chunk: Buffer): void;
  finish(): ProcessOutputStreamEvidence;
} {
  const secrets = policy.secretValues
    .filter((v) => v.length >= MINIMUM_REDACTABLE_LENGTH)
    .map((v) => Buffer.from(v, 'utf8'));
  // Keep enough overlap to recognize any declared secret crossing the displayed cutoff.
  const overlap = secrets.reduce((maximum, secret) => Math.max(maximum, secret.length), 0);
  const limit = TAIL_BYTES + overlap;
  const hash = createHash('sha256');
  let bytes = 0;
  let tail = Buffer.alloc(0);
  let finished: ProcessOutputStreamEvidence | undefined;
  return {
    append(chunk) {
      hash.update(chunk);
      bytes += chunk.length;
      if (chunk.length >= limit) tail = Buffer.from(chunk.subarray(chunk.length - limit));
      else
        tail = Buffer.concat([
          tail.subarray(Math.max(0, tail.length + chunk.length - limit)),
          chunk,
        ]);
    },
    finish() {
      if (finished !== undefined) return finished;
      const cutoff = Math.max(0, tail.length - TAIL_BYTES);
      let start = cutoff;
      // Move past a boundary-spanning secret, including overlapping declared values.
      for (let previous = -1; previous !== start; ) {
        previous = start;
        for (const secret of secrets) {
          for (
            let position = tail.indexOf(secret);
            position >= 0 && position < start;
            position = tail.indexOf(secret, position + 1)
          ) {
            if (position + secret.length > start) start = position + secret.length;
          }
        }
      }
      finished = {
        sha256: hash.digest('hex'),
        bytes,
        tail: redactText(
          (start > cutoff ? REDACTED : '') + tail.subarray(start).toString('utf8'),
          policy,
        ),
      };
      return finished;
    },
  };
}
