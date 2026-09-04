/**
 * Public surface of `@token-harness/core`.
 *
 * The barrel is the boundary: `@token-harness/adapters` and `apps/cli` import
 * this module and never a path inside `src/`. The rule is enforced by
 * `tests/integration/architecture.test.ts` (PLAN §1.1).
 */

export * from './domain/actions.js';
export * from './domain/budget.js';
export * from './domain/benchmark.js';
export * from './domain/context-cost.js';
export * from './domain/cross-harness-evidence.js';
export * from './domain/cross-harness-scheduler.js';
export * from './domain/handoff.js';
export * from './domain/history.js';
export * from './domain/optimizer.js';
export * from './domain/action-conflicts.js';
export * from './domain/capabilities.js';
export * from './domain/compatibility-rows.js';
export * from './domain/compatibility.js';
export * from './domain/detection.js';
export * from './domain/diagnostics.js';
export * from './domain/digest.js';
export * from './domain/evidence.js';
export * from './domain/ids.js';
export * from './domain/json.js';
export * from './domain/yaml.js';
export * from './domain/manifest.js';
export * from './domain/ownership.js';
export * from './domain/plan.js';
export * from './domain/platform.js';
export * from './domain/process.js';
export * from './domain/redaction.js';
export * from './domain/reports.js';
export * from './domain/verification.js';
export * from './domain/version.js';

export * from './envelope/envelope.js';
export * from './envelope/exit-codes.js';
export * from './envelope/parse.js';

export * from './planner/drift.js';
export * from './planner/resolver.js';
export * from './planner/removal-order.js';
export * from './planner/rules.js';
export * from './planner/stored-plan.js';

export * from './metrics/attribution.js';
export * from './metrics/events.js';
export * from './metrics/local-database.js';
export * from './metrics/report.js';
export * from './metrics/pipeline.js';
export * from './metrics/channels.js';
export * from './metrics/store.js';
export * from './metrics/window.js';

export * from './state/actions.js';
export * from './state/filesystem.js';
export * from './state/install.js';
export * from './state/journal.js';
export * from './state/jsonl-store.js';
export * from './state/json-merge.js';
export * from './state/jsonc.js';
export * from './state/yaml-array.js';
export * from './state/marker-block.js';
export * from './state/pins.js';
export * from './state/snapshots.js';
export * from './state/transaction.js';
