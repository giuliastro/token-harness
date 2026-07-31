/**
 * `token-harness metrics` — RFC 0006 §Golden path, scenario "metrics after a week of RTK on
 * Claude and HarnessTrim adopted on OpenCode".
 *
 * The command does three things in order, and the order is the interesting part:
 *
 * 1. **import** — every provider adapter reads its own records into the store;
 * 2. **query** — the store is asked for the window, and nothing else knows the backend;
 * 3. **aggregate** — events become a report, with the measurement classes kept apart.
 *
 * Importing before reporting is what makes the numbers current. The alternative — report what
 * a previous run happened to have imported — would make `metrics` silently stale, and the
 * staleness would be invisible because the report would look exactly the same.
 *
 * Importing is a write, and RFC 0004 §Command behavior makes `doctor` and `status` read-only.
 * `metrics` is not among them: it writes to Token Harness's own state directory and to
 * nothing else. It never touches a harness configuration, a project, or a provider's records
 * — the database reader opens read-only, so measuring cannot alter what it measures.
 */

import {
  EXIT_CODES,
  aggregateEvents,
  commandResult,
  diagnostic,
  resolveMetricsWindow,
  type CommandResult,
  type Diagnostic,
  type MetricsReport,
  type OptimizationEvent,
} from '@token-harness/core';
import { listProviderAdapters, type ProviderContext } from '@token-harness/adapters';

import type { CommandContext } from './context.js';

export async function runMetrics(
  context: CommandContext,
): Promise<CommandResult<MetricsReport | null>> {
  const diagnostics: Diagnostic[] = [];

  const resolved = resolveMetricsWindow({
    since: context.since,
    until: context.until,
    now: context.now(),
  });
  if (!resolved.ok) {
    // RFC 0006 §Exit codes 2: a bad flag value is a usage error, not a failed report.
    return commandResult({
      command: 'metrics',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'invalid-argument',
          message:
            resolved.failure === 'start-after-end'
              ? `The window is empty: ${resolved.detail}`
              : `${JSON.stringify(resolved.detail)} is not a duration such as \`7d\` or a date such as \`2026-07-22\``,
          remediation: 'Pass `--since 7d`, or `--since 2026-07-22 --until 2026-07-29`',
        }),
      ],
    });
  }
  const { window } = resolved;

  // No store means nothing to report from. This is what a test asserting the CLI contract
  // without a state directory looks like; a machine with an unresolvable state root never
  // reaches here, because `run` exits 9 first.
  if (context.metrics === null) {
    return commandResult({
      command: 'metrics',
      exitCode: EXIT_CODES.ok,
      data: aggregateEvents({ events: [], ...window }),
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'metrics-store-unavailable',
          message: 'No metrics store was available, so this report covers no events',
          remediation: null,
        }),
      ],
    });
  }

  const store = context.metrics;
  const adapterModes: Record<string, string | null> = {};

  // Importing needs the machine; reporting needs only the store. Keeping the two conditions
  // apart matters — collapsing them made a host with a store but no adapters report an empty
  // window while sitting on a full one.
  if (context.adapters === null) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'metrics-not-imported',
        message:
          'No provider adapters were available, so this report covers what was already stored',
        remediation: null,
      }),
    );
  } else {
    const providerContext: ProviderContext = {
      fs: context.adapters.fs,
      runner: context.adapters.runner,
      facts: context.platform,
      paths: context.adapters.paths,
      projectRoot: context.projectRoot,
      // Deliberately empty. The harness↔provider seam matters to `detect` and `verify`, which
      // ask which harnesses a provider is wired to; an importer reads the provider's own
      // records and does not need to know.
      harnessConfigs: [],
      now: context.now,
      localDatabase: context.adapters.localDatabase,
      projectIdFor: context.adapters.projectIdFor,
    };

    const adapters = listProviderAdapters().filter(
      (adapter) => context.provider === null || adapter.manifest.id === context.provider,
    );

    for (const adapter of adapters) {
      // Sequential rather than concurrent: two importers writing the same partition file is
      // exactly the coarse concurrency RFC 0005 tolerates rather than embraces, and there is
      // nothing to gain here — an import is one child process and a few appends.
      const imported = await adapter.collectMetrics(providerContext, store);
      adapterModes[adapter.manifest.id] = imported.mode;
      diagnostics.push(...imported.diagnostics);

      if (imported.imported > 0) {
        diagnostics.push(
          diagnostic({
            severity: 'info',
            code: 'metrics-imported',
            message: `Imported ${String(imported.imported)} new ${adapter.manifest.displayName} operations from ${imported.source ?? 'its records'}`,
            remediation: null,
          }),
        );
      }
    }
  }

  const events: OptimizationEvent[] = [];
  for await (const event of store.query({
    since: window.sinceInstant,
    until: window.untilInstant,
    ...(context.provider === null ? {} : { providerIds: [context.provider] }),
  })) {
    events.push(event);
  }

  const report = aggregateEvents({
    events,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    // RFC 0004 §Brownfield adoption: nothing has been applied by Token Harness yet, so every
    // installation it can measure is the user's own. When `apply` exists this comes from the
    // receipts, and until then claiming otherwise would be the one thing worse than saying
    // "adopted, not managed" about something we did install.
    managedProviders: [],
    adapterModes,
  });

  // Exit 0 whatever the figures say. RFC 0006 §Exit codes reserves 3 for a verification below
  // its declared tier; a report with nothing in it is a fact about the machine, not a
  // failure of the command.
  return commandResult({
    command: 'metrics',
    exitCode: EXIT_CODES.ok,
    data: report,
    diagnostics,
  });
}
