#!/usr/bin/env node
// Workspace launcher. The self-contained ESM artifact is produced by
// `pnpm build` into dist/bundle/token-harness.mjs at the repository root; this
// file exists so `bin` resolves before anything has been built or bundled.
const argv = process.argv.slice(2);

if (argv[0] === 'handoff') {
  const { handoffMain } = await import('../dist/src/handoff-main.js');
  process.exitCode = await handoffMain(argv.slice(1));
} else {
  const { main } = await import('../dist/src/main.js');
  await main(argv);
}
