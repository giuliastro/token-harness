# RFC 0019 - Managed Codex model policy

- Status: Accepted for this implementation
- Date: 2026-09-07
- Extends: RFC 0011, RFC 0016, RFC 0017, RFC 0018

## Decision

Allow a model recommendation produced by RFC 0018 to cross into `token-harness plan --native-policy` for Codex only when the recommendation remains a single-control change and every native ownership and catalog precondition can be re-observed.

This RFC does not introduce a new model-ranking heuristic. RFC 0018 remains the authority for deciding whether another model is outcome-safe and allowance-efficient, or whether a more expensive model is justified for repeated quality/retry recovery. RFC 0019 defines only the mutation gate after that evidence already exists.

## Planner gate

The optimizer runs first and freezes its advice. The planner then performs a fresh Codex native context observation. A model edit is admitted only when all of the following still hold:

- `modelLearning.state` is `learned`;
- `recommendedModel` differs from the configured base model and equals the learned candidate;
- the configured model still equals the optimizer's current model and the learner's base model;
- reasoning effort and verbosity still equal the fixed policy tuple used by model learning;
- reasoning effort is not also changing;
- verbosity is not also changing;
- the native model catalog is complete, not truncated;
- the requested model resolves to exactly one canonical model in that catalog;
- Codex exposed origin metadata for `model`;
- the effective `model` is either absent at that field or originates from the exact writable base-user `config.toml` target;
- the target path and config version are available for a versioned write.

Project, selected-profile, environment, or other higher-precedence model ownership remains user-owned and is never silently overwritten.

If any condition changed after optimizer advice, the planner keeps the recommendation advisory and emits a diagnostic rather than guessing.

## Stored action

An admitted model change is persisted as a `codex-config-batch-write` action with:

- `policyGuard: subscription-safe`;
- exactly one edit, `keyPath: model`;
- a logical `modelReference` whose `requested` value is the reviewed optimizer recommendation and whose resolution mode is `native-catalog`;
- the exact user config path and config version observed while planning;
- ordinary file-snapshot rollback data.

A subscription-safe batch containing `model` plus reasoning effort or verbosity is refused by the executor even if every individual key is otherwise permitted. This makes the RFC 0018 single-control sequencing an executable invariant rather than a planner convention.

## Apply-time catalog resolution

Apply does not trust the persisted model string as a writable canonical value. Before taking a config snapshot or invoking `config/batchWrite`, Token Harness re-reads Codex `model/list` with a bounded request.

Apply fails closed when:

- the catalog cannot be read;
- the catalog is truncated;
- the reviewed reference is absent;
- the reviewed reference resolves to more than one canonical model;
- the stored reference does not match exactly one reviewed model edit.

When exactly one canonical model resolves, that canonical value replaces the logical reference in the effective batch.

This protects stored plans from catalog drift between plan and apply, including renamed aliases and removed models.

## Versioned write and postcondition

After successful catalog resolution, Token Harness snapshots only the exact `config.toml` target and sends Codex `config/batchWrite` with the version observed during planning.

A `configVersionConflict` is precondition drift and is never retried against unseen user bytes.

The same app-server session then performs `config/read`. The effective `model` must equal the canonical value that was actually written. A missing or mismatched read-back is a failed action and the surrounding transaction restores the snapshot byte-for-byte.

## Subscription boundary

The subscription-safe Codex native write set now contains exactly:

- `model` under the RFC 0018/0019 learned single-control gate;
- `model_reasoning_effort` under the existing managed effort gate;
- `model_verbosity` under the existing managed verbosity gate.

Provider, authentication, service tier, API base URL, billing route, credit redemption and other fields remain outside this set.

A model name is not evidence of price, speed or quality. Admission depends on RFC 0018 project-local outcomes and exact-policy included-allowance evidence, never on strings such as `mini`, `fast`, `pro` or similar labels.

## Privacy and measurement boundary

No prompt, transcript, source code, OAuth token, cookie or API key is read to make this decision. Local token counts may help RFC 0018 identify an outcome-safe candidate, but they do not satisfy the included-allowance gate. Claude and Codex raw usage percentages are never compared across providers.

This implementation does not purchase or redeem credits, enable pay-as-you-go, route to a paid API, or infer an unpublished token-to-quota formula.

## Verification

The milestone is complete only when tests prove:

1. a learned RFC 0018 recommendation can produce a model-only native Codex action;
2. profile pressure or a model name alone cannot produce that action;
3. model/effort/verbosity drift between optimizer and native-plan observations blocks mutation;
4. project/profile-owned model values remain untouched;
5. incomplete or ambiguous planning catalogs block mutation;
6. a subscription-safe model + effort/verbosity batch is refused before invoking Codex;
7. apply-time missing, truncated or ambiguous catalog resolution fails before config mutation;
8. successful apply writes the canonical model and verifies it with `config/read`;
9. stale config version is treated as drift;
10. rollback restores the original config bytes;
11. Windows, macOS and Ubuntu pass typecheck, lint, format, tests, build, bundle smoke and install smoke.
