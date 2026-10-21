/**
 * Read-only "delegated usage" observation: tokens per model for each coding agent over a
 * trailing window, split into the main conversation and subagents.
 */

import { readClaudeUsage, readCodexUsage } from '@token-harness/adapters';
import type { DelegatedUsageReport, UsageLogPort } from '@token-harness/core';
import { NodeUsageLog } from '@token-harness/platform';

export interface ObserveDelegatedUsageInput {
  /** The user's home directory, from the host environment resolved at the entry point. */
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  now?: Date;
  /** Trailing window in days. Defaults to 30. */
  days?: number;
  fs?: UsageLogPort;
}

export async function observeDelegatedUsage(
  options: ObserveDelegatedUsageInput,
): Promise<DelegatedUsageReport> {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  const input = {
    home: options.home,
    env: options.env,
    now,
    days,
    fs: options.fs ?? new NodeUsageLog(),
  };
  const [claude, codex] = await Promise.all([readClaudeUsage(input), readCodexUsage(input)]);
  return {
    windowStart: new Date(now.getTime() - days * 86_400_000).toISOString(),
    windowEnd: now.toISOString(),
    days,
    harnesses: [claude, codex],
  };
}
