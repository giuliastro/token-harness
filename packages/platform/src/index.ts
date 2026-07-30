/**
 * Public surface of `@token-harness/platform`.
 *
 * ## Why this package exists
 *
 * RFC 0001 §Repository shape starts the implementation with three packages and
 * lists `state` as a module inside `core`. PLAN §1.2's acceptance criterion —
 * "domain objects contain no filesystem or process implementation" — was widened
 * by Phase 1 into an absolute rule over the whole `core` package, enforced by
 * `tests/integration/architecture.test.ts`: no `node:fs`, `node:os`, `node:path`,
 * `node:child_process`, or `node:process`, anywhere.
 *
 * Phase 2 is where those two meet. A permission check that runs `icacls`, a
 * `PATHEXT` search, and a `%LOCALAPPDATA%` resolution cannot live under a package
 * that may not import `node:path`. One of the two had to give.
 *
 * This package is the answer, and RFC 0001 authorises it directly: "Extraction,
 * not pre-splitting, is the rule. A package is extracted when a concrete consumer
 * appears." Three consumers appear now — the action executor of PLAN §2.3, the
 * harness and provider adapters of Phase 3, and `apps/cli` — and two of them are
 * in other packages, which is what makes the boundary load-bearing rather than
 * decorative.
 *
 * The alternative was to relax `core`'s rule for a `state` subtree. It was
 * rejected because the rule's value is that it is absolute: once `node:fs` is
 * legal anywhere in `core`, no test can tell an intended use from an accidental
 * one, and the planner and the metrics report lose the property too.
 *
 * ## The shape that results
 *
 * ```text
 * core       pure contracts and data      (no node:* at all)
 *   ^
 * platform   the operating-system seam    (the only package that may spawn)
 *   ^
 * adapters   harnesses and providers
 *   ^
 * cli
 * ```
 *
 * `ProcessRunner`, `PlatformFacts`, `PlatformPaths`, and the redaction policy are
 * *contracts*, so they stay in `core` — RFC 0002 §Process abstraction makes the
 * runner part of the provider contract, and the provider contract is core. Only
 * the implementations are here. That is the same seam RFC 0005 already uses for
 * `MetricsStore`, whose interface is in `core` and whose `JsonlStore` will land
 * here in PLAN §2.4.
 */

export * from './fs/node-filesystem.js';

export * from './platform/detect.js';
export * from './platform/executable.js';
export * from './platform/package-managers.js';
export * from './platform/paths.js';
export * from './platform/probe.js';

export * from './process/environment.js';
export * from './process/fake-runner.js';
export * from './process/node-runner.js';
export * from './process/windows-command-line.js';

export * from './state/sddl.js';
export * from './state/state-root.js';

export * from './host.js';
