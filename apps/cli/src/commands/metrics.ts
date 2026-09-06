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
  TOKEN_HARNESS_OWNER,
  UNATTRIBUTED_PROJECT_ID,
  aggregateEvents,
  measurementUnit,
  commandResult,
  diagnostic,
  resolveMetricsWindow,
  type CommandResult,
  type Diagnostic,
  type MetricsChannelExpectation,
  type MetricsReport,
  type OptimizationEvent,
  type ProviderId,
} from '@token-harness/core';
import { listProviderAdapters, type ProviderContext } from '@token-harness/adapters';

import type { CommandContext } from './context.js';
import { runStatus } from './status.js';

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

  /**
   * The project this report is about — RFC 0006 §Flags: `--project` names "the project whose
   * records you expect".
   *
   * Scoped at the query rather than in the aggregation, because the store already filters on
   * `projectId` and the filter was simply never passed. Unscoped, every report was the sum of
   * every project the store had ever seen: on the development machine a freshly created empty
   * directory reported 621,206 characters saved across 50 other projects, and each of those
   * projects reported the same figure, so the number answered no question anyone had asked.
   *
   * Null when no adapters were available. The id is a salted hash the adapter layer owns, so
   * there is nothing to compare against without it, and the scope is reported as absent rather
   * than quietly reinstating the unscoped read.
   */
  const projectId =
    context.metricsAllProjects === true || context.adapters === null
      ? null
      : context.adapters.projectIdFor(context.projectRoot);

  const events: OptimizationEvent[] = [];
  for await (const event of store.query({
    since: window.sinceInstant,
    until: window.untilInstant,
    ...(projectId === null ? {} : { projectId }),
    ...(context.provider === null ? {} : { providerIds: [context.provider] }),
    ...(context.harness === null ? {} : { harnessIds: [context.harness] }),
  })) {
    events.push(event);
  }

  if (projectId === null) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'metrics-not-project-scoped',
        message:
          context.metricsAllProjects === true
            ? 'This report covers all locally recorded projects, including unattributed operations'
            : 'This report covers every project in the store: no project identity was available',
        remediation: null,
      }),
    );
  } else {
    // Excluded by the scope above, and counted rather than dropped in silence: an operation RTK
    // recorded without a directory belongs to no project, and the same figure used to be added
    // to every project's total. One line with the count keeps the difference reconcilable.
    let unattributed = 0;
    for await (const _event of store.query({
      since: window.sinceInstant,
      until: window.untilInstant,
      projectId: UNATTRIBUTED_PROJECT_ID,
      ...(context.provider === null ? {} : { providerIds: [context.provider] }),
      ...(context.harness === null ? {} : { harnessIds: [context.harness] }),
    })) {
      unattributed += 1;
    }
    if (unattributed > 0) {
      diagnostics.push(
        diagnostic({
          severity: 'info',
          code: 'metrics-unattributed-excluded',
          message: `${String(unattributed)} operation${unattributed === 1 ? '' : 's'} named no project and are excluded from this report`,
          remediation: null,
        }),
      );
    }
  }

  /**
   * The applied pipeline inventory is the same one `status` reports.
   *
   * Do not re-derive it from today's resolver: a receipt says what was actually applied, while
   * live detection inside `status` removes historical pipelines that have since been uninstalled
   * or manually disconnected. Metrics needs that exact present-tense inventory before it can claim
   * a channel total.
   */
  let channelExpectations: MetricsChannelExpectation[] | undefined;
  let managedProviders: ProviderId[] = [];
  if (context.adapters !== null) {
    const status = await runStatus(context);
    const pipelines = status.data?.pipelines ?? [];
    managedProviders = [
      ...new Set(
        pipelines.flatMap((pipeline) =>
          pipeline.owners
            .map((owner) => owner.owner)
            .filter((owner): owner is ProviderId => owner !== TOKEN_HARNESS_OWNER),
        ),
      ),
    ];

    // A provider-filtered stream is intentionally partial. Computing a raw-to-final pipeline total
    // from it would turn the missing stages created by the flag into an "incomparable pipeline".
    // Provider rows still render normally; channel totals are omitted under that filter.
    if (context.provider === null && context.metricsAllProjects !== true) {
      channelExpectations = pipelines.flatMap((pipeline) =>
        (pipeline.channels ?? []).map((channel) => ({
          pipelineId: pipeline.pipelineId,
          harness: pipeline.harness,
          toolFamily: channel.toolFamily,
          capability: channel.capability,
          owners: channel.owners,
        })),
      );
    }
  }

  const report = aggregateEvents({
    events,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    managedProviders,
    adapterModes,
    ...(channelExpectations === undefined ? {} : { channels: channelExpectations }),
  });

  if (context.metricsAllProjects === true) {
    report.scope = 'all-projects';
    const seen = new Set<string>();
    const unique = events.filter((event) => {
      if (seen.has(event.eventId)) return false;
      seen.add(event.eventId);
      return true;
    });
    const timestamps = unique.map((event) => event.timestamp).sort();
    report.firstRecordedAt = timestamps[0] ?? null;
    report.lastRecordedAt = timestamps.at(-1) ?? null;
    for (const row of report.providers) {
      const matching = unique.filter(
        (event) =>
          event.provider.id === row.providerId &&
          event.measurement.class === row.class &&
          event.outcome.changed &&
          measurementUnit(event) === row.unit,
      );
      row.before = matching.reduce(
        (sum, event) =>
          sum +
          (row.unit === 'tokens'
            ? (event.measurement.beforeTokens ?? 0)
            : (event.measurement.beforeChars ?? 0)),
        0,
      );
      row.after = matching.reduce(
        (sum, event) =>
          sum +
          (row.unit === 'tokens'
            ? (event.measurement.afterTokens ?? 0)
            : (event.measurement.afterChars ?? 0)),
        0,
      );
    }
  }

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
