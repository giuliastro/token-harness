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
      const inside = text.slice(valueStart + 1, valueEnd);
      const hasValue = withoutComments(inside).trim().replace(/,$/, '').trim().length > 0;
      const indent = /\n([ \t]+)\S/.exec(inside)?.[1] ?? '  ';
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const hasTrailingComma = /,\s*$/.test(withoutComments(inside));
      const insertion = hasValue
        ? `${hasTrailingComma ? '' : ','}${eol}${indent}${JSON.stringify(value, null, indent).replace(/\n/g, eol + indent)}`
        : `${eol}${indent}${JSON.stringify(value, null, indent)}${eol}`;
      return {
        state: 'edited',
        text: `${text.slice(0, valueEnd)}${insertion}${text.slice(valueEnd)}`,
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
