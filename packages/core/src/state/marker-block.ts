/**
 * Marker-fenced blocks — RFC 0004 §Ownership, second bullet.
 *
 * A marker block is how Token Harness owns part of a file it does not own. The
 * fence is a comment in the host file's syntax, the body between the fences is
 * ours, and everything outside it belongs to the user and must come back
 * byte-for-byte. HarnessTrim's own `AGENTS.md` block works the same way
 * (`harnesstrim:begin` / `harnesstrim:end`, PLAN §11), which is what makes the
 * mechanism reviewable rather than novel.
 *
 * ## Insert and remove are exact inverses
 *
 * That is the property this module is built around, and it is asserted as a
 * property test over a table of awkward files: LF and CRLF, a byte-order mark, a
 * file with no trailing newline, an empty file, a file that is nothing but a block.
 * `upsert` followed by `remove` returns the original bytes.
 *
 * It costs one design decision. A file's trailing-newline property lives on its
 * last line, so appending a block would otherwise silently add a newline that
 * `remove` could not know to take away again. Instead the end fence *inherits* the
 * file's original line ending — no trailing newline in, no trailing newline out —
 * and `remove` hands the property back to whatever line becomes last. For the same
 * reason `upsert` always writes a blank separator line before the fence: a rule
 * that sometimes writes one cannot be inverted by a rule that always removes one.
 *
 * Everything here is pure text manipulation.
 */

import { digestText } from '../domain/digest.js';

export interface MarkerFence {
  /** A token, not a whole line: `token-harness:begin`. */
  begin: string;
  end: string;
}

export interface MarkerCommentSyntax {
  /** `#`, `//`, `<!--`. */
  prefix: string;
  /** `-->`, or the empty string for a syntax with no closing delimiter. */
  suffix: string;
}

export interface MarkerBlock {
  /** Zero-based index of the line holding the begin token. */
  beginLine: number;
  endLine: number;
  /** The lines between the fences, joined with their own line endings. */
  body: string;
  /** Digest of {@link body}, for the ownership record. */
  bodyDigest: string;
}

export type MarkerBlockLookup =
  | { readonly state: 'absent' }
  | { readonly state: 'found'; readonly block: MarkerBlock }
  | { readonly state: 'malformed'; readonly reason: string };

interface Line {
  text: string;
  /** `\n`, `\r\n`, or the empty string for a final line with no terminator. */
  eol: string;
}

const BOM = '﻿';

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue;
    const hasCarriageReturn = index > 0 && text[index - 1] === '\r';
    const end = hasCarriageReturn ? index - 1 : index;
    lines.push({ text: text.slice(start, end), eol: hasCarriageReturn ? '\r\n' : '\n' });
    start = index + 1;
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' });
  return lines;
}

function joinLines(lines: readonly Line[]): string {
  return lines.map((line) => `${line.text}${line.eol}`).join('');
}

/**
 * The line ending the file already uses.
 *
 * CRLF wins on a tie rather than losing it: a file with mixed endings on Windows is
 * usually a CRLF file that something appended to badly, and adding LF lines to it
 * makes the mixture worse.
 */
function dominantEol(lines: readonly Line[]): string {
  let crlf = 0;
  let lf = 0;
  for (const line of lines) {
    if (line.eol === '\r\n') crlf += 1;
    else if (line.eol === '\n') lf += 1;
  }
  if (crlf === 0 && lf === 0) return '\n';
  return crlf >= lf ? '\r\n' : '\n';
}

function fenceLine(token: string, syntax: MarkerCommentSyntax): string {
  const suffix = syntax.suffix === '' ? '' : ` ${syntax.suffix}`;
  return `${syntax.prefix} ${token}${suffix}`;
}

/**
 * A fence is a line *containing* the token, bounded by non-word characters.
 *
 * Containment rather than equality, so the fence survives any comment syntax and any
 * trailing note the user adds — `<!-- token-harness:begin -->`,
 * `; token-harness:begin (do not edit)`. Bounded, because plain containment matches
 * `token-harness:beginner` in a user's prose and turns their sentence into an
 * unterminated block. The boundary excludes only word characters, so `-->` pressed
 * directly against the token still matches.
 */
function fencePattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
}

function indexOfToken(lines: readonly Line[], token: string, from = 0): number {
  const pattern = fencePattern(token);
  for (let index = from; index < lines.length; index += 1) {
    const text = lines[index]?.text;
    if (text !== undefined && pattern.test(text)) return index;
  }
  return -1;
}

function locate(lines: readonly Line[], fence: MarkerFence): MarkerBlockLookup {
  const beginLine = indexOfToken(lines, fence.begin);
  const strayEnd = indexOfToken(lines, fence.end);

  if (beginLine === -1) {
    if (strayEnd !== -1) {
      return {
        state: 'malformed',
        reason: `the file contains ${JSON.stringify(fence.end)} with no matching ${JSON.stringify(fence.begin)}`,
      };
    }
    return { state: 'absent' };
  }

  if (indexOfToken(lines, fence.begin, beginLine + 1) !== -1) {
    return {
      state: 'malformed',
      reason: `the file contains more than one ${JSON.stringify(fence.begin)} line`,
    };
  }

  const endLine = indexOfToken(lines, fence.end, beginLine + 1);
  if (endLine === -1) {
    return {
      state: 'malformed',
      reason: `the block opened by ${JSON.stringify(fence.begin)} is never closed by ${JSON.stringify(fence.end)}`,
    };
  }

  const body = joinLines(lines.slice(beginLine + 1, endLine));
  return { state: 'found', block: { beginLine, endLine, body, bodyDigest: digestText(body) } };
}

export function findMarkerBlock(text: string, fence: MarkerFence): MarkerBlockLookup {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return locate(splitLines(withoutBom), fence);
}

export interface UpsertMarkerBlockInput {
  text: string;
  fence: MarkerFence;
  syntax: MarkerCommentSyntax;
  /**
   * The body to write. Its line endings are normalized to the file's own, and a
   * final one is added so the end fence starts on its own line.
   */
  body: string;
}

export type UpsertResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly bodyDigest: string;
      /** False when the block was already exactly this, so nothing was written. */
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export function upsertMarkerBlock(input: UpsertMarkerBlockInput): UpsertResult {
  const hasBom = input.text.startsWith(BOM);
  const source = hasBom ? input.text.slice(BOM.length) : input.text;
  const lines = splitLines(source);
  const lookup = locate(lines, input.fence);
  if (lookup.state === 'malformed') return { ok: false, reason: lookup.reason };

  const eol = dominantEol(lines);
  const bodyLines =
    input.body === ''
      ? []
      : splitLines(input.body).map((line) => ({
          text: line.text,
          eol: eol,
        }));
  const bodyText = joinLines(bodyLines);

  if (lookup.state === 'found') {
    if (lookup.block.body === bodyText) {
      return { ok: true, text: input.text, bodyDigest: lookup.block.bodyDigest, changed: false };
    }
    // Only the body is replaced. The fence lines stay exactly as they are, because
    // the user may have adjusted the comment syntax to suit their file and rewriting
    // it would be a change nobody asked for.
    const next = [
      ...lines.slice(0, lookup.block.beginLine + 1),
      ...bodyLines,
      ...lines.slice(lookup.block.endLine),
    ];
    return {
      ok: true,
      text: `${hasBom ? BOM : ''}${joinLines(next)}`,
      bodyDigest: digestText(bodyText),
      changed: true,
    };
  }

  const next = lines.map((line) => ({ ...line }));
  // The file's trailing-newline property moves onto the end fence, which is what
  // makes `removeMarkerBlock` an exact inverse.
  const trailing = next.length === 0 ? eol : (next[next.length - 1]?.eol ?? eol);
  const last = next[next.length - 1];
  if (last !== undefined && last.eol === '') last.eol = eol;
  if (next.length > 0) next.push({ text: '', eol });
  next.push({ text: fenceLine(input.fence.begin, input.syntax), eol });
  next.push(...bodyLines);
  next.push({ text: fenceLine(input.fence.end, input.syntax), eol: trailing });

  return {
    ok: true,
    text: `${hasBom ? BOM : ''}${joinLines(next)}`,
    bodyDigest: digestText(bodyText),
    changed: true,
  };
}

export type RemoveResult =
  | { readonly ok: true; readonly text: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

export function removeMarkerBlock(text: string, fence: MarkerFence): RemoveResult {
  const hasBom = text.startsWith(BOM);
  const source = hasBom ? text.slice(BOM.length) : text;
  const lines = splitLines(source).map((line) => ({ ...line }));
  const lookup = locate(lines, fence);
  if (lookup.state === 'malformed') return { ok: false, reason: lookup.reason };
  if (lookup.state === 'absent') return { ok: true, text, changed: false };

  const { beginLine, endLine } = lookup.block;
  const wasAtEnd = endLine === lines.length - 1;
  const endEol = lines[endLine]?.eol ?? '';
  lines.splice(beginLine, endLine - beginLine + 1);

  if (wasAtEnd) {
    // The separator `upsert` always writes, and the trailing-newline property it
    // parked on the end fence.
    if (lines[lines.length - 1]?.text === '') lines.pop();
    const last = lines[lines.length - 1];
    if (last !== undefined) last.eol = endEol;
  }

  return { ok: true, text: `${hasBom ? BOM : ''}${joinLines(lines)}`, changed: true };
}
