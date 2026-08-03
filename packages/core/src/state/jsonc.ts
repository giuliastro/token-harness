/**
 * JSONC parsing and narrow, comment-preserving edits.
 *
 * OpenCode keeps user configuration in JSONC.  It would be easy to parse it by
 * deleting comments and then stringify the result, but that is a destructive edit:
 * comments and trailing commas are part of the user's file.  This module keeps the
 * original text as the source of truth and only inserts an array element at a
 * verified location.  It intentionally refuses edits it cannot locate exactly.
 */

import type { JsonValue } from '../domain/json.js';

export type JsoncDocumentParse =
  | { readonly state: 'parsed'; readonly document: JsonValue }
  | { readonly state: 'malformed'; readonly reason: string };

/** Replaces comments with spaces, preserving offsets and newlines for diagnostics. */
function withoutComments(text: string): string {
  let result = '';
  let string = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (string) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      result += char;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      if (index < text.length) result += '\n';
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      result += '  ';
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        result += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < text.length) {
        result += '  ';
        index += 1;
      }
      continue;
    }
    result += char;
  }
  return result;
}

/**
 * Removes trailing commas, without touching the inside of a string.
 *
 * The obvious version is `text.replace(/,(\s*[}\]])/g, '$1')`, and it is wrong: a regex over the
 * whole document cannot see string boundaries, so `{"note": "wait for it, }"}` loses the comma
 * *inside* the value and parses as `"wait for it }"`. Silent, and in a module whose entire purpose
 * is not to alter a user's file — the parsed value is what `inspect` reports as a configured
 * command, so a corrupted string becomes a misreported one.
 *
 * Comments are already blanked by `withoutComments` before this runs, so only strings need
 * skipping here.
 */
function withoutTrailingCommas(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;

    if (char === '"') {
      // Copy the string verbatim, escapes included. An unterminated string is copied to the end
      // and left for `JSON.parse` to reject, which is the honest outcome for a malformed document.
      let cursor = index + 1;
      let escaped = false;
      while (cursor < text.length) {
        const inner = text[cursor] as string;
        if (escaped) escaped = false;
        else if (inner === '\\') escaped = true;
        else if (inner === '"') break;
        cursor += 1;
      }
      result += text.slice(index, Math.min(cursor + 1, text.length));
      index = cursor + 1;
      continue;
    }

    if (char === ',') {
      // Look past whitespace for a closing bracket. Whitespace only: comments are already spaces.
      let cursor = index + 1;
      while (cursor < text.length && /\s/.test(text[cursor] as string)) cursor += 1;
      const next = text[cursor];
      if (next === '}' || next === ']') {
        // Drop the comma and keep the whitespace, so offsets and line numbers stay usable.
        result += text.slice(index + 1, cursor);
        index = cursor;
        continue;
      }
    }

    result += char;
    index += 1;
  }
  return result;
}

export function parseJsoncDocumentText(text: string): JsoncDocumentParse {
  try {
    return {
      state: 'parsed',
      document: JSON.parse(withoutTrailingCommas(withoutComments(text))) as JsonValue,
    };
  } catch (error) {
    return { state: 'malformed', reason: error instanceof Error ? error.message : String(error) };
  }
}

function skipTrivia(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (/\s/.test(text[index] as string)) {
      index += 1;
      continue;
    }
    if (text[index] === '/' && text[index + 1] === '/') {
      index = text.indexOf('\n', index + 2);
      if (index === -1) return text.length;
      continue;
    }
    if (text[index] === '/' && text[index + 1] === '*') {
      index = text.indexOf('*/', index + 2);
      if (index === -1) return text.length;
      index += 2;
      continue;
    }
    break;
  }
  return index;
}

function stringEnd(text: string, start: number): number | null {
  if (text[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (text[index] === '\\') {
      escaped = true;
      continue;
    }
    if (text[index] === '"') return index + 1;
  }
  return null;
}

function closingBracket(text: string, open: number): number | null {
  const closer = text[open] === '[' ? ']' : text[open] === '{' ? '}' : null;
  if (closer === null) return null;
  const stack = [closer];
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '"') {
      const end = stringEnd(text, index);
      if (end === null) return null;
      index = end - 1;
      continue;
    }
    if (text[index] === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
      const next = skipTrivia(text, index);
      if (next === index) return null;
      index = next - 1;
      continue;
    }
    if (text[index] === '[') stack.push(']');
    else if (text[index] === '{') stack.push('}');
    else if (text[index] === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return null;
}

/**
 * Appends a value to a root-level JSONC array without reformatting anything else.
 * The restriction is deliberate: refusing a nested or ambiguous expression is safer
 * than approximating a CST editor and losing a comment.
 */
export function appendJsoncRootArray(
  text: string,
  key: string,
  value: JsonValue,
):
  | { readonly state: 'edited'; readonly text: string }
  | { readonly state: 'uneditable'; readonly reason: string } {
  const root = skipTrivia(text, 0);
  if (text[root] !== '{') return { state: 'uneditable', reason: 'the JSONC root is not an object' };
  let index = root + 1;
  while (true) {
    index = skipTrivia(text, index);
    if (text[index] === '}') break;
    const endKey = stringEnd(text, index);
    if (endKey === null)
      return { state: 'uneditable', reason: 'a root property name is not a string' };
    let property: string;
    try {
      property = JSON.parse(text.slice(index, endKey)) as string;
    } catch {
      return { state: 'uneditable', reason: 'a root property name is invalid' };
    }
    index = skipTrivia(text, endKey);
    if (text[index] !== ':') return { state: 'uneditable', reason: 'a root property has no colon' };
    index = skipTrivia(text, index + 1);
    const valueStart = index;
    const valueEnd =
      text[index] === '[' || text[index] === '{'
        ? closingBracket(text, index)
        : text[index] === '"'
          ? stringEnd(text, index) === null
            ? null
            : (stringEnd(text, index) as number) - 1
          : (() => {
              const comma = text.indexOf(',', index);
              const close = text.indexOf('}', index);
              const end = comma === -1 ? close : close === -1 ? comma : Math.min(comma, close);
              return end === -1 ? null : end - 1;
            })();
    if (valueEnd === null)
      return { state: 'uneditable', reason: 'a root property value could not be bounded safely' };
    if (property === key) {
      if (text[valueStart] !== '[')
        return {
          state: 'uneditable',
          reason: `the ${JSON.stringify(key)} property is not an array`,
        };
      return {
        state: 'edited',
        text: `${text.slice(0, valueEnd)}${arrayElementInsertion(text, valueStart, valueEnd, value)}${text.slice(valueEnd)}`,
      };
    }
    index = skipTrivia(text, valueEnd + 1);
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    if (text[index] === '}') break;
    return { state: 'uneditable', reason: 'root properties are not separated safely' };
  }
  return { state: 'uneditable', reason: `the ${JSON.stringify(key)} array does not exist` };
}

/**
 * The bytes to place before a closing bracket to add `value` to the array whose body runs from
 * `valueStart + 1` (the `[`) to `valueEnd` (the `]`). Everything the caller keeps around this
 * fragment — the other elements, their comments, the closing bracket itself — is untouched.
 */
function arrayElementInsertion(
  text: string,
  valueStart: number,
  valueEnd: number,
  value: JsonValue,
): string {
  const inside = text.slice(valueStart + 1, valueEnd);
  const hasValue = withoutComments(inside).trim().replace(/,$/, '').trim().length > 0;
  const indent = /\n([ \t]+)\S/.exec(inside)?.[1] ?? '  ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingComma = /,\s*$/.test(withoutComments(inside));
  return hasValue
    ? `${hasTrailingComma ? '' : ','}${eol}${indent}${JSON.stringify(value, null, indent).replace(/\n/g, eol + indent)}`
    : `${eol}${indent}${JSON.stringify(value, null, indent)}${eol}`;
}

/** The member spans a `{ ... }` body holds, none of the surrounding trivia. */
interface JsoncMember {
  readonly key: string;
  /** First byte of the value. */
  readonly valueStart: number;
  /** One past the last byte of the value; trailing comments and commas are outside. */
  readonly valueEnd: number;
  /** Whether a `,` follows the value (after any comment), so an insertion can keep JSON valid. */
  readonly trailingComma: boolean;
}

function memberList(text: string, open: number, close: number): JsoncMember[] | null {
  const members: JsoncMember[] = [];
  let index = skipTrivia(text, open + 1);
  while (true) {
    index = skipTrivia(text, index);
    if (index >= close || text[index] === '}') break;
    const keyEnd = stringEnd(text, index);
    if (keyEnd === null) return null;
    let key: string;
    try {
      key = JSON.parse(text.slice(index, keyEnd)) as string;
    } catch {
      return null;
    }
    index = skipTrivia(text, keyEnd);
    if (text[index] !== ':') return null;
    index = skipTrivia(text, index + 1);
    const valueStart = index;
    const valueEnd = valueEndExclusive(text, valueStart);
    if (valueEnd === null) return null;
    index = skipTrivia(text, valueEnd);
    let trailingComma = false;
    if (text[index] === ',') {
      trailingComma = true;
      index += 1;
    } else if (text[index] !== '}') {
      return null;
    }
    members.push({ key, valueStart, valueEnd, trailingComma });
  }
  return members;
}

/** The byte just past a value, or null when the value cannot be bounded safely. */
function valueEndExclusive(text: string, start: number): number | null {
  const char = text[start];
  if (char === '"') return stringEnd(text, start);
  if (char === '[' || char === '{') {
    const end = closingBracket(text, start);
    return end === null ? null : end + 1;
  }
  // A scalar ends at the first byte that can only be a separator or terminator.
  let index = start;
  while (index < text.length && !/[\s,}\]]/.test(text[index] ?? '')) index += 1;
  return index === start ? null : index;
}

/** The indentation the members of this document region are written with. */
function indentOf(text: string, open: number, close: number): string {
  return /\n([ \t]+)\S/.exec(text.slice(open + 1, close))?.[1] ?? '  ';
}

type MemberLookup =
  | { readonly state: 'found'; readonly valueStart: number; readonly valueEnd: number }
  | { readonly state: 'absent' }
  | { readonly state: 'ambiguous' }
  | { readonly state: 'unreadable' };

function locateMember(text: string, open: number, close: number, key: string): MemberLookup {
  const members = memberList(text, open, close);
  if (members === null) return { state: 'unreadable' };
  const matches = members.filter((member) => member.key === key);
  if (matches.length > 1) return { state: 'ambiguous' };
  const member = matches[0];
  if (member === undefined) return { state: 'absent' };
  return { state: 'found', valueStart: member.valueStart, valueEnd: member.valueEnd };
}

/**
 * The object an expression resolves to, walking `segments` from the root.
 *
 * An expression is a dotted path such as `experimental.plugins`; an empty expression is the root
 * object itself. This half refuses anything it cannot prove: a member that is absent, a value that
 * is not an object, an edge this build cannot bound — each names the expression and the member.
 */
type ObjectResolution =
  | { readonly state: 'resolved'; readonly open: number; readonly close: number }
  | { readonly state: 'unresolvable'; readonly reason: string };

function resolveObject(
  text: string,
  segments: readonly string[],
  expression: string,
): ObjectResolution {
  const root = skipTrivia(text, 0);
  if (text[root] !== '{')
    return {
      state: 'unresolvable',
      reason: `could not resolve ${JSON.stringify(expression)}: the JSONC root is not an object`,
    };
  let open = root;
  let close = closingBracket(text, root);
  if (close === null)
    return {
      state: 'unresolvable',
      reason: `could not resolve ${JSON.stringify(expression)}: the JSONC root is not bounded safely`,
    };
  for (const segment of segments) {
    const member = locateMember(text, open, close, segment);
    if (member.state === 'unreadable')
      return {
        state: 'unresolvable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(segment)} member could not be bounded safely`,
      };
    if (member.state === 'absent')
      return {
        state: 'unresolvable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(segment)} member does not exist`,
      };
    if (member.state === 'ambiguous')
      return {
        state: 'unresolvable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(segment)} member appears more than once, so which one is meant is ambiguous`,
      };
    if (text[member.valueStart] !== '{')
      return {
        state: 'unresolvable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(segment)} value is not an object`,
      };
    open = member.valueStart;
    close = closingBracket(text, open);
    if (close === null)
      return {
        state: 'unresolvable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(segment)} value is not bounded safely`,
      };
  }
  return { state: 'resolved', open, close };
}

/**
 * The single mutation this module performs beyond `appendJsoncRootArray` — RFC 0009 §Initial
 * delivery order item 2.
 *
 * Two operations, both with the same refusal contract:
 *
 * - `append-element` adds `value` to the array the expression resolves to, e.g.
 *   `editJsonc(text, 'experimental.plugins', { kind: 'append-element', value })`.
 * - `set-member` sets or inserts an object member inside the object the expression resolves to,
 *   e.g. `editJsonc(text, 'experimental', { kind: 'set-member', member: 'plugins', value })`.
 *
 * The edited bytes cover only the located region — the rest of the document is carried through
 * byte for byte, comments and trailing commas included. `replaced` names that region so a caller
 * can show a reviewer exactly what changed. When the expression cannot be resolved exactly the
 * edit is refused, and the refusal names the expression and the member it could not resolve: an
 * editor that approximates is how a user's comments disappear.
 */
export type JsoncEditOperation =
  | { readonly kind: 'append-element'; readonly value: JsonValue }
  | { readonly kind: 'set-member'; readonly member: string; readonly value: JsonValue };

export interface JsoncEditedSpan {
  /** Byte offset in the input where the replacement begins. */
  readonly from: number;
  /** One past the last byte replaced in the input; equal to `from` for a pure insertion. */
  readonly to: number;
  /** The bytes written in place of `input.slice(from, to)`. */
  readonly with: string;
}

export type JsoncEditOutcome =
  | { readonly state: 'edited'; readonly text: string; readonly replaced: JsoncEditedSpan }
  | { readonly state: 'uneditable'; readonly reason: string };

export function editJsonc(
  text: string,
  expression: string,
  operation: JsoncEditOperation,
): JsoncEditOutcome {
  const segments = expression === '' ? [] : expression.split('.');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  if (operation.kind === 'append-element') {
    const containerPath = segments.slice(0, -1);
    const memberKey = segments.at(-1) ?? '';
    const container = resolveObject(text, containerPath, expression);
    if (container.state !== 'resolved') return { state: 'uneditable', reason: container.reason };
    const target = locateMember(text, container.open, container.close, memberKey);
    if (target.state === 'unreadable')
      return {
        state: 'uneditable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(memberKey)} member could not be bounded safely`,
      };
    if (target.state === 'absent')
      return {
        state: 'uneditable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(memberKey)} member does not exist`,
      };
    if (target.state === 'ambiguous')
      return {
        state: 'uneditable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(memberKey)} member appears more than once, so which one is meant is ambiguous`,
      };
    if (text[target.valueStart] !== '[')
      return {
        state: 'uneditable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(memberKey)} value is not an array`,
      };
    const arrayEnd = closingBracket(text, target.valueStart);
    if (arrayEnd === null)
      return {
        state: 'uneditable',
        reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(memberKey)} array is not bounded safely`,
      };
    const withInsertion = arrayElementInsertion(text, target.valueStart, arrayEnd, operation.value);
    return {
      state: 'edited',
      text: `${text.slice(0, arrayEnd)}${withInsertion}${text.slice(arrayEnd)}`,
      replaced: { from: arrayEnd, to: arrayEnd, with: withInsertion },
    };
  }

  const container = resolveObject(text, segments, expression);
  if (container.state !== 'resolved') return { state: 'uneditable', reason: container.reason };
  const indent = indentOf(text, container.open, container.close);
  const serialized = JSON.stringify(operation.value, null, indent).replace(/\n/g, eol + indent);

  const member = locateMember(text, container.open, container.close, operation.member);
  if (member.state === 'unreadable')
    return {
      state: 'uneditable',
      reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(operation.member)} member could not be bounded safely`,
    };
  if (member.state === 'ambiguous')
    return {
      state: 'uneditable',
      reason: `could not resolve ${JSON.stringify(expression)}: the ${JSON.stringify(operation.member)} member appears more than once, so which one is meant is ambiguous`,
    };
  if (member.state === 'found') {
    return {
      state: 'edited',
      text: `${text.slice(0, member.valueStart)}${serialized}${text.slice(member.valueEnd)}`,
      replaced: { from: member.valueStart, to: member.valueEnd, with: serialized },
    };
  }

  const members = memberList(text, container.open, container.close) ?? [];
  const hasMembers = members.length > 0;
  const inserted = `${JSON.stringify(operation.member)}: ${serialized}`;
  const insertion = hasMembers
    ? `${members.at(-1)?.trailingComma === true ? '' : ','}${eol}${indent}${inserted}`
    : `${eol}${indent}${inserted}${eol}`;
  return {
    state: 'edited',
    text: `${text.slice(0, container.close)}${insertion}${text.slice(container.close)}`,
    replaced: { from: container.close, to: container.close, with: insertion },
  };
}
