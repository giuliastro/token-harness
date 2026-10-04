import type { EfficiencyDecision } from '@token-harness/core';
import { truncate, wrap } from './layout.js';

export function efficiencyDecisionLines(decision: EfficiencyDecision, verbose = false): string[] {
  const value = (input: string | number | null): string =>
    input === null ? 'unknown' : String(input);
  const percent = (input: number | null): string =>
    input === null ? 'unknown' : String(input) + '%';
  const lines = [
    ...wrap(`${decision.harness}/${decision.taskClass}: context ${decision.contextAction}`, 2),
    ...wrap(
      `model=${value(decision.model)} effort=${value(decision.reasoningEffort)} verbosity=${value(decision.verbosity)}`,
      4,
    ),
    ...wrap(
      `Task allowance: five-hour ${percent(decision.allowanceBudget.fiveHourPercent)}; weekly ${percent(decision.allowanceBudget.weeklyPercent)}`,
      4,
    ),
    ...wrap(
      `Attempts=${value(decision.maxAttempts)}; premium escalations=${value(decision.premiumEscalationBudget)}`,
      4,
    ),
  ];
  if (verbose) {
    for (const item of decision.evidence)
      lines.push(...wrap(`[${item.source}/${item.code}] ${item.summary}`, 4));
    for (const item of decision.reasons) lines.push(...wrap(`[${item.code}] ${item.summary}`, 4));
  }
  return lines.map((line) => truncate(line, 78));
}
