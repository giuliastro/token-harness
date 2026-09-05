/**
 * Layout primitives shared by every human renderer.
 *
 * The column widths live next to the renderer that uses them; what lives here is
 * the padding, number, and path formatting the golden transcripts in RFC 0006
 * §Golden path depend on.
 */

/**
 * The widest line any renderer may emit.
 *
 * 80 columns is the floor for a terminal, and nothing here was measured against it until a user
 * sent a screenshot of `plan` producing 133-character lines: they wrapped mid-word, so the output
 * read as noise rather than as a table. `tests/integration/line-width.test.ts` now fails if any
 * renderer exceeds this, which is the only reason it will stay true.
 */
export const MAX_WIDTH = 78;

/**
 * Wraps on word boundaries, with every line after the first indented to `indent`.
 *
 * A terminal wraps too, and that is the problem this exists to prevent: it breaks at the column,
 * mid-word, with no indent, so a wrapped message loses both its shape and its left edge.
 */
export function wrap(text: string, indent: number, width = MAX_WIDTH): string[] {
  const limit = Math.max(20, width - indent);
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= limit) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);

  const pad = ' '.repeat(indent);
  return lines.map((line, index) => (index === 0 ? pad + line : pad + line));
}

/**
 * Pads to `width`, and always leaves at least `minimumGutter` spaces when the
 * value overflows the column. The golden transcripts never overflow; a longer
 * provider id in a later phase must not silently glue two columns together.
 */
export function column(value: string, width: number, minimumGutter = 2): string {
  if (value.length >= width) return value + ' '.repeat(minimumGutter);
  return value.padEnd(width, ' ');
}

/**
 * Cuts to `width`, marking the cut.
 *
 * Needed because the human diagnostic rendering is one line per diagnostic and no more: a message
 * longer than the terminal is shortened here rather than wrapped, and the full text stays in the
 * `--json` envelope where nothing is truncated.
 */
export function truncate(value: string, width: number): string {
  const characters = [...value];
  if (characters.length <= width) return value;
  return `${characters
    .slice(0, Math.max(1, width - 1))
    .join('')
    .trimEnd()}…`;
}

/**
 * The separator between columns.
 *
 * Columns used to be separated by runs of spaces, which is only a column if the reader already
 * knows where the boundaries are. With varying content the eye cannot tell a gap inside a value
 * from a gap between two, and the output reads as scattered words. A visible delimiter makes the
 * structure legible without any explanation beside it.
 */
export const COLUMN_SEPARATOR = ' - ';

/**
 * A row of columns, each padded to its width, joined by the separator.
 *
 * The last cell is not padded: trailing spaces before a newline are noise, and `document` strips
 * them anyway.
 */
export function row(cells: readonly (readonly [string, number])[]): string {
  const rendered = cells.map(([value, width], index) =>
    index === cells.length - 1 ? value : column(value, width, 0),
  );
  return rendered.join(COLUMN_SEPARATOR);
}

/**
 * Cuts a path from the left, keeping the end.
 *
 * A path is identified by its tail — the file name and the directory above it — so the ellipsis goes
 * at the front. `truncate` would have kept the drive letter and thrown the file name away.
 */
export function truncatePath(value: string, width: number): string {
  const characters = [...value];
  if (characters.length <= width) return value;
  return `…${characters.slice(characters.length - (width - 1)).join('')}`;
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
  /** Full technical human output; the default is a progressive action summary. */
  verbose?: boolean;
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
