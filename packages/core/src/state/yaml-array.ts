/**
 * Conservative byte-preserving YAML block-sequence editing.
 *
 * This is intentionally not a YAML parser. It recognizes only plain mapping keys and block
 * sequences of scalar strings, which is enough for Hermes' `plugins.enabled`. Tabs, duplicate
 * mapping keys, flow-style values, ambiguous indentation, aliases/anchors and multiline constructs
 * are refused rather than normalized.
 */

import { digestText } from '../domain/digest.js';

export interface YamlOwnedArrayEntry {
  pointer: string;
  valueDigest: string;
  /** Digest of the exact rendered line, including indentation. User edits therefore block removal. */
  lineDigest: string;
}

export type YamlMergeResult =
  | { state: 'merged'; text: string; entry: YamlOwnedArrayEntry; changed: boolean }
  | { state: 'unmergeable'; reason: string };

export type YamlEntryLookup =
  | { state: 'found'; valueDigest: string; lineDigest: string }
  | { state: 'absent' }
  | { state: 'unmergeable'; reason: string };

export type YamlEntryRemoval =
  | { state: 'removed'; text: string }
  | { state: 'absent' }
  | { state: 'modified' }
  | { state: 'unmergeable'; reason: string };

interface Line {
  text: string;
  indent: number;
  content: string;
  blank: boolean;
  comment: boolean;
}

interface MappingLocation {
  index: number;
  indent: number;
  value: string;
  blockEnd: number;
}

interface SequenceItem {
  index: number;
  indent: number;
  value: string | null;
  lineDigest: string;
}

function yamlStringDigest(value: string): string {
  return digestText(`yaml-string:${value}`);
}

function lineDigest(line: string): string {
  return digestText(`yaml-line:${line}`);
}

function splitText(text: string): {
  lines: string[];
  eol: string;
  trailingNewline: boolean;
  bom: boolean;
} {
  const bom = text.startsWith('\uFEFF');
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const normalized = body.replace(/\r\n/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, eol, trailingNewline, bom };
}

function joinText(input: {
  lines: readonly string[];
  eol: string;
  trailingNewline: boolean;
  bom: boolean;
}): string {
  const body = input.lines.join(input.eol) + (input.trailingNewline ? input.eol : '');
  return input.bom ? `\uFEFF${body}` : body;
}

function classify(raw: string): Line {
  const leading = /^ */.exec(raw)?.[0] ?? '';
  const content = raw.slice(leading.length);
  return {
    text: raw,
    indent: leading.length,
    content,
    blank: content.trim() === '',
    comment: content.trimStart().startsWith('#'),
  };
}

function validateDocument(lines: readonly string[]): string | null {
  if (lines.some((line) => line.includes('\t'))) return 'tabs are not supported in managed YAML';
  if (
    lines.some((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('---') || trimmed.startsWith('...') || /(^|\s)[&*!][^\s]*/.test(trimmed);
    })
  ) {
    return 'document markers, aliases, anchors and tagged values are not supported in managed YAML';
  }
  return null;
}

function parsePointer(pointer: string): string[] | null {
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(pointer)) return null;
  const segments = pointer.split('.');
  return segments.length > 0 ? segments : null;
}

function mappingLine(line: Line): { key: string; value: string } | null {
  if (line.blank || line.comment) return null;
  const match = /^([A-Za-z0-9_-]+):(?:[ ]*(.*))?$/.exec(line.content);
  if (match === null) return null;
  return { key: match[1] ?? '', value: match[2] ?? '' };
}

function blockEnd(lines: readonly Line[], index: number, indent: number): number {
  for (let at = index + 1; at < lines.length; at += 1) {
    const line = lines[at];
    if (line === undefined || line.blank || line.comment) continue;
    if (line.indent <= indent) return at;
  }
  return lines.length;
}

function findMapping(
  lines: readonly Line[],
  key: string,
  parent: { index: number; indent: number; blockEnd: number } | null,
): MappingLocation | { error: string } | null {
  const start = parent === null ? 0 : parent.index + 1;
  const end = parent === null ? lines.length : parent.blockEnd;
  const candidates: MappingLocation[] = [];
  let childIndent: number | null = parent === null ? 0 : null;

  if (parent !== null) {
    for (let at = start; at < end; at += 1) {
      const line = lines[at];
      if (line === undefined || line.blank || line.comment) continue;
      if (line.indent <= parent.indent) break;
      childIndent = childIndent === null ? line.indent : Math.min(childIndent, line.indent);
    }
    if (childIndent === null) return null;
  }

  for (let at = start; at < end; at += 1) {
    const line = lines[at];
    if (line === undefined || line.blank || line.comment) continue;
    if (line.indent !== childIndent) continue;
    const mapping = mappingLine(line);
    if (mapping?.key !== key) continue;
    candidates.push({
      index: at,
      indent: line.indent,
      value: mapping.value,
      blockEnd: blockEnd(lines, at, line.indent),
    });
  }

  if (candidates.length > 1) return { error: `duplicate mapping key ${JSON.stringify(key)}` };
  return candidates[0] ?? null;
}

function locatePath(
  lines: readonly Line[],
  pointer: string,
): MappingLocation | { error: string } | null {
  const segments = parsePointer(pointer);
  if (segments === null) return { error: 'the pointer is not a supported dotted mapping path' };
  let parent: MappingLocation | null = null;
  for (const segment of segments) {
    const found = findMapping(lines, segment, parent);
    if (found === null) return null;
    if ('error' in found) return found;
    if (parent !== null && parent.value !== '') {
      return { error: `${segments.slice(0, segments.indexOf(segment)).join('.')} has an inline value` };
    }
    parent = found;
  }
  return parent;
}

function parseScalar(text: string): string | null {
  const trimmed = text.trim();
  if (/^[A-Za-z0-9_.@/+:-]+$/.test(trimmed)) return trimmed;
  const single = /^'([^']*)'$/.exec(trimmed);
  if (single !== null) return single[1] ?? '';
  const double = /^"([^"\\]*)"$/.exec(trimmed);
  if (double !== null) return double[1] ?? '';
  return null;
}

function sequenceItems(lines: readonly Line[], mapping: MappingLocation): SequenceItem[] | { error: string } {
  if (mapping.value !== '') return { error: 'flow-style or scalar values are not supported for the target sequence' };
  const items: SequenceItem[] = [];
  let itemIndent: number | null = null;

  for (let at = mapping.index + 1; at < mapping.blockEnd; at += 1) {
    const line = lines[at];
    if (line === undefined || line.blank || line.comment) continue;
    if (line.indent <= mapping.indent) break;

    const match = /^- +(.*)$/.exec(line.content);
    if (match === null) {
      return { error: 'the target sequence contains a non-sequence child or unsupported multiline item' };
    }
    itemIndent = itemIndent ?? line.indent;
    if (line.indent !== itemIndent) return { error: 'the target sequence has ambiguous indentation' };
    const value = parseScalar(match[1] ?? '');
    items.push({
      index: at,
      indent: line.indent,
      value,
      lineDigest: lineDigest(line.text),
    });
  }
  return items;
}

function renderNested(segments: readonly string[], value: string, baseIndent: number): string[] {
  const lines: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    lines.push(`${' '.repeat(baseIndent + index * 2)}${segments[index]}:`);
  }
  lines.push(`${' '.repeat(baseIndent + segments.length * 2)}- ${value}`);
  return lines;
}

export function mergeYamlStringArrayEntry(input: {
  text: string;
  pointer: string;
  value: string;
}): YamlMergeResult {
  if (!/^[A-Za-z0-9_.@/+:-]+$/.test(input.value)) {
    return { state: 'unmergeable', reason: 'only a plain scalar string is supported' };
  }
  const parts = splitText(input.text);
  const invalid = validateDocument(parts.lines);
  if (invalid !== null) return { state: 'unmergeable', reason: invalid };
  const segments = parsePointer(input.pointer);
  if (segments === null) {
    return { state: 'unmergeable', reason: 'the pointer is not a supported dotted mapping path' };
  }

  const lines = [...parts.lines];
  const classified = lines.map(classify);
  const target = locatePath(classified, input.pointer);
  if (target !== null && 'error' in target) return { state: 'unmergeable', reason: target.error };

  if (target !== null) {
    const items = sequenceItems(classified, target);
    if ('error' in items) return { state: 'unmergeable', reason: items.error };
    const digest = yamlStringDigest(input.value);
    const existing = items.find((item) => item.value !== null && yamlStringDigest(item.value) === digest);
    if (existing !== undefined) {
      return {
        state: 'merged',
        text: input.text,
        changed: false,
        entry: { pointer: input.pointer, valueDigest: digest, lineDigest: existing.lineDigest },
      };
    }
    if (items.some((item) => item.value === null)) {
      return { state: 'unmergeable', reason: 'the target sequence contains an unsupported scalar syntax' };
    }
    const indent = items[0]?.indent ?? target.indent + 2;
    const inserted = `${' '.repeat(indent)}- ${input.value}`;
    lines.splice(target.blockEnd, 0, inserted);
    return {
      state: 'merged',
      text: joinText({ ...parts, lines }),
      changed: true,
      entry: {
        pointer: input.pointer,
        valueDigest: digest,
        lineDigest: lineDigest(inserted),
      },
    };
  }

  // Missing path: create only the missing tail beneath the deepest existing mapping. This keeps
  // unrelated top-level and sibling mappings byte-for-byte intact.
  let parent: MappingLocation | null = null;
  let missingAt = 0;
  for (; missingAt < segments.length; missingAt += 1) {
    const found = findMapping(classified, segments[missingAt] ?? '', parent);
    if (found === null) break;
    if ('error' in found) return { state: 'unmergeable', reason: found.error };
    if (parent !== null && parent.value !== '') {
      return { state: 'unmergeable', reason: 'an intermediate mapping has an inline value' };
    }
    parent = found;
  }

  const tail = segments.slice(missingAt);
  if (tail.length === 0) return { state: 'unmergeable', reason: 'the target sequence could not be located' };
  const baseIndent = parent === null ? 0 : parent.indent + 2;
  const nested = renderNested(tail, input.value, baseIndent);
  const insertAt = parent === null ? lines.length : parent.blockEnd;
  if (parent === null && lines.length > 0 && lines[lines.length - 1]?.trim() !== '') lines.push('');
  const adjustedInsert = parent === null ? lines.length : insertAt;
  lines.splice(adjustedInsert, 0, ...nested);
  const renderedLine = nested[nested.length - 1] ?? '';
  return {
    state: 'merged',
    text: joinText({ ...parts, lines }),
    changed: true,
    entry: {
      pointer: input.pointer,
      valueDigest: yamlStringDigest(input.value),
      lineDigest: lineDigest(renderedLine),
    },
  };
}

export function findYamlStringArrayEntry(input: {
  text: string;
  pointer: string;
  valueDigest: string;
}): YamlEntryLookup {
  const parts = splitText(input.text);
  const invalid = validateDocument(parts.lines);
  if (invalid !== null) return { state: 'unmergeable', reason: invalid };
  const lines = parts.lines.map(classify);
  const target = locatePath(lines, input.pointer);
  if (target === null) return { state: 'absent' };
  if ('error' in target) return { state: 'unmergeable', reason: target.error };
  const items = sequenceItems(lines, target);
  if ('error' in items) return { state: 'unmergeable', reason: items.error };
  for (const item of items) {
    if (item.value !== null && yamlStringDigest(item.value) === input.valueDigest) {
      return { state: 'found', valueDigest: input.valueDigest, lineDigest: item.lineDigest };
    }
  }
  return { state: 'absent' };
}

export function removeYamlStringArrayEntry(input: {
  text: string;
  pointer: string;
  valueDigest: string;
  lineDigest: string;
}): YamlEntryRemoval {
  const parts = splitText(input.text);
  const invalid = validateDocument(parts.lines);
  if (invalid !== null) return { state: 'unmergeable', reason: invalid };
  const lines = [...parts.lines];
  const classified = lines.map(classify);
  const target = locatePath(classified, input.pointer);
  if (target === null) return { state: 'absent' };
  if ('error' in target) return { state: 'unmergeable', reason: target.error };
  const items = sequenceItems(classified, target);
  if ('error' in items) return { state: 'unmergeable', reason: items.error };

  const matching = items.filter(
    (item) => item.value !== null && yamlStringDigest(item.value) === input.valueDigest,
  );
  if (matching.length === 0) return { state: 'absent' };
  if (matching.length > 1) return { state: 'modified' };
  const item = matching[0];
  if (item === undefined || item.lineDigest !== input.lineDigest) return { state: 'modified' };

  lines.splice(item.index, 1);
  return { state: 'removed', text: joinText({ ...parts, lines }) };
}
