/**
 * RTK's installation and configuration plan — PLAN §10, RFC 0002 §Planning, RFC 0004.
 *
 * ## What the plan is
 *
 * A small set of actions, and often zero:
 *
 * 1. installation, when RTK is not runnable — chosen from the manifest's channels;
 * 2. one `merge-json` entry per uncovered Claude shell tool family.
 *
 * On Windows Claude Code can expose both `Bash` and `PowerShell`. RTK's native Claude hook reads
 * `tool_input.command` and does not branch on the tool name, so an existing RTK Claude integration
 * can use the same `rtk hook claude` command for the PowerShell matcher. Token Harness owns that
 * matcher entry itself instead of relying on RTK's installer, whose PowerShell setup is still an
 * upstream gap.
 *
 * Zero is the case that matters most on a real machine. PLAN §10 requires the plan to
 * "tolerate an existing user-managed RTK installation", and RFC 0004 §Brownfield adoption
 * makes that the default posture rather than a special case: when RTK is already installed and
 * already registered in the surface Token Harness would claim, the correct plan is empty. Not
 * "rewrite it the way we would have written it" — the state is already the desired state, and
 * an action that rewrote it would take ownership of a line the user wrote.
 *
 * ## Why the hook is an `append` and not a `set`
 *
 * `hooks.PreToolUse` is a list whose other elements belong to the user and to other tools.
 * RFC 0004 scopes ownership to "exact JSON entries recorded in its journal", and
 * `JsonMergeOperation`'s two kinds exist for exactly this distinction: `set` owns the value at
 * a pointer, `append` owns *one element* of a list it does not own. Writing the list with
 * `set` would silently claim every entry in it, and removal would then delete a third party's
 * hook — which RFC 0003 forbids in the same breath as conflict reporting.
 *
 * ## What is deliberately not planned
 *
 * `rtk init`. RTK ships a command that writes the harness hook itself, and calling it would be
 * a delegated install: RFC 0002 §What this cannot detect requires a reviewed write set recorded
 * in the manifest with the upstream version it was performed against, and
 * `delegatedInstallReview` in RTK's manifest is null because no such review has been done.
 * Writing the hook entries ourselves is the reviewable alternative, and it is what makes
 * rollback a snapshot restore rather than an inverse command nobody has verified.
 */

import {
  channelCanReportInventory,
  digestText,
  jsonValueDigest,
  preferredInstallationChannel,
  type CapabilityScope,
  type HarnessManifest,
  type JsonValue,
  type MergeJsonAction,
  type PlannedAction,
  type ProviderPlan,
} from '@token-harness/core';

import type { ProviderContext, ProviderPlanRequest } from './contract.js';

/** The command RTK's own hook uses, as observed in a configured installation. */
export const RTK_HOOK_COMMAND_PREFIX = 'rtk hook';

/**
 * Harnesses whose primary configuration is a hook list this builder knows how to append to.
 *
 * A set rather than a check on the manifest, because there is nothing in a `HarnessManifest` that
 * says "this file's interception points are a `hooks` map" — `configFiles` carries a parser, and
 * `jsonc` is equally true of Claude Code's settings and OpenCode's plugin array. Adding a harness
 * here is a statement that someone has looked at its schema and that the append above produces a
 * valid document in it.
 */
const HOOK_LIST_HARNESSES = new Set<string>(['claude']);
const CLAUDE = 'claude';
const BASH = 'Bash';
const POWERSHELL = 'PowerShell';

/**
 * The pointer into a Claude-shaped settings document.
 *
 * Dotted, with the escaping `parseJsonPointer` defines. The event name comes from the harness
 * manifest rather than from a constant here: RFC 0002 keeps the harness's own spelling on the
 * harness adapter, and `HarnessInterceptionPoint` carries both spellings for this reason.
 */
export function hookListPointer(eventName: string): string {
  return `hooks.${eventName.replace(/\./g, '\\.')}`;
}

/** The entry Token Harness would append: one matcher, one command. */
export function hookEntryFor(harnessId: string, matcher: string): JsonValue {
  return {
    matcher,
    hooks: [{ type: 'command', command: `${RTK_HOOK_COMMAND_PREFIX} ${harnessId}` }],
  };
}

interface PlanTarget {
  scope: CapabilityScope;
  harness: HarnessManifest;
  /** The harness's own event name for the scope's interception point. */
  eventName: string;
  /** Absolute path to the primary configuration file. */
  configPath: string;
}

/**
 * Claude matchers are regular expressions. This mirrors the harness adapter's coverage rule so a
 * user-owned `Bash|PowerShell` entry is recognised as already covering both families rather than
 * provoking a duplicate Token Harness entry.
 */
function matcherCoversFamily(matcher: string, family: string): boolean {
  if (matcher === family) return true;
  try {
    return new RegExp(matcher).test(family);
  } catch {
    return false;
  }
}

/**
 * Turns owned scopes into the files and events they correspond to.
 *
 * Several capabilities can share one surface — RTK owns both `shell.command.rewrite` and
 * `shell.output.reduce` at `Bash`/`pre-tool-use`, because one hook serves both — so targets are
 * deduplicated by file and event. Planning one hook per capability would register the same
 * command twice and double-count every saving, which is the failure RFC 0003 exists to prevent,
 * caused by us rather than by a third party.
 *
 * Windows has one deliberate extension to resolver ownership: if RTK owns Claude's Bash
 * `PreToolUse` surface, the same native hook command can cover Claude's PowerShell shell tool. The
 * resolver historically omitted that surface because RTK's installer did. The provider hook
 * itself is command-payload based, so the plan closes the matcher gap without asking RTK's
 * installer to mutate settings.
 */
export function planTargets(
  context: ProviderContext,
  request: ProviderPlanRequest,
): PlanTarget[] {
  const targets = new Map<string, PlanTarget>();

  for (const owned of request.ownership) {
    const harness = request.harnesses.find(
      (entry) => entry.id === owned.scope.harness,
    );
    if (harness === undefined) continue;

    /**
     * Only a harness whose configuration is the hook-list shape this file writes.
     *
     * Everything below builds one thing: a `{matcher, hooks:[{type:'command'}]}` object appended
     * at `hooks.<eventName>`. That is Claude Code's schema. OpenCode has no `hooks` document at
     * all — RTK reaches it by dropping a plugin module into `.config/opencode/plugins/`, which
     * `rtk init -g --opencode` writes and this builder has no action for.
     *
     * RTK claims OpenCode as of spike 9.1, so the resolver can now hand this function a scope on
     * it. Without this guard the loop would happily produce a target and append a Claude-shaped
     * hook entry to `opencode.jsonc` — a file OpenCode would then load with a `hooks` key it does
     * not read, from a plan whose diff looked plausible to a reviewer.
     *
     * The compatibility gate decides when a plan may run. This guard decides whether the action is
     * structurally correct in the first place.
     */
    if (!HOOK_LIST_HARNESSES.has(harness.id)) continue;

    const point = harness.interceptionPoints.find(
      (entry) => entry.scopeId === owned.scope.interceptionPoint,
    );
    if (point === undefined) continue;

    const file = harness.configFiles.find((entry) => entry.primary);
    if (file === undefined) continue;

    // A `user`-scoped file hangs off the home directory; a `project` one off the project root.
    // Resolving it here rather than in the action keeps the plan's paths absolute, which is
    // what lets a reviewer see which file will change.
    const base = file.scope === 'user' ? context.paths.home : context.projectRoot;
    const configPath = context.fs.join(base, ...file.path.split('/'));

    const key = `${configPath}\u0000${point.eventName}\u0000${owned.scope.toolFamily}`;
    if (targets.has(key)) continue;
    targets.set(key, {
      scope: owned.scope,
      harness,
      eventName: point.eventName,
      configPath,
    });
  }

  if (context.facts.os === 'windows') {
    for (const target of [...targets.values()]) {
      if (target.harness.id !== CLAUDE || target.scope.toolFamily !== BASH) continue;
      if (!target.harness.toolFamilies.some((family) => family.id === POWERSHELL)) continue;

      const key = `${target.configPath}\u0000${target.eventName}\u0000${POWERSHELL}`;
      if (targets.has(key)) continue;
      targets.set(key, {
        ...target,
        scope: { ...target.scope, toolFamily: POWERSHELL },
      });
    }
  }

  return [...targets.values()];
}

/** Whether the live configuration already carries RTK on this surface. */
function alreadyRegistered(
  context: ProviderContext,
  target: PlanTarget,
  identifies: (command: string) => boolean,
  allowRegexCoverage: boolean,
): boolean {
  return context.harnessConfigs.some(
    (config) =>
      config.harnessId === target.harness.id &&
      config.configPath === target.configPath &&
      config.interceptionPoints.includes(target.scope.interceptionPoint) &&
      config.matchers.some((matcher) =>
        allowRegexCoverage
          ? matcherCoversFamily(matcher, target.scope.toolFamily)
          : matcher === target.scope.toolFamily,
      ) &&
      config.commands.some((command) => identifies(command)),
  );
}

function deterministicId(parts: readonly string[]): string {
  // RFC 0002 §Planning: "Deterministic: the same plan input always yields the same ID." A
  // counter would renumber every action when one is inserted, and RFC 0006 §Plan persistence
  // compares a stored plan against a recomputed one.
  const digest = digestText(parts.join('\u0000'));
  return digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 9);
}

function hookAction(target: PlanTarget, entry: JsonValue): MergeJsonAction {
  const pointer = hookListPointer(target.eventName);
  return {
    kind: 'merge-json',
    id: deterministicId([
      'rtk',
      'hook',
      target.configPath,
      target.eventName,
      target.scope.toolFamily,
    ]),
    // Reversible: the only change is one appended list element, and a snapshot restores the
    // file exactly. Nothing here downloads, elevates, or runs a third-party installer.
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.configPath],
    affectedProcesses: [],
    preconditions: [
      `${target.configPath} is absent or parses as JSON`,
      `no entry matching ${target.scope.toolFamily} on ${target.eventName} already invokes rtk`,
    ],
    postconditions: [
      `${target.eventName} carries one rtk entry for ${target.scope.toolFamily}`,
      'every other entry in the list is unchanged',
    ],
    rollbackData: 'file-snapshot',
    explanation: `Register rtk on ${target.harness.displayName}'s ${target.eventName} hook for ${target.scope.toolFamily} tools`,
    path: target.configPath,
    // The pointer names the *list*, and the operation owns one element of it. What Token
    // Harness may later remove is that element, never the list.
    ownedPointers: [pointer],
    operations: [
      {
        kind: 'append',
        pointer,
        value: entry,
        // Null: nothing of ours must be there yet. A digest would mean "our entry must already
        // be exactly this", which is the precondition for *replacing* it, not for adding it.
        expectedValueDigest: null,
      },
    ],
    // Claude's `settings.json` exists on any machine that has run the harness, but a fresh
    // install may not have written it yet, and refusing to create it would make the plan fail
    // on exactly the machine with nothing to lose.
    createIfMissing: true,
  };
}

function removalAction(target: PlanTarget, entry: JsonValue): PlannedAction {
  const pointer = hookListPointer(target.eventName);
  const reverses = deterministicId([
    'rtk',
    'hook',
    target.configPath,
    target.eventName,
    target.scope.toolFamily,
  ]);
  return {
    kind: 'remove-owned-change',
    id: deterministicId([
      'rtk',
      'unhook',
      target.configPath,
      target.eventName,
      target.scope.toolFamily,
    ]),
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.configPath],
    affectedProcesses: [],
    preconditions: [`the rtk entry on ${target.eventName} still matches what was written`],
    postconditions: [
      `${target.eventName} no longer carries an rtk entry for ${target.scope.toolFamily}`,
    ],
    rollbackData: 'file-snapshot',
    explanation: `Remove the rtk entry from ${target.harness.displayName}'s ${target.eventName} hook`,
    path: target.configPath,
    reverses,
    // The claim is stated in the plan and checked against the live file when it runs. RFC 0004
    // §Ownership: a user edit blocks automatic deletion, and it can only do so if the plan says
    // what it believes it owns.
    target: {
      kind: 'owned-json-entry',
      path: target.configPath,
      pointer,
      placement: 'array-element',
      valueDigest: jsonValueDigest(entry),
    },
  };
}

/**
 * The installation action, when RTK cannot be run.
 *
 * The channel comes from the manifest, filtered by this platform and ordered by the priority
 * the manifest declares. RFC 0004 §Network policy is why `digestAvailable` appears in the
 * action's own precondition rather than being assumed: a channel that cannot supply a digest
 * is still usable, but the plan says so instead of implying verification that will not happen.
 */
export function installAction(
  context: ProviderContext,
  manifest: { installationChannels: ProviderManifestChannels },
): PlannedAction | null {
  const channel = preferredInstallationChannel(manifest.installationChannels, context.facts.os);
  if (channel === null) return null;

  return {
    kind: 'package-manager-install',
    id: deterministicId(['rtk', 'install', channel.id, context.facts.os]),
    // Not `reversible`: an installed package is removed by uninstalling it, not by restoring a
    // file, and RFC 0002's risk classes exist so a reviewer sees that difference.
    riskClass: 'delegated',
    requiresNetwork: channel.requiresNetwork,
    requiresElevation: channel.requiresElevation,
    affectedPaths: [],
    affectedProcesses: [channel.id],
    preconditions: [
      `${channel.id} is available on this machine`,
      channel.digestAvailable
        ? 'the release artifact carries a digest that will be verified'
        : 'this channel publishes no digest, so the artifact cannot be verified by content',
    ],
    postconditions: ['`rtk --version` reports a version inside the tested range'],
    // The declared value the executor now implements (RFC 0009 §Initial delivery order item 1):
    // the executor captures whatever the channel has installed before the install runs, and a
    // rollback restores that captured version through the same channel. `none` is left only for
    // channels this build cannot ask about — there the executor says the package stayed instead.
    rollbackData: channelCanReportInventory(channel.id) ? 'package-inventory' : 'none',
    explanation: `Install RTK through ${channel.id}`,
    packageManager: channel.id,
    // The channel's own name for the package, because they differ: `rtk-ai.rtk` on winget and
    // `rtk` as a crate. Defaulting to the provider id would install nothing on winget.
    packageName: channel.packageId ?? 'rtk',
    // Unpinned deliberately: pinning a version Token Harness has not tested against would be a
    // stronger claim than the manifest's tested range supports.
    version: null,
  };
}

/** The channel shape `installAction` needs, without importing the whole manifest type. */
type ProviderManifestChannels = readonly {
  id: string;
  packageId?: string;
  priority: number;
  platforms: readonly string[];
  requiresNetwork: boolean;
  requiresElevation: boolean;
  digestAvailable: boolean;
}[];

export interface RtkPlanInput {
  context: ProviderContext;
  request: ProviderPlanRequest;
  /** Whether `rtk` could be run, from `detect`. */
  installed: boolean;
  identifiesCommand(command: string): boolean;
  installationChannels: ProviderManifestChannels;
}

/**
 * Builds the plan.
 *
 * The order is the order it must run in: install before configure, because a hook pointing at
 * an absent executable is the `broken` state `detect` reports. For removal the order inverts,
 * which is why uninstall is not simply the same list reversed by a caller.
 */
export function buildRtkPlan(input: RtkPlanInput): ProviderPlan {
  const { context, request } = input;
  const targets = planTargets(context, request);
  const actions: PlannedAction[] = [];
  const targetHarnesses = [...new Set(targets.map((target) => target.harness.id))];

  if (request.desiredState === 'absent') {
    // Only exact entries are removal candidates. A user-owned combined matcher such as
    // `Bash|PowerShell` can satisfy coverage while configured, but Token Harness must not claim it
    // as an entry it wrote and later remove it under one of the individual family digests.
    for (const target of targets) {
      if (!alreadyRegistered(context, target, input.identifiesCommand, false)) continue;
      actions.push(
        removalAction(target, hookEntryFor(target.harness.id, target.scope.toolFamily)),
      );
    }
    // RTK itself is deliberately left installed. RFC 0004: Token Harness removes what it owns,
    // and on a machine where RTK was already present it never owned the installation. Removing
    // a tool the user installed themselves would be the destructive reading of "uninstall".
    return {
      providerId: 'rtk' as ProviderPlan['providerId'],
      desiredState: 'absent',
      actions,
      targetHarnesses: actions.length === 0 ? [] : targetHarnesses,
    };
  }

  if (!input.installed) {
    const install = installAction(context, { installationChannels: input.installationChannels });
    if (install !== null) actions.push(install);
  }

  for (const target of targets) {
    if (alreadyRegistered(context, target, input.identifiesCommand, true)) continue;
    actions.push(hookAction(target, hookEntryFor(target.harness.id, target.scope.toolFamily)));
  }

  return {
    providerId: 'rtk' as ProviderPlan['providerId'],
    desiredState: 'configured',
    actions,
    targetHarnesses: actions.length === 0 ? [] : targetHarnesses,
  };
}
