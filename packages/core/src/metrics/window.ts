/**
 * The reporting window — RFC 0006 §Golden path uses `--since 7d`.
 *
 * Two spellings, and both are needed for different reasons. A relative duration (`7d`) is
 * what a person types; an absolute date (`2026-07-22`) is what a script needs in order to
 * produce the same report tomorrow. Accepting only the first would make every automated
 * report a moving target.
 *
 * Nothing here reads a clock. `now` is passed in, so a window is reproducible in a test and
 * a golden transcript does not change overnight.
 */

/** `7d`, `12h`, `30m`, `2w`. Anchored, so `7dx` and `d7` are rejected rather than partly read. */
const DURATION_PATTERN = /^(\d{1,6})(m|h|d|w)$/;

/** `2026-07-22`, and only that. A partial date is not a date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNIT_MS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export interface MetricsWindow {
  /** Inclusive ISO 8601 instant, for `EventFilter.since`. */
  sinceInstant: string;
  /** Exclusive ISO 8601 instant, for `EventFilter.until`. */
  untilInstant: string;
  /** Inclusive `YYYY-MM-DD`, for the report header. */
  windowStart: string;
  /** Inclusive `YYYY-MM-DD`, for the report header. */
  windowEnd: string;
}

export type WindowParseFailure =
  | 'not-a-duration-or-date'
  | 'duration-out-of-range'
  | 'start-after-end';

export type WindowResolution =
  | { ok: true; window: MetricsWindow }
  | { ok: false; failure: WindowParseFailure; detail: string };

/** The default when no window is given: a week, matching RFC 0006's transcript. */
export const DEFAULT_WINDOW = '7d';

function isoDate(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * A bound, as an instant.
 *
 * A relative duration counts back from `now`. An absolute date is taken as midnight UTC —
 * not local midnight, because a report whose boundary moves with the reader's timezone is
 * not reproducible, and RFC 0005 stamps every event in UTC.
 */
function resolveBound(value: string, now: number): number | WindowParseFailure {
  const duration = DURATION_PATTERN.exec(value);
  if (duration !== null) {
    const amount = Number(duration[1]);
    const unit = UNIT_MS[duration[2] as string] ?? 0;
    if (amount === 0) return 'duration-out-of-range';
    return now - amount * unit;
  }

  const date = DATE_PATTERN.exec(value);
  if (date !== null) {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) return 'not-a-duration-or-date';
    // `2026-02-31` matches the pattern, and `Date.parse` does not reject it — it rolls the
    // value over to 3 March. A report for a day that does not exist would then silently
    // cover a different one, so the parse is confirmed by round-tripping it back to a date.
    if (new Date(parsed).toISOString().slice(0, 10) !== value) return 'not-a-duration-or-date';
    return parsed;
  }

  return 'not-a-duration-or-date';
}

/**
 * Resolves `--since` and `--until` into a window.
 *
 * The upper bound is exclusive as an instant but inclusive as a *date* in the header, which
 * is the difference between "up to the end of the 29th" and "up to the moment the 29th
 * began". `--until` defaults to now, so the last day is reported up to the current instant
 * rather than truncated at its midnight.
 */
export function resolveMetricsWindow(input: {
  since?: string | null;
  until?: string | null;
  /** ISO 8601 instant. */
  now: string;
}): WindowResolution {
  const now = Date.parse(input.now);
  if (Number.isNaN(now)) {
    return { ok: false, failure: 'not-a-duration-or-date', detail: input.now };
  }

  const sinceValue = input.since ?? DEFAULT_WINDOW;
  const since = resolveBound(sinceValue, now);
  if (typeof since === 'string') return { ok: false, failure: since, detail: sinceValue };

  const untilValue = input.until ?? null;
  let until = now;
  if (untilValue !== null) {
    const resolved = resolveBound(untilValue, now);
    if (typeof resolved === 'string') return { ok: false, failure: resolved, detail: untilValue };
    // An explicit `--until 2026-07-29` means through the end of that day, so the exclusive
    // instant is the following midnight. Without this, the named day reports nothing.
    until = DATE_PATTERN.test(untilValue) ? resolved + UNIT_MS['d']! : resolved;
  }

  if (since >= until) {
    return {
      ok: false,
      failure: 'start-after-end',
      detail: `${new Date(since).toISOString()} is not before ${new Date(until).toISOString()}`,
    };
  }

  return {
    ok: true,
    window: {
      sinceInstant: new Date(since).toISOString(),
      untilInstant: new Date(until).toISOString(),
      windowStart: isoDate(since),
      // The last *included* day, which is the instant before the exclusive bound.
      windowEnd: isoDate(until - 1),
    },
  };
}
