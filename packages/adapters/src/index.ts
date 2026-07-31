/**
 * Public surface of `@token-harness/adapters`.
 *
 * `harnesses` and `providers` are siblings and must not import one another: a
 * harness adapter that knows about a provider, or the reverse, is the coupling
 * the two-registry split exists to prevent. The rule is enforced by
 * `tests/integration/architecture.test.ts`.
 */

export * from './harnesses/index.js';
export * from './providers/index.js';
export * from './providers/rtk.js';
