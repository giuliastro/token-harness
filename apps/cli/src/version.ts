/**
 * The Token Harness version.
 *
 * Declared as source rather than read from `package.json` at runtime, because
 * the shipped artifact is a single self-contained ESM bundle with no package
 * manifest beside it. `apps/cli/test/version.test.ts` asserts this constant and
 * `package.json` never drift apart.
 */
export const TOOL_VERSION = '0.1.8';
