#!/usr/bin/env node
// Workspace launcher. The self-contained ESM artifact is produced by
// `pnpm build` into dist/bundle/token-harness.mjs at the repository root; this
// file exists so `bin` resolves before anything has been built or bundled.
const argv = process.argv.slice(2);

if (argv[0] === 'handoff') {
  const { handoffMain } = await import('../dist/src/handoff-main.js');
  process.exitCode = await handoffMain(argv.slice(1));
} else if (argv[0] === 'transfer') {
  const [{ transferMain }, { observeProjectTransferExperiment }] = await Promise.all([
    import('../dist/src/transfer-main.js'),
    import('../dist/src/transfer-runtime.js'),
  ]);
  process.exitCode = await transferMain(argv.slice(1), undefined, {
    observeExperiment: ({ benchmarkId, handoffFile }) =>
      observeProjectTransferExperiment({
        cwd: process.cwd(),
        benchmarkId,
        handoffFile,
      }),
  });
} else if (argv[0] === 'transfer-record') {
  const [{ transferRecordMain }, { recordObservedProjectTransferEvidence }] = await Promise.all([
    import('../dist/src/transfer-record-main.js'),
    import('../dist/src/transfer-runtime.js'),
  ]);
  process.exitCode = await transferRecordMain(argv.slice(1), undefined, {
    recordEvidence: ({ benchmarkId, handoffFile, maxHandoffBytes, recordedAt }) =>
      recordObservedProjectTransferEvidence({
        cwd: process.cwd(),
        benchmarkId,
        handoffFile,
        maxHandoffBytes,
        recordedAt,
      }),
  });
} else if (argv[0] === 'schedule') {
  const [{ scheduleMain }, { observeScheduleBudget }, { observeScheduleQualityReceipts }] =
    await Promise.all([
      import('../dist/src/schedule-main.js'),
      import('../dist/src/schedule-budget.js'),
      import('../dist/src/schedule-quality.js'),
    ]);
  process.exitCode = await scheduleMain(argv.slice(1), undefined, {
    observeBudget: () => observeScheduleBudget({ cwd: process.cwd() }),
    observeQualityReceipts: () => observeScheduleQualityReceipts({ cwd: process.cwd() }),
  });
} else {
  const { main } = await import('../dist/src/main.js');
  await main(argv);

  // Phase 18.7 surfaces deliberately stay outside the historical parser/dispatcher so they cannot
  // widen CommandTable or mutate existing command semantics.
  const positional = argv.find((token) => !token.startsWith('-'));
  const rootHumanHelp =
    argv.includes('--help') && !argv.includes('--json') && positional === undefined;
  if (rootHumanHelp) {
    process.stdout.write(
      '\nAdditional read-only commands\n' +
        '  handoff     Build a bounded compact handoff for another harness\n' +
        '  transfer    Evaluate a measured cross-harness handoff experiment\n' +
        '  schedule    Evaluate a Claude Code ↔ Codex switch with live quota + local quality evidence\n' +
        '\nEvidence capture commands\n' +
        '  transfer-record  Record one immutable project-scoped transfer evidence receipt\n',
    );
  }
}
