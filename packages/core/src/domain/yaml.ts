/**
 * The deliberately narrow YAML mutation carried by a `merge-yaml` action.
 *
 * Token Harness does not implement a general YAML object model. The first real consumer needs one
 * operation only: add one scalar string to a block-sequence at a dotted mapping path, e.g.
 * `plugins.enabled += harnesstrim`. Keeping that limit in the action schema makes unsupported YAML
 * fail closed instead of silently becoming a partial parser.
 */
export interface YamlStringArrayAppendOperation {
  readonly kind: 'append-string';
  readonly pointer: string;
  readonly value: string;
  /**
   * Digest of the value Token Harness previously owned, or null when no owned entry is expected.
   * Present for parity with persisted-plan preconditions even though the initial consumer only adds.
   */
  readonly expectedValueDigest: string | null;
  /**
   * Exact rendered-line digest recorded by the previous ownership receipt.
   *
   * Null when no owned entry is expected. This catches a user adding a YAML comment or changing
   * indentation even when the scalar value itself is unchanged.
   */
  readonly expectedLineDigest: string | null;
}

export type YamlMergeOperation = YamlStringArrayAppendOperation;

export function isYamlMergeOperationKind(value: unknown): value is YamlMergeOperation['kind'] {
  return value === 'append-string';
}
