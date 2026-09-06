/** A publishable story about one comparable row, never a cross-provider total. */
import type { ProviderSavingsRow } from '@token-harness/core';

export interface GuideImpact {
  kind: 'reduction' | 'growth' | 'unchanged' | 'unavailable';
  headline: string;
  detail: string;
  percent: string | null;
  share: {
    title: string;
    text: string;
    shortText: string;
    provider: string;
    measurement: string;
    window: string;
    beforeAfter: string;
    operations: string;
    caveat: string;
    url: string;
  } | null;
}

export function savingsImpact(
  row: ProviderSavingsRow,
  window: { start: string; end: string; all: boolean },
): GuideImpact {
  const unavailable: GuideImpact = {
    kind: 'unavailable',
    headline: 'Recorded reduction',
    detail: 'A comparable before/after pair is required for a percentage or shareable result.',
    percent: null,
    share: null,
  };
  const { before, after, saved, operations } = row;
  const validCount = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;
  if (
    !validCount(before) ||
    !validCount(after) ||
    !Number.isFinite(saved) ||
    Math.abs(saved) > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(operations) ||
    operations <= 0 ||
    !['exact-local', 'estimated-local'].includes(row.class) ||
    !['tokens', 'chars'].includes(row.unit) ||
    Math.abs(before - after - saved) > Math.max(1e-6, Math.max(before, after) * 1e-10)
  )
    return unavailable;

  const estimated = row.class === 'estimated-local';
  const kind = saved > 0 ? 'reduction' : saved < 0 ? 'growth' : 'unchanged';
  const raw = before > 0 ? (Math.abs(saved) / before) * 100 : null;
  // Do not round a non-zero residual away into an apparent 100% reduction.
  const truncated = raw === null ? null : Math.floor(raw * 10 + 1e-9) / 10;
  const rounded =
    kind === 'reduction' && after > 0 && truncated !== null ? Math.min(99.9, truncated) : truncated;
  const percent = raw === null ? null : raw > 0 && rounded === 0 ? '<0.1%' : `${rounded}%`;
  const metric = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const unit = row.unit === 'tokens' ? 'tokens' : 'characters';
  const headline =
    kind === 'unchanged'
      ? 'No net output reduction'
      : percent !== null
        ? `${estimated ? 'Estimated ' : ''}${percent} ${kind === 'reduction' ? 'less' : 'more'} tool output`
        : `${estimated ? 'Estimated ' : ''}${metric.format(Math.abs(saved))} ${unit} ${kind === 'reduction' ? 'removed' : 'added'}`;
  const detail =
    kind === 'growth'
      ? 'These recorded outputs became larger. This is not a saving.'
      : kind === 'unchanged'
        ? 'The recorded reductions and increases balance out.'
        : 'Less output to carry into context. Scope: recorded changed outputs only.';
  const impact: GuideImpact = { kind, headline, detail, percent, share: null };
  const provider =
    row.providerId === 'rtk' ? 'RTK' : row.providerId === 'harnesstrim' ? 'HarnessTrim' : null;
  const isoDate = (value: string): string | null => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
  };
  const start = isoDate(window.start),
    end = isoDate(window.end);
  if (kind !== 'reduction' || provider === null || start === null || end === null || start > end)
    return impact;
  const scope = window.all ? `Retained history through ${end}` : `${start} to ${end}`;
  const measurement = estimated ? 'Local estimate' : 'Local measurement';
  const beforeAfter = `${metric.format(before)} -> ${metric.format(after)} ${unit}`;
  const changed = `${metric.format(operations)} recorded changed outputs`;
  const caveat = 'Changed outputs only. Not full-session, money or subscription-quota savings.';
  const title = `${provider}: ${headline}`;
  // Only allowlisted provider names, numeric aggregates and reporting dates leave the app.
  const url = 'https://github.com/giuliastro/token-harness';
  const shortText = `${title}. ${measurement}. ${scope}. Changed outputs only, not quota savings. Tracked with Token Harness.`;
  impact.share = {
    title,
    text: `${title}\n${beforeAfter} across ${changed}.\n${measurement}. ${scope}.\n${caveat}\nTracked with Token Harness.\n${url}`,
    shortText,
    provider,
    measurement,
    window: scope,
    beforeAfter,
    operations: changed,
    caveat,
    url,
  };
  return impact;
}
