/**
 * Codex usage by model, split into root sessions and subagent sessions.
 *
 * Reads the `sessions` transcripts under `CODEX_HOME` (or `.codex` in the home directory),
 * read-only. A session is delegated when its `session_meta` names a parent thread or a
 * subagent source. Each `token_count` event adds that turn's usage to the model named by
 * the latest `turn_context`. Only model ids and token counts are kept.
 */

import type { DelegatedUsageHarness } from '@token-harness/core';

import {
  ModelTotals,
  beforeWindow,
  count,
  emptyHarness,
  finishHarness,
  isRecord,
  parseLine,
  windowStartMs,
  type DelegatedUsageInput,
} from './usage-aggregate.js';

const UNKNOWN_MODEL = 'unknown';

function isDelegatedSession(payload: Record<string, unknown>): boolean {
  const parent = payload['parent_thread_id'];
  if (parent !== undefined && parent !== null && parent !== '') return true;
  const source = payload['source'];
  return isRecord(source) && Object.hasOwn(source, 'subagent');
}

export async function readCodexUsage(input: DelegatedUsageInput): Promise<DelegatedUsageHarness> {
  const startMs = windowStartMs(input);
  const configured = input.env['CODEX_HOME'];
  const codexHome =
    configured !== undefined && configured !== ''
      ? configured
      : input.fs.join(input.home, '.codex');
  const root = input.fs.join(codexHome, 'sessions');
  let listing;
  try {
    listing = await input.fs.listJsonl(root);
  } catch {
    return emptyHarness('codex', 'unavailable');
  }
  if (listing === null) return emptyHarness('codex', 'no-data');

  const rootTotals = new ModelTotals();
  const delegatedTotals = new ModelTotals();
  let files = 0;
  let errors = 0;

  for (const entry of listing) {
    if (entry.mtimeMs < startMs) continue;
    files += 1;
    const sessionTotals = new ModelTotals();
    let delegated = false;
    let model = UNKNOWN_MODEL;
    try {
      for await (const line of input.fs.readLines(entry.path)) {
        const record = parseLine(line);
        if (record === undefined) continue;
        if (record === null) {
          errors += 1;
          continue;
        }
        const payload = record['payload'];
        if (!isRecord(payload)) continue;
        switch (record['type']) {
          case 'session_meta':
            if (isDelegatedSession(payload)) delegated = true;
            break;
          case 'turn_context': {
            const next = payload['model'];
            if (typeof next === 'string' && next !== '') model = next;
            break;
          }
          case 'event_msg': {
            if (payload['type'] !== 'token_count') break;
            const info = payload['info'];
            if (!isRecord(info) || !isRecord(info['last_token_usage'])) break;
            if (beforeWindow(record['timestamp'], startMs)) break;
            const usage = info['last_token_usage'];
            const cached = count(usage['cached_input_tokens']);
            sessionTotals.add(model, {
              input: Math.max(0, count(usage['input_tokens']) - cached),
              cacheWrite: count(usage['cache_write_input_tokens']),
              cacheRead: cached,
              output: count(usage['output_tokens']),
            });
            break;
          }
          default:
            break;
        }
      }
    } catch {
      errors += 1;
    }
    (delegated ? delegatedTotals : rootTotals).merge(sessionTotals);
  }
  return finishHarness('codex', files, errors, rootTotals, delegatedTotals);
}
