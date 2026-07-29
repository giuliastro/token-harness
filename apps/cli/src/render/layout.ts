/**
 * Layout primitives shared by every human renderer.
 *
 * The column widths live next to the renderer that uses them; what lives here is
 * the padding, number, and path formatting the golden transcripts in RFC 0006
 * §Golden path depend on.
 */

/**
 * Pads to `width`, and always leaves at least `minimumGutter` spaces when the
 * value overflows the column. The golden transcripts never overflow; a longer
 * provider id in a later phase must not silently glue two columns together.
 */
export function column(value: string, width: number, minimumGutter = 2): string {
  if (value.length >= width) return value + ' '.repeat(minimumGutter);
  return value.padEnd(width, ' ');
}

export function rightAlign(value: string, width: number): string {
  return value.padStart(width, ' ');
}

/**
 * Groups an integer with commas. Deliberately not `toLocaleString`: the golden
 * files are byte-compared, and the runtime locale is not part of the contract.
 */
export function formatCount(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  let grouped = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits[i];
  }
  return negative ? `-${grouped}` : grouped;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * Renders a filesystem path for display.
 *
 * Two rules, both taken from the golden transcripts rather than invented:
 *
 * 1. a path under the home directory is abbreviated to `~/…`, because the
 *    doctor transcript shows `~/.claude/settings.json`;
 * 2. separators are rendered as `/` regardless of platform, because that same
 *    transcript is a Windows fixture — "Windows 11 (x64)" — and still shows
 *    forward slashes. This keeps the golden files identical on all three
 *    operating systems.
 *
 * Display only. Nothing downstream consumes this string as a path.
 */
export function displayPath(path: string, home: string | null): string {
  const normalized = path.replace(/\\/g, '/');
  if (home === null || home === '') return normalized;
  const normalizedHome = home.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === normalizedHome) return '~';
  const prefix = `${normalizedHome}/`;
  if (normalized.startsWith(prefix)) return `~/${normalized.slice(prefix.length)}`;
  return normalized;
}

/** Joins rendered lines with a single trailing newline and no trailing blanks. */
export function document(lines: readonly string[]): string {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return `${trimmed.map((line) => line.replace(/\s+$/, '')).join('\n')}\n`;
}

/** The context every human renderer receives. */
export interface RenderContext {
  toolVersion: string;
  /** Absolute home directory, used only for `~` abbreviation. */
  home: string | null;
  /**
   * RFC 0006 rule 4: decoration is suppressed when stdout is not a TTY, when
   * `NO_COLOR` is set, or when `--json` is used. No renderer decorates anything
   * at 0.1.0, so this is currently a contract the renderers honour trivially.
   */
  decorate: boolean;
}

/** RFC 0006 §Streams rule 4, as a predicate so it can be tested directly. */
export function shouldDecorate(input: {
  stdoutIsTty: boolean;
  noColor: boolean;
  json: boolean;
}): boolean {
  if (input.json) return false;
  if (input.noColor) return false;
  return input.stdoutIsTty;
}
