/**
 * Claude Code usage by model, split into the main conversation and subagents.
 *
 * Reads the `.claude/projects` transcripts under the home directory, read-only. A record
 * is delegated when its file lives under a `subagents` directory or it is marked
 * `isSidechain`. Streaming writes the same assistant message more than once, so records
 * are deduplicated by message and request id. Only model ids and token counts are kept.
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

function inSubagentsDirectory(path: string, root: string): boolean {
  const relative = path.startsWith(root) ? path.slice(root.length) : path;
  return relative.split(/[\\/]/).slice(0, -1).includes('subagents');
}

export async function readClaudeUsage(input: DelegatedUsageInput): Promise<DelegatedUsageHarness> {
  const startMs = windowStartMs(input);
  const root = input.fs.join(input.home, '.claude', 'projects');
  let listing;
  try {
    listing = await input.fs.listJsonl(root);
  } catch {
    return emptyHarness('claude', 'unavailable');
  }
  if (listing === null) return emptyHarness('claude', 'no-data');

  const rootTotals = new ModelTotals();
  const delegatedTotals = new ModelTotals();
  const seen = new Set<string>();
  let files = 0;
  let errors = 0;

  for (const entry of listing) {
    if (entry.mtimeMs < startMs) continue;
    files += 1;
    const subagentFile = inSubagentsDirectory(entry.path, root);
    try {
      for await (const line of input.fs.readLines(entry.path)) {
        const record = parseLine(line);
        if (record === undefined) continue;
        if (record === null) {
          errors += 1;
          continue;
        }
        const message = record['message'];
        if (!isRecord(message) || !isRecord(message['usage'])) continue;
        const model = message['model'];
        if (typeof model !== 'string' || model === '' || model === '<synthetic>') continue;
        if (beforeWindow(record['timestamp'], startMs)) continue;
        const messageId = message['id'];
        if (typeof messageId === 'string') {
          const requestId = record['requestId'];
          const key = `${messageId}|${typeof requestId === 'string' ? requestId : ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        const usage = message['usage'];
        const target =
          subagentFile || record['isSidechain'] === true ? delegatedTotals : rootTotals;
        target.add(model, {
          input: count(usage['input_tokens']),
          cacheWrite: count(usage['cache_creation_input_tokens']),
          cacheRead: count(usage['cache_read_input_tokens']),
          output: count(usage['output_tokens']),
        });
      }
    } catch {
      errors += 1;
    }
  }
  return finishHarness('claude', files, errors, rootTotals, delegatedTotals);
}
