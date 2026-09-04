/**
 * Compact cross-harness handoff — RFC 0011 Phase 18.7.
 *
 * This module is deliberately pure. It does not read transcripts, invoke a model, or infer quota
 * benefit. Callers supply only the state they intentionally want transferred, and the renderer
 * enforces a hard UTF-8 byte budget so switching harnesses cannot silently copy an entire session.
 */

export interface CompactHandoffInput {
  objective: string;
  decisions?: readonly string[];
  changedFiles?: readonly string[];
  validation?: readonly string[];
  unresolved?: readonly string[];
  nextAction: string;
  /** Hard UTF-8 byte ceiling for the rendered handoff. Minimum accepted value is 256 bytes. */
  maxBytes: number;
}

export interface CompactHandoffResult {
  markdown: string;
  bytes: number;
  maxBytes: number;
  truncated: boolean;
  omitted: {
    decisions: number;
    changedFiles: number;
    validation: number;
    unresolved: number;
  };
}

const encoder = new TextEncoder();
const MIN_HANDOFF_BYTES = 256;

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: readonly string[] | undefined): string[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;
  const suffix = '…';
  const suffixBytes = byteLength(suffix);
  if (maxBytes <= suffixBytes) return '';

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, middle).trimEnd();
    if (byteLength(candidate) + suffixBytes <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low).trimEnd()}${suffix}`;
}

interface MutableLists {
  decisions: string[];
  changedFiles: string[];
  validation: string[];
  unresolved: string[];
}

interface OmittedCounts {
  decisions: number;
  changedFiles: number;
  validation: number;
  unresolved: number;
}

function renderList(title: string, values: readonly string[], omitted: number): string[] {
  if (values.length === 0 && omitted === 0) return [];
  const lines = [`## ${title}`];
  for (const value of values) lines.push(`- ${value}`);
  if (omitted > 0) lines.push(`- … ${omitted} more omitted`);
  return lines;
}

function render(
  objective: string,
  nextAction: string,
  lists: MutableLists,
  omitted: OmittedCounts,
): string {
  const sections: string[][] = [
    ['# Compact handoff', '', '## Objective', objective],
    renderList('Decisions', lists.decisions, omitted.decisions),
    renderList('Changed files', lists.changedFiles, omitted.changedFiles),
    renderList('Validation', lists.validation, omitted.validation),
    renderList('Unresolved', lists.unresolved, omitted.unresolved),
    ['## Next action', nextAction],
  ].filter((section) => section.length > 0);

  return sections.map((section) => section.join('\n')).join('\n\n');
}

function largestOptionalList(lists: MutableLists): keyof MutableLists | null {
  const entries = (Object.keys(lists) as (keyof MutableLists)[])
    .filter((key) => lists[key].length > 0)
    .map((key) => ({ key, bytes: lists[key].reduce((sum, item) => sum + byteLength(item), 0) }))
    .sort((left, right) => right.bytes - left.bytes || left.key.localeCompare(right.key));
  return entries[0]?.key ?? null;
}

export function buildCompactHandoff(input: CompactHandoffInput): CompactHandoffResult {
  if (!Number.isInteger(input.maxBytes) || input.maxBytes < MIN_HANDOFF_BYTES) {
    throw new RangeError(`maxBytes must be an integer >= ${MIN_HANDOFF_BYTES}`);
  }

  let objective = clean(input.objective);
  let nextAction = clean(input.nextAction);
  if (!objective) throw new Error('objective must not be empty');
  if (!nextAction) throw new Error('nextAction must not be empty');

  const lists: MutableLists = {
    decisions: uniqueClean(input.decisions),
    changedFiles: uniqueClean(input.changedFiles),
    validation: uniqueClean(input.validation),
    unresolved: uniqueClean(input.unresolved),
  };
  const omitted: OmittedCounts = {
    decisions: 0,
    changedFiles: 0,
    validation: 0,
    unresolved: 0,
  };

  let markdown = render(objective, nextAction, lists, omitted);
  let truncated = false;

  // Remove optional detail one item at a time, always from the largest remaining section. This is
  // deterministic and retains breadth across sections better than deleting one whole category.
  while (byteLength(markdown) > input.maxBytes) {
    const key = largestOptionalList(lists);
    if (key === null) break;
    lists[key].pop();
    omitted[key] += 1;
    truncated = true;
    markdown = render(objective, nextAction, lists, omitted);
  }

  // If the mandatory objective/next-action pair itself is too large, split the remaining payload
  // budget between them. Keep the structure rather than silently exceeding the configured ceiling.
  if (byteLength(markdown) > input.maxBytes) {
    const skeleton = render('', '', lists, omitted);
    const available = Math.max(32, input.maxBytes - byteLength(skeleton));
    const objectiveBudget = Math.floor(available * 0.6);
    const nextBudget = available - objectiveBudget;
    objective = truncateUtf8(objective, objectiveBudget);
    nextAction = truncateUtf8(nextAction, nextBudget);
    truncated = true;
    markdown = render(objective, nextAction, lists, omitted);
  }

  // Defensive final clamp for unusual Unicode/header combinations. At the supported minimum budget
  // this should be unreachable, but the public contract is a hard byte ceiling, not a best effort.
  if (byteLength(markdown) > input.maxBytes) {
    markdown = truncateUtf8(markdown, input.maxBytes);
    truncated = true;
  }

  return {
    markdown,
    bytes: byteLength(markdown),
    maxBytes: input.maxBytes,
    truncated,
    omitted: { ...omitted },
  };
}
