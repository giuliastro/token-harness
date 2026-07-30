/**
 * JSON values and the merge operations an action carries.
 *
 * These are in `domain` rather than beside the merge implementation because a
 * `merge-json` action is *data in a plan*: RFC 0002 §Planning requires a plan to be
 * serializable, and RFC 0006 §Plan persistence has a reviewer read one before it
 * runs. The behaviour that applies them lives in `state/json-merge.ts`.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * One owned edit to a JSON document.
 *
 * Two kinds, because two kinds of thing get owned. `set` owns the value at a
 * pointer — a scalar, an object, a whole array Token Harness introduced. `append`
 * owns *one element* of an array whose other elements belong to the user or to
 * another tool, which is the shape every harness hook list has.
 *
 * Both carry a precondition digest, for the reason RFC 0006 §Plan persistence gives:
 * a stored plan is rejected when "a recorded precondition digest no longer matches".
 * Null means nothing of ours must be there yet.
 */
export type JsonMergeOperation =
  | {
      readonly kind: 'set';
      readonly pointer: string;
      readonly value: JsonValue;
      readonly expectedValueDigest: string | null;
    }
  | {
      readonly kind: 'append';
      readonly pointer: string;
      readonly value: JsonValue;
      readonly expectedValueDigest: string | null;
    };

export function isJsonMergeOperationKind(value: unknown): value is JsonMergeOperation['kind'] {
  return value === 'set' || value === 'append';
}
