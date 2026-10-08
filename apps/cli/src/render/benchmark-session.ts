import type { BenchmarkPrepareReport } from '../commands/benchmark-prepare.js';
import type { BenchmarkRestoreReport } from '../commands/benchmark-session.js';
import { document, wrap } from './layout.js';

export function renderBenchmarkPrepare(report: BenchmarkPrepareReport): string {
  return document(
    [
      `Benchmark preparation — ${report.benchmarkId} / ${report.variant}`,
      `Status: ${report.status}; plan ${report.planId}; verification ${report.verificationTier}`,
      `Compression: ${report.compression ? 'ON' : 'OFF'} (${report.providers.join(', ')}); native routing: ${report.routing ? 'ON' : 'OFF'}`,
      `Initial configuration: ${report.initialConfigurationId}`,
      ...report.actions.map((a) => `${a.kind}: ${a.explanation}`),
      ...report.paths.map((path) => `Snapshot: ${path}`),
      report.capture === null
        ? 'Preview only. --yes approves temporary changes and verified restoration.'
        : `Capture: ${report.capture.capturePath}. Start a fresh coding session with the same task starting state.`,
      'Finish records measurements and quality before restoring the original configuration.',
      `Recovery: ${report.recoveryCommand}`,
    ].flatMap((line) => wrap(line, 0)),
  );
}
export function renderBenchmarkRestore(report: BenchmarkRestoreReport): string {
  return document(
    [
      `Benchmark restoration — ${report.benchmarkId} / ${report.variant}`,
      `Status: ${report.status}`,
      ...report.paths.map((path) => `Restore: ${path}`),
      ...(report.status === 'planned' ? ['Preview only; repeat with --yes to restore.'] : []),
    ].flatMap((line) => wrap(line, 0)),
  );
}
