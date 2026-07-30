/**
 * Merging owned entries into a JSON document — RFC 0004 §Ownership, third bullet.
 *
 * "Exact JSON/TOML/YAML entries recorded in its journal." That clause is the whole
 * design: identity comes from the journal, not from a marker Token Harness injects
 * into another tool's schema. A hook entry gets its identity from the digest of the
 * value that was written, so an entry the user edited stops matching and stops being
 * removable — the same rule the owned-file and owned-marker-block mechanisms use.
 *
 * ## What is preserved
 *
 * RFC 0004: "Shared config merges preserve: unrelated keys; comments where the
 * selected parser supports them; hook order outside the Token Harness-owned entries;
 * user formatting when practical."
 *
 * - **Unrelated keys**: only the addressed pointer is touched.
 * - **Hook order**: an `append` that updates an existing owned element replaces it
 *   *in place*, so the user's entries keep their positions around it.
 * - **User formatting**: the document's indentation, line ending, byte-order mark,
 *   and trailing newline are detected and reapplied. Key order survives because
 *   `JSON.parse` and `JSON.stringify` both preserve insertion order, so existing keys
 *   stay where they were and new ones land at the end.
 * - **Comments**: strict JSON has none, and `JSON.parse` cannot round-trip a JSONC
 *   document. So a document containing comments is *refused* with a named diagnostic
 *   rather than silently stripped — RFC 0004: "When comment-preserving mutation is not
 *   reliable, the planner reports that limitation before apply." PLAN §17.1 keeps the
 *   comment-preserving edit strategy an open decision; destroying a user's comments
 *   while waiting for it is not an acceptable interim.
 *
 * Everything here is pure.
 */

import { digestText } from '../domain/digest.js';
import type { JsonMergeOperation, JsonValue } from '../domain/json.js';
import type { JsonEntryPlacement } from '../domain/ownership.js';

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Pointers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * RFC 0002 calls these "dotted pointers into the document".
 *
 * A literal dot in a key is escaped as `\.` and a literal backslash as `\\`, because
 * `.claude` and `mcpServers.my.server` are both real shapes and a pointer language
 * that cannot express the second is a pointer language that will be worked around.
 */
export function parseJsonPointer(pointer: string): string[] | null {
  if (pointer === '') return null;
  const segments: string[] = [];
  let current = '';
  for (let index = 0; index < pointer.length; index += 1) {
    const char = pointer[index];
    if (char === '\\') {
      const next = pointer[index + 1];
      if (next !== '.' && next !== '\\') return null;
      current += next;
      index += 1;
      continue;
    }
    if (char === '.') {
      if (current === '') return null;
      segments.push(current);
      current = '';
      continue;
    }
    current += char as string;
  }
  if (current === '') return null;
  segments.push(current);
  return segments;
}

function arrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  return Number.parseInt(segment, 10);
}

export interface PointerLookup {
  found: boolean;
  value: JsonValue | undefined;
}

export function resolveJsonPointer(
  document: JsonValue,
  segments: readonly string[],
): PointerLookup {
  let current: JsonValue | undefined = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null || index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/* -------------------------------------------------------------------------- */
/* Value identity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A deterministic serialization, with object keys sorted.
 *
 * Sorted, so identity survives another tool rewriting the file with different key
 * order — which is a formatting change, not a semantic one. A digest that changed
 * when a formatter ran would report drift on every unrelated edit.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`).join(',')}}`;
}

export function jsonValueDigest(value: JsonValue): string {
  return digestText(canonicalJson(value));
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const BOM = '﻿';

export interface JsonFormatting {
  /** Two spaces, four spaces, a tab — whatever the file already uses. */
  indent: string;
  eol: string;
  trailingNewline: boolean;
  byteOrderMark: boolean;
}

export function detectJsonFormatting(text: string): JsonFormatting {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const crlf = /\r\n/.test(body);
  // The indentation of the first indented line, which for a JSON document is the
  // first member of the outermost object.
  const indented = /\n([ \t]+)\S/.exec(body.replace(/\r\n/g, '\n'));
  return {
    indent: indented?.[1] ?? '  ',
    eol: crlf ? '\r\n' : '\n',
    trailingNewline: /\n$/.test(body),
    byteOrderMark: text.startsWith(BOM),
  };
}

export function formatJsonDocument(document: JsonValue, formatting: JsonFormatting): string {
  const serialized = JSON.stringify(document, null, formatting.indent) ?? 'null';
  const withEol = formatting.eol === '\n' ? serialized : serialized.replace(/\n/g, formatting.eol);
  const withTrailing = formatting.trailingNewline ? `${withEol}${formatting.eol}` : withEol;
  return formatting.byteOrderMark ? `${BOM}${withTrailing}` : withTrailing;
}

/* -------------------------------------------------------------------------- */
/* Parsing, and the comment refusal                                            */
/* -------------------------------------------------------------------------- */

/**
 * Whether the text carries a comment outside a string literal.
 *
 * Scanned rather than pattern-matched: a URL in a value contains `//`, and refusing
 * to edit every settings file that mentions `https://` would be its own defect.
 */
export function containsJsonComment(text: string): boolean {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) return true;
  }
  return false;
}

export type JsonDocumentParse =
  | { readonly state: 'parsed'; readonly document: JsonValue; readonly formatting: JsonFormatting }
  | { readonly state: 'comments' }
  | { readonly state: 'malformed'; readonly reason: string };

export function parseJsonDocumentText(text: string): JsonDocumentParse {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  if (containsJsonComment(body)) return { state: 'comments' };
  try {
    return {
      state: 'parsed',
      document: JSON.parse(body) as JsonValue,
      formatting: detectJsonFormatting(text),
    };
  } catch (error) {
    return { state: 'malformed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Merging                                                                     */
/* -------------------------------------------------------------------------- */

export interface JsonOwnedEntry {
  pointer: string;
  placement: JsonEntryPlacement;
  valueDigest: string;
}

export type JsonMergeOutcome =
  | {
      readonly state: 'merged';
      readonly document: JsonValue;
      readonly entries: readonly JsonOwnedEntry[];
    }
  | { readonly state: 'drift'; readonly pointer: string; readonly reason: string }
  | { readonly state: 'unmergeable'; readonly pointer: string; readonly reason: string };

function clone(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value) ?? 'null') as JsonValue;
}

/**
 * Walks to the parent of the last segment, creating intermediate *objects* only.
 *
 * A missing intermediate is created; an intermediate that exists as something other
 * than an object is a refusal rather than a replacement, because overwriting a value
 * the user put there is the thing this whole module is arranged to avoid.
 */
function ensureParent(
  document: JsonValue,
  segments: readonly string[],
): { ok: true; parent: { [key: string]: JsonValue }; key: string } | { ok: false; reason: string } {
  let current = document;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    if (!isJsonObject(current)) {
      return { ok: false, reason: `\`${segments.slice(0, index).join('.')}\` is not an object` };
    }
    const next = current[segment];
    if (next === undefined) {
      current[segment] = {};
      current = current[segment] as JsonValue;
      continue;
    }
    current = next;
  }
  if (!isJsonObject(current)) {
    return { ok: false, reason: `\`${segments.slice(0, -1).join('.')}\` is not an object` };
  }
  return { ok: true, parent: current, key: segments[segments.length - 1] as string };
}

export function mergeJsonEntries(
  original: JsonValue,
  operations: readonly JsonMergeOperation[],
): JsonMergeOutcome {
  const document = clone(original);
  const entries: JsonOwnedEntry[] = [];

  for (const operation of operations) {
    const segments = parseJsonPointer(operation.pointer);
    if (segments === null) {
      return {
        state: 'unmergeable',
        pointer: operation.pointer,
        reason: 'the pointer is not a valid dotted path',
      };
    }
    const digest = jsonValueDigest(operation.value);

    if (operation.kind === 'set') {
      const lookup = resolveJsonPointer(document, segments);
      const liveDigest =
        lookup.found && lookup.value !== undefined ? jsonValueDigest(lookup.value) : null;

      if (operation.expectedValueDigest === null && liveDigest !== null && liveDigest !== digest) {
        return {
          state: 'drift',
          pointer: operation.pointer,
          reason:
            'the plan expected this entry to be absent, but a different value is already there',
        };
      }
      if (operation.expectedValueDigest !== null && liveDigest === null) {
        return {
          state: 'drift',
          pointer: operation.pointer,
          reason: 'the entry this plan updates is no longer in the document',
        };
      }
      if (
        operation.expectedValueDigest !== null &&
        liveDigest !== operation.expectedValueDigest &&
        liveDigest !== digest
      ) {
        return {
          state: 'drift',
          pointer: operation.pointer,
          reason: 'this entry has changed since the plan was computed',
        };
      }

      const parent = ensureParent(document, segments);
      if (!parent.ok) {
        return { state: 'unmergeable', pointer: operation.pointer, reason: parent.reason };
      }
      parent.parent[parent.key] = clone(operation.value);
      entries.push({ pointer: operation.pointer, placement: 'value', valueDigest: digest });
      continue;
    }

    const parent = ensureParent(document, segments);
    if (!parent.ok) {
      return { state: 'unmergeable', pointer: operation.pointer, reason: parent.reason };
    }
    const existing = parent.parent[parent.key];
    if (existing !== undefined && !Array.isArray(existing)) {
      return {
        state: 'unmergeable',
        pointer: operation.pointer,
        reason: 'the pointer does not address an array',
      };
    }
    const array: JsonValue[] = existing === undefined ? [] : existing;
    if (existing === undefined) parent.parent[parent.key] = array;

    const digests = array.map((element) => jsonValueDigest(element));

    if (operation.expectedValueDigest === null) {
      // Nothing of ours is expected to be there. An element already identical to what
      // we would add is a re-run whose receipt was lost, not a conflict.
      if (!digests.includes(digest)) array.push(clone(operation.value));
    } else {
      const at = digests.indexOf(operation.expectedValueDigest);
      if (at === -1) {
        if (digests.includes(digest)) {
          // Already updated to the new value.
          entries.push({
            pointer: operation.pointer,
            placement: 'array-element',
            valueDigest: digest,
          });
          continue;
        }
        return {
          state: 'drift',
          pointer: operation.pointer,
          reason: 'the entry this plan updates is no longer in the array',
        };
      }
      // Replaced in place, so the user's entries keep their positions around ours —
      // RFC 0004: "hook order outside the Token Harness-owned entries" is preserved.
      array[at] = clone(operation.value);
    }
    entries.push({ pointer: operation.pointer, placement: 'array-element', valueDigest: digest });
  }

  return { state: 'merged', document, entries };
}

export type JsonEntryRemoval =
  | { readonly state: 'removed'; readonly document: JsonValue }
  | { readonly state: 'absent' }
  | { readonly state: 'modified' }
  | { readonly state: 'unmergeable'; readonly reason: string };

/**
 * Removes an owned entry, and only while the claim still holds.
 *
 * `modified` is what RFC 0004 §Ownership requires: an entry the user edited is not
 * removed automatically, and the caller turns that into a refusal naming the path.
 */
export function removeJsonEntry(original: JsonValue, entry: JsonOwnedEntry): JsonEntryRemoval {
  const segments = parseJsonPointer(entry.pointer);
  if (segments === null)
    return { state: 'unmergeable', reason: 'the pointer is not a valid dotted path' };

  const document = clone(original);
  const parent = ensureParent(document, segments);
  if (!parent.ok) return { state: 'unmergeable', reason: parent.reason };
  const target = parent.parent[parent.key];

  if (entry.placement === 'value') {
    if (target === undefined) return { state: 'absent' };
    if (jsonValueDigest(target) !== entry.valueDigest) return { state: 'modified' };
    delete parent.parent[parent.key];
    return { state: 'removed', document };
  }

  if (target === undefined) return { state: 'absent' };
  if (!Array.isArray(target))
    return { state: 'unmergeable', reason: 'the pointer does not address an array' };
  const at = target.findIndex((element) => jsonValueDigest(element) === entry.valueDigest);
  if (at === -1) return { state: 'absent' };
  target.splice(at, 1);
  return { state: 'removed', document };
}
