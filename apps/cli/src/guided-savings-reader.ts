import type { MetricsReport } from '@token-harness/core';
import {
  GuideError,
  savingsView,
  type GuideCall,
  type GuidePeriod,
  type GuideSavings,
} from './guided.js';

const PERIODS = new Set<GuidePeriod>(['all', '7d', '30d']);

/** Read only the recorded-savings window. No agent, allowance, context or stack observation runs. */
export function createGuideSavingsReader(
  call: GuideCall,
): (period: GuidePeriod) => Promise<GuideSavings> {
  return async (period) => {
    if (!PERIODS.has(period)) throw new GuideError(400, 'Choose all history, 7 days or 30 days.');
    try {
      const result = await call<MetricsReport>([
        'savings',
        '--since',
        period === 'all' ? '1970-01-01' : period,
      ]);
      return savingsView(result.data, period);
    } catch {
      return savingsView(null, period);
    }
  };
}
