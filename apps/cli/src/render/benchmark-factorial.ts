import type { TaskBenchmarkFactorialReport } from '@token-harness/core';
import { document, wrap } from './layout.js';

export function renderBenchmarkFactorialReport(report: TaskBenchmarkFactorialReport): string {
  const value = (number: number | null): string =>
    number === null ? 'unknown' : String(Math.round(number * 1000) / 1000);
  return document(
    [
      `Factorial benchmark — ${report.benchmarkId}`,
      `Status: ${report.status}; exploratory; configuration ${report.configurationEvidence ?? 'user-declared'}`,
      ...Object.entries(report.quality).map(
        ([arm, quality]) =>
          `${arm}: quality ${quality} (${report.qualitySources[arm as keyof typeof report.qualitySources]})`,
      ),
      ...(report.qualityMismatches.length === 0
        ? []
        : [`Check overrides recorded quality: ${report.qualityMismatches.join(', ')}`]),
      ...(report.missingArms.length === 0
        ? []
        : [`Missing arms: ${report.missingArms.join(', ')}`]),
      ...report.effects.flatMap((effect) => [
        '',
        `${effect.unit}${effect.scope === null ? '' : ` / ${effect.scope}`} (separate evidence)`,
        `Compression saving: ${value(effect.compressionSaving)}`,
        `Routing saving: ${value(effect.routingSaving)}`,
        `Combined saving: ${value(effect.combinedSaving)}`,
        `Interaction cost: ${value(effect.interactionCost)} (positive: above additive prediction)`,
      ]),
      '',
      ...report.reasons.flatMap((reason) => wrap(reason, 0)),
    ].flatMap((line) => wrap(line, 0)),
  );
}
