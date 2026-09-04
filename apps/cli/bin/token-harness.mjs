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

  // `handoff` deliberately stays outside the historical parser/dispatcher so
  // adding it cannot widen CommandTable or mutate existing command semantics.
  // Surface that isolated command in human root help without corrupting RFC 0006
  // JSON help or command-specific help output.
  const positional = argv.find((token) => !token.startsWith('-'));
  const rootHumanHelp =
    argv.includes('--help') && !argv.includes('--json') && positional === undefined;
  if (rootHumanHelp) {
    process.stdout.write(
      '\nAdditional read-only command\n  handoff     Build a bounded compact handoff for another harness\n',
    );
  }
}
