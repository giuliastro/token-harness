import {
  FileJournalStore,
  diagnostic,
  harnessId,
  jsonValueDigest,
  type Diagnostic,
  type FileSystemPort,
  type HarnessId,
  type JsonValue,
  type OwnedArtifact,
  type PlatformFacts,
  type PlatformPaths,
  type PlannedAction,
  type ProcessRunner,
  type TaskBenchmarkNativeRoutingObservation,
} from '@token-harness/core';
import {
  findHarnessAdapter,
  nativePromptRoutingHookEntries,
  nativePromptRoutingVersionSupported,
  readCodexHookEnablement,
  resolveConfigPath,
} from '@token-harness/adapters';

const UTF8 = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const ROUTE_MARKER = '__internal-prompt-router';
const MAX_EVENT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_SCAN_BYTES = 16 * 1024 * 1024;
const PROMPT_ROUTER_CHECK_MARKER = 'token-harness-prompt-router-v1';

export type PromptRouterState = 'managed' | 'external' | 'absent' | 'conflict' | 'unavailable';
export type PromptRouterEventType = 'prompt-submit' | 'subagent-start' | 'subagent-stop';

export interface PromptRouterEvent {
  schemaVersion: 1;
  timestamp: string;
  harness: 'claude' | 'codex';
  projectId: string;
  type: PromptRouterEventType;
  model: string | null;
  agentType: string | null;
}

export interface PromptRouterObservation {
  harness: 'claude' | 'codex';
  state: PromptRouterState;
  label: string;
  detail: string;
  configPath: string | null;
  configured: boolean | null;
  promptSubmissions: number;
  subagentsStarted: number;
  subagentsStopped: number;
  reportedModels: string[];
  lastObservedAt: string | null;
  receiptState: 'available' | 'unavailable' | 'limited';
  enablement?: 'enabled' | 'disabled' | 'untrusted' | 'unknown';
  verificationTier?: 'config-only' | 'runtime-observed';
  needsRepair?: boolean;
}

export interface PromptRouterPlan {
  target: string | null;
  actions: PlannedAction[];
  diagnostics: Diagnostic[];
}

interface RoutingFileContext {
  fs: FileSystemPort;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
}

interface RoutingConfigTarget {
  harness: 'claude' | 'codex';
  path: string;
  version: string | null;
  fileContext: RoutingFileContext;
}

function isHarness(value: HarnessId): value is HarnessId & ('claude' | 'codex') {
  return value === 'claude' || value === 'codex';
}

function configTarget(input: {
  fs: FileSystemPort;
  home: string | null;
  harness: HarnessId;
  version: string | null;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
}): RoutingConfigTarget | null {
  if (!isHarness(input.harness) || input.home === null) return null;
  const adapter = findHarnessAdapter(harnessId(input.harness));
  const declaration = adapter?.manifest.configFiles.find(
    (file) =>
      file.scope === 'user' &&
      file.parser === 'json' &&
      file.interceptionPoints?.includes('user-prompt-submit') === true,
  );
  if (declaration === undefined || adapter === null) return null;
  const fileContext: RoutingFileContext = {
    fs: input.fs,
    runner: input.runner,
    facts: input.facts,
    paths: { ...input.paths, home: input.home },
    projectRoot: input.projectRoot,
  };
  return {
    harness: input.harness,
    path: resolveConfigPath(declaration, fileContext),
    version: input.version,
    fileContext,
  };
}

function hookEntries(harness: 'claude' | 'codex', platform: PlatformFacts['os'] = 'linux') {
  return nativePromptRoutingHookEntries(harnessId(harness), 'token-harness', platform);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseHookDocument(
  text: string,
): { ok: true; hooks: Record<string, unknown> } | { ok: false; reason: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'The hook settings file is malformed JSON or contains comments.' };
  }
  const root = asRecord(decoded);
  if (root === null) return { ok: false, reason: 'The hook settings root must be a JSON object.' };
  const hooksValue = root['hooks'];
  if (hooksValue === undefined) return { ok: true, hooks: {} };
  const hooks = asRecord(hooksValue);
  if (hooks === null)
    return { ok: false, reason: 'The settings hooks property must be an object.' };
  for (const { eventName } of hookEntries('codex')) {
    const entries = hooks[eventName];
    if (entries !== undefined && !Array.isArray(entries))
      return { ok: false, reason: `The ${eventName} hook property must be an array.` };
  }
  return { ok: true, hooks };
}

function containsRouterCommand(value: unknown, harness: 'claude' | 'codex'): boolean {
  const row = asRecord(value);
  const hooks = row?.['hooks'];
  if (!Array.isArray(hooks)) return false;
  return hooks.some((hook) => {
    const handler = asRecord(hook);
    if (handler === null) return false;
    if (harness === 'codex')
      return [handler['command'], handler['commandWindows']].some(
        (command) => typeof command === 'string' && command.includes(ROUTE_MARKER),
      );
    const args = handler['args'];
    return (
      (typeof handler['command'] === 'string' && handler['command'].includes(ROUTE_MARKER)) ||
      (handler['command'] === 'token-harness' && Array.isArray(args) && args[0] === ROUTE_MARKER)
    );
  });
}

function configHasExactRouter(
  hooks: Record<string, unknown>,
  harness: 'claude' | 'codex',
  platform: PlatformFacts['os'],
): { complete: boolean; partial: boolean; conflict: boolean } {
  let exactCount = 0;
  let routeCount = 0;
  for (const expected of hookEntries(harness, platform)) {
    const live = hooks[expected.eventName];
    const entries = Array.isArray(live) ? live : [];
    const routeEntries = entries.filter((entry) => containsRouterCommand(entry, harness));
    routeCount += routeEntries.length;
    if (
      routeEntries.some(
        (entry) => jsonValueDigest(entry as JsonValue) === jsonValueDigest(expected.value),
      )
    )
      exactCount += 1;
  }
  return {
    complete: exactCount === hookEntries(harness, platform).length,
    partial: routeCount > 0 && exactCount !== hookEntries(harness, platform).length,
    conflict: routeCount > exactCount,
  };
}

function routerOwnedArtifacts(
  journals: Awaited<ReturnType<FileJournalStore['list']>>,
  path: string,
  harness: 'claude' | 'codex',
  platform: PlatformFacts['os'],
): OwnedArtifact[] {
  const expected = hookEntries(harness, platform);
  for (const journal of journals) {
    const disabledHere = journal.entries.some(
      (entry) =>
        entry.actionId.startsWith(`native-prompt-routing:${harness}:disable:`) &&
        entry.snapshots.some((snapshot) => snapshot.path === path),
    );
    if (disabledHere && journal.outcome === 'committed') return [];
    const relevant = journal.ownership.filter(
      (artifact) =>
        artifact.kind === 'owned-json-entry' &&
        artifact.path === path &&
        artifact.placement === 'array-element' &&
        expected.some(
          (entry) =>
            artifact.pointer === `hooks.${entry.eventName}` &&
            artifact.valueDigest === jsonValueDigest(entry.value),
        ),
    );
    if (relevant.length > 0) return journal.outcome === 'committed' ? relevant : [];
  }
  return [];
}

async function journalsFor(input: {
  fs: FileSystemPort;
  stateRoot: string | null;
}): Promise<Awaited<ReturnType<FileJournalStore['list']>>> {
  if (input.stateRoot === null) return [];
  const journalRoot = input.fs.join(input.stateRoot, 'journals');
  if ((await input.fs.stat(journalRoot))?.kind !== 'directory') return [];
  return new FileJournalStore({
    fs: input.fs,
    journalRoot,
    backupRoot: input.fs.join(input.stateRoot, 'backups'),
  }).list();
}

function actionId(
  harness: 'claude' | 'codex',
  intent: 'enable' | 'disable',
  eventName: string,
): string {
  return `native-prompt-routing:${harness}:${intent}:${eventName}`;
}

export async function planNativePromptRoutingInstall(input: {
  fs: FileSystemPort;
  home: string | null;
  harness: HarnessId;
  version: string | null;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
  stateRoot?: string | null;
}): Promise<PromptRouterPlan> {
  const diagnostics: Diagnostic[] = [];
  const target = configTarget(input);
  if (target === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'prompt-routing-target-unavailable',
        subject: input.harness,
        message: 'No supported user-scope native prompt hook target is available',
        remediation: 'Resolve the user home and harness installation, then refresh Token Harness',
      }),
    );
    return { target: null, actions: [], diagnostics };
  }
  if (!nativePromptRoutingVersionSupported(harnessId(target.harness), target.version)) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'prompt-routing-version-unverified',
        subject: target.harness,
        message: `Routing is not supported for ${target.harness} ${target.version ?? '(version unknown)'}. Check Token Harness updates in Health and updates, then retry.`,
        path: target.path,
        remediation:
          'Check for Token Harness updates; this agent version needs a verified hook fixture',
      }),
    );
    return { target: target.path, actions: [], diagnostics };
  }

  const runtimeCheck = await input.runner.run({
    executable: 'token-harness',
    args: ['__internal-prompt-router', target.harness, '--check'],
    cwd: input.projectRoot,
    timeoutMs: 3_000,
    maxOutputBytes: 256,
  });
  if (
    runtimeCheck.failure !== null ||
    runtimeCheck.exitCode !== 0 ||
    runtimeCheck.stdout.trim() !== PROMPT_ROUTER_CHECK_MARKER
  ) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'prompt-routing-runtime-unavailable',
        subject: target.harness,
        message: 'The Token Harness executable found on PATH cannot serve the native prompt hook',
        path: target.path,
        remediation:
          'Install or update Token Harness so the same executable is available to the coding agent, then refresh and plan again',
      }),
    );
    return { target: target.path, actions: [], diagnostics };
  }

  const stat = await input.fs.stat(target.path);
  if (stat !== null && stat.kind !== 'file') {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'prompt-routing-target-not-file',
        subject: target.harness,
        message: 'A non-file occupies the native hook settings path',
        path: target.path,
        remediation: 'Move the conflicting path and refresh Token Harness',
      }),
    );
    return { target: target.path, actions: [], diagnostics };
  }
  let hooks: Record<string, unknown> = {};
  if (stat !== null) {
    const parsed = parseHookDocument(DECODER.decode(await input.fs.readFile(target.path)));
    if (!parsed.ok) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'prompt-routing-settings-unmergeable',
          subject: target.harness,
          message: parsed.reason,
          path: target.path,
          remediation: 'Repair the JSON settings file or configure native prompt routing manually',
        }),
      );
      return { target: target.path, actions: [], diagnostics };
    }
    hooks = parsed.hooks;
  }

  const existing = configHasExactRouter(hooks, target.harness, input.facts.os);
  if (existing.complete) {
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'prompt-routing-already-configured',
        subject: target.harness,
        message: 'Native prompt routing hooks are already present; no settings are changed',
        path: target.path,
        remediation: null,
      }),
    );
    return { target: target.path, actions: [], diagnostics };
  }
  const legacy =
    target.harness === 'claude' && input.facts.os === 'windows'
      ? configHasExactRouter(hooks, target.harness, 'linux')
      : null;
  const legacyOwned =
    legacy?.complete && !legacy.conflict
      ? routerOwnedArtifacts(
          await journalsFor({ fs: input.fs, stateRoot: input.stateRoot ?? null }),
          target.path,
          target.harness,
          'linux',
        )
      : [];
  const repair = legacyOwned.length === 3;
  if ((existing.partial || existing.conflict) && !repair) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'prompt-routing-existing-hook-conflict',
        subject: target.harness,
        message:
          'A partial or modified Token Harness prompt hook already exists and was left untouched',
        path: target.path,
        remediation: 'Review the existing native routing entries before planning another change',
      }),
    );
    return { target: target.path, actions: [], diagnostics };
  }

  const entries = hookEntries(target.harness, input.facts.os);
  const action: PlannedAction = {
    kind: 'merge-json',
    id: actionId(target.harness, 'enable', 'all'),
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [target.path],
    affectedProcesses: [target.harness],
    preconditions: [
      'the harness hook settings remain absent or valid JSON',
      'no Token Harness native prompt-routing hooks are already present',
    ],
    postconditions: entries.map((entry) => `${entry.eventName} has one Token Harness-owned hook`),
    rollbackData: 'file-snapshot',
    explanation:
      `Enable automatic native prompt routing for ${target.harness}` +
      (target.harness === 'codex'
        ? '; manually enable and trust this hook in Codex after applying'
        : '; start a new Claude Code session after applying'),
    path: target.path,
    ownedPointers: entries.map((entry) => `hooks.${entry.eventName}`),
    operations: entries.map((entry) => ({
      kind: 'append' as const,
      pointer: `hooks.${entry.eventName}`,
      value: entry.value,
      expectedValueDigest: null,
    })),
    createIfMissing: true,
  };
  const removals = repair
    ? await planNativePromptRoutingRemoval({ ...input, stateRoot: input.stateRoot ?? null })
    : null;
  return { target: target.path, actions: [...(removals?.actions ?? []), action], diagnostics };
}

export async function planNativePromptRoutingRemoval(input: {
  fs: FileSystemPort;
  home: string | null;
  stateRoot: string | null;
  harness: HarnessId;
  version: string | null;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
}): Promise<PromptRouterPlan> {
  const diagnostics: Diagnostic[] = [];
  const target = configTarget(input);
  if (target === null || input.stateRoot === null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'prompt-routing-removal-unavailable',
        subject: input.harness,
        message: 'The owned native prompt-routing configuration could not be located safely',
        remediation: 'Refresh Token Harness from the signed-in user environment',
      }),
    );
    return { target: target?.path ?? null, actions: [], diagnostics };
  }
  let expected = hookEntries(target.harness, input.facts.os);
  const journals = await journalsFor({ fs: input.fs, stateRoot: input.stateRoot });
  let artifacts = routerOwnedArtifacts(journals, target.path, target.harness, input.facts.os);
  if (artifacts.length === 0 && target.harness === 'claude' && input.facts.os === 'windows') {
    expected = hookEntries(target.harness, 'linux');
    artifacts = routerOwnedArtifacts(journals, target.path, target.harness, 'linux');
  }
  const actions = expected.flatMap((entry): PlannedAction[] => {
    const pointer = `hooks.${entry.eventName}`;
    const targetArtifact = artifacts.find(
      (artifact) =>
        artifact.kind === 'owned-json-entry' &&
        artifact.pointer === pointer &&
        artifact.valueDigest === jsonValueDigest(entry.value),
    );
    if (targetArtifact === undefined) return [];
    const reverses = actionId(target.harness, 'enable', 'all');
    return [
      {
        kind: 'remove-owned-change',
        id: actionId(target.harness, 'disable', entry.eventName),
        riskClass: 'reversible',
        requiresNetwork: false,
        requiresElevation: false,
        affectedPaths: [target.path],
        affectedProcesses: [target.harness],
        preconditions: [`${entry.eventName} still contains the exact Token Harness-owned hook`],
        postconditions: [`${entry.eventName} no longer contains the owned prompt-routing hook`],
        rollbackData: 'file-snapshot',
        explanation: `Disable automatic native prompt routing for ${target.harness}`,
        path: target.path,
        reverses,
        target: targetArtifact,
      },
    ];
  });
  if (actions.length === 0)
    diagnostics.push(
      diagnostic({
        severity: 'info',
        code: 'prompt-routing-not-owned',
        subject: target.harness,
        message: 'Token Harness owns no native prompt-routing hooks here, so nothing is removed',
        path: target.path,
        remediation: null,
      }),
    );
  return { target: target.path, actions, diagnostics };
}

async function readEvents(input: {
  fs: FileSystemPort;
  stateRoot: string | null;
  harness?: 'claude' | 'codex';
  projectId?: string;
  since?: string;
}): Promise<{ state: 'available' | 'unavailable' | 'limited'; events: PromptRouterEvent[] }> {
  if (input.stateRoot === null) return { state: 'unavailable', events: [] };
  const directory = input.fs.join(input.stateRoot, 'prompt-routing');
  if ((await input.fs.stat(directory))?.kind !== 'directory')
    return { state: 'available', events: [] };
  const files = (await input.fs.readDirectory(directory))
    .filter((name) => /^events-\d{4}-\d{2}\.jsonl$/.test(name))
    .sort()
    .reverse();
  const events: PromptRouterEvent[] = [];
  let scannedBytes = 0;
  try {
    for (const file of files) {
      const path = input.fs.join(directory, file);
      const stat = await input.fs.stat(path);
      if (stat === null || stat.kind !== 'file') continue;
      if (
        stat.byteLength > MAX_EVENT_FILE_BYTES ||
        scannedBytes + stat.byteLength > MAX_EVENT_SCAN_BYTES
      )
        return { state: 'limited', events };
      const bytes = await input.fs.readFile(path);
      if (bytes.byteLength !== stat.byteLength) return { state: 'limited', events };
      scannedBytes += bytes.byteLength;
      const text = DECODER.decode(bytes);
      for (const line of text.split('\n')) {
        if (line === '') continue;
        try {
          const value = JSON.parse(line) as unknown;
          if (!isPromptRouterEvent(value)) continue;
          if (input.harness !== undefined && value.harness !== input.harness) continue;
          if (input.projectId !== undefined && value.projectId !== input.projectId) continue;
          if (input.since !== undefined && value.timestamp < input.since) continue;
          events.push(value);
        } catch {
          // A torn final line is ignored; no prompt or tool payload is ever recovered from it.
        }
      }
      if (input.since !== undefined && file.slice(7, 14) < input.since.slice(0, 7)) break;
    }
    return { state: 'available', events };
  } catch {
    return { state: 'unavailable', events: [] };
  }
}

function isPromptRouterEvent(value: unknown): value is PromptRouterEvent {
  const row = asRecord(value);
  return (
    row?.['schemaVersion'] === 1 &&
    typeof row['timestamp'] === 'string' &&
    Number.isFinite(Date.parse(row['timestamp'])) &&
    (row['harness'] === 'claude' || row['harness'] === 'codex') &&
    typeof row['projectId'] === 'string' &&
    ['prompt-submit', 'subagent-start', 'subagent-stop'].includes(String(row['type'])) &&
    (row['model'] === null || (typeof row['model'] === 'string' && row['model'].length <= 80)) &&
    (row['agentType'] === null ||
      (typeof row['agentType'] === 'string' && row['agentType'].length <= 80))
  );
}

export async function recordNativePromptRoutingHook(input: {
  fs: FileSystemPort | null;
  stateRoot: string | null;
  harness: 'claude' | 'codex';
  event: PromptRouterEventType;
  projectId: string | null;
  now: string;
  hookInput: string | null;
}): Promise<void> {
  if (input.fs === null || input.stateRoot === null || input.projectId === null) return;
  let payload: Record<string, unknown> | null = null;
  if (input.event !== 'prompt-submit' && input.hookInput !== null) {
    try {
      payload = asRecord(JSON.parse(input.hookInput) as unknown);
    } catch {
      payload = null;
    }
  }
  const agentTypeRaw = payload?.['agent_type'];
  const agentType =
    input.event !== 'prompt-submit' && typeof agentTypeRaw === 'string' && agentTypeRaw.length <= 80
      ? agentTypeRaw
      : null;
  const timestamp = new Date(input.now).toISOString();
  const event: PromptRouterEvent = {
    schemaVersion: 1,
    timestamp,
    harness: input.harness,
    projectId: input.projectId,
    type: input.event,
    // Hook payload model fields can identify the root session, not the spawned child. Until an
    // adapter has a versioned child-model field, keep actual worker identity unknown.
    model: null,
    agentType,
  };
  const partition = `events-${timestamp.slice(0, 7)}.jsonl`;
  const directory = input.fs.join(input.stateRoot, 'prompt-routing');
  await input.fs.createDirectory(directory);
  await input.fs.appendFile(
    input.fs.join(directory, partition),
    UTF8.encode(`${JSON.stringify(event)}\n`),
  );
}

function summarizeEvents(
  events: readonly PromptRouterEvent[],
): Pick<
  PromptRouterObservation,
  | 'promptSubmissions'
  | 'subagentsStarted'
  | 'subagentsStopped'
  | 'reportedModels'
  | 'lastObservedAt'
> {
  return {
    promptSubmissions: events.filter((event) => event.type === 'prompt-submit').length,
    subagentsStarted: events.filter((event) => event.type === 'subagent-start').length,
    subagentsStopped: events.filter((event) => event.type === 'subagent-stop').length,
    reportedModels: [
      ...new Set(
        events
          .filter((event) => event.type === 'subagent-start' || event.type === 'subagent-stop')
          .flatMap((event) => (event.model === null ? [] : [event.model])),
      ),
    ],
    lastObservedAt:
      events
        .map((event) => event.timestamp)
        .sort()
        .at(-1) ?? null,
  };
}

export async function observeNativePromptRouting(input: {
  fs: FileSystemPort;
  home: string | null;
  stateRoot: string | null;
  harness: HarnessId;
  version: string | null;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
  projectId: string | null;
}): Promise<PromptRouterObservation> {
  const harness = isHarness(input.harness) ? input.harness : 'codex';
  const base: PromptRouterObservation = {
    harness,
    state: 'unavailable',
    label: 'Not verified',
    detail: 'Native prompt routing could not be checked on this harness.',
    configPath: null,
    configured: null,
    promptSubmissions: 0,
    subagentsStarted: 0,
    subagentsStopped: 0,
    reportedModels: [],
    lastObservedAt: null,
    receiptState: 'unavailable',
    enablement: 'unknown',
    verificationTier: 'config-only',
  };
  const target = configTarget({ ...input, harness: input.harness });
  if (target === null) return base;
  const eventResult = await readEvents({
    fs: input.fs,
    stateRoot: input.stateRoot,
    harness,
    ...(input.projectId === null ? {} : { projectId: input.projectId }),
    since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const summary = summarizeEvents(eventResult.events);
  const stat = await input.fs.stat(target.path);
  if (stat === null) {
    return {
      ...base,
      state: 'absent',
      label: 'Disabled',
      detail: 'Automatic routing is off. No Token Harness native prompt hook is installed.',
      configPath: target.path,
      configured: false,
      ...summary,
      receiptState: eventResult.state,
    };
  }
  if (stat.kind !== 'file')
    return {
      ...base,
      state: 'conflict',
      label: 'Path conflict',
      detail: 'A non-file occupies the native hook settings path.',
      configPath: target.path,
      ...summary,
      receiptState: eventResult.state,
    };
  let hooks: Record<string, unknown>;
  try {
    const parsed = parseHookDocument(DECODER.decode(await input.fs.readFile(target.path)));
    if (!parsed.ok)
      return {
        ...base,
        state: 'conflict',
        label: 'Settings need review',
        detail: parsed.reason,
        configPath: target.path,
        ...summary,
        receiptState: eventResult.state,
      };
    hooks = parsed.hooks;
  } catch {
    return {
      ...base,
      state: 'unavailable',
      label: 'Not verified',
      detail: 'The hook settings file could not be read safely.',
      configPath: target.path,
      ...summary,
      receiptState: eventResult.state,
    };
  }
  const match = configHasExactRouter(hooks, harness, input.facts.os);
  if (harness === 'claude' && input.facts.os === 'windows' && (match.partial || match.conflict)) {
    const legacy = configHasExactRouter(hooks, harness, 'linux');
    const owned = routerOwnedArtifacts(await journalsFor(input), target.path, harness, 'linux');
    if (legacy.complete && !legacy.conflict && owned.length === 3)
      return {
        ...base,
        ...summary,
        state: 'managed',
        label: 'Repair required',
        configured: false,
        configPath: target.path,
        needsRepair: true,
        receiptState: eventResult.state,
        detail:
          'The installed routing hook cannot launch the Windows npm command. Choose Repair routing once; future prompts run automatically.',
      };
  }
  if (match.conflict || match.partial) {
    return {
      ...base,
      state: 'conflict',
      label: 'Custom hook needs review',
      detail:
        'A partial or edited Token Harness prompt-routing hook was found and was not changed.',
      configPath: target.path,
      ...summary,
      receiptState: eventResult.state,
    };
  }
  if (!match.complete) {
    return {
      ...base,
      state: 'absent',
      label: 'Disabled',
      detail: 'Automatic routing is off. No Token Harness native prompt hook is installed.',
      configPath: target.path,
      configured: false,
      ...summary,
      receiptState: eventResult.state,
    };
  }
  const artifacts = routerOwnedArtifacts(
    await journalsFor(input),
    target.path,
    harness,
    input.facts.os,
  );
  const state =
    artifacts.length === hookEntries(harness, input.facts.os).length ? 'managed' : 'external';
  const hasRuntimeReceipt = summary.promptSubmissions > 0;
  let enablement: NonNullable<PromptRouterObservation['enablement']> = 'unknown';
  if (harness === 'codex') {
    const declaration = findHarnessAdapter(harnessId(harness))!.manifest.configFiles.find(
      (file) => file.parser === 'json' && file.scope === 'user',
    )!;
    const check = await readCodexHookEnablement(
      target.fileContext,
      {
        declaration,
        path: target.path,
        exists: true,
        parsed: true,
        configuredPoints: [],
        matchers: [],
        commands: [],
      },
      true,
    );
    if (check?.status === 'pass') enablement = 'enabled';
    else if (check?.status === 'fail')
      enablement = /[1-9]\d* untrusted/.test(check.summary) ? 'untrusted' : 'disabled';
  } else {
    // Honor effective project/local hook disablement without mutating user settings.
    const adapter = findHarnessAdapter(harnessId(harness))!;
    let disabled = false;
    let readable = true;
    for (const declaration of adapter.manifest.configFiles) {
      const path = resolveConfigPath(declaration, target.fileContext);
      if ((await input.fs.stat(path))?.kind !== 'file') continue;
      try {
        const doc = asRecord(JSON.parse(DECODER.decode(await input.fs.readFile(path))));
        if (typeof doc?.['disableAllHooks'] === 'boolean') disabled = doc['disableAllHooks'];
      } catch {
        readable = false;
      }
    }
    enablement = readable ? (disabled ? 'disabled' : 'enabled') : 'unknown';
  }
  const blocked = enablement === 'untrusted' || enablement === 'disabled';
  const label = blocked
    ? enablement === 'untrusted'
      ? 'Authorization required'
      : 'Hooks disabled'
    : hasRuntimeReceipt
      ? 'Runtime observed'
      : enablement === 'enabled'
        ? 'Ready · awaiting prompt'
        : 'Configured · check authorization';
  const scope = input.projectId === null ? 'across projects' : 'in this project';
  const detail = blocked
    ? harness === 'codex'
      ? 'Open Codex /hooks. Enable and trust the three Token Harness routing hooks once, then send a prompt.'
      : 'Hooks are disabled in Claude settings. Enable hooks in /hooks, then send a prompt.'
    : hasRuntimeReceipt
      ? `${String(summary.promptSubmissions)} prompt callbacks, ${String(summary.subagentsStarted)} agent starts, ${String(summary.subagentsStopped)} stops ${scope} in the last 30 days. Routing runs automatically on each prompt.${eventResult.state === 'limited' ? ' Counts are partial.' : ''}`
      : enablement === 'enabled'
        ? 'Ready. Send a prompt in a new session; the first callback will appear here automatically. No skill or command is needed per prompt.'
        : harness === 'codex'
          ? 'Open Codex /hooks and check the three Token Harness routing hooks are enabled and trusted. Do this once, then send a prompt in a new session.'
          : 'Check the Claude hook settings can be read and hooks are enabled in /hooks, then send a prompt in a new session.';
  return {
    ...base,
    state,
    label,
    detail,
    enablement,
    verificationTier: hasRuntimeReceipt && !blocked ? 'runtime-observed' : 'config-only',
    configPath: target.path,
    configured: true,
    ...summary,
    receiptState: eventResult.state,
  };
}

export async function nativeRoutingObservationForBenchmark(input: {
  fs: FileSystemPort;
  home: string | null;
  stateRoot: string | null;
  harness: HarnessId;
  version: string | null;
  runner: ProcessRunner;
  facts: PlatformFacts;
  paths: PlatformPaths;
  projectRoot: string;
  projectId: string;
  startedAt?: string;
}): Promise<TaskBenchmarkNativeRoutingObservation> {
  const observed = await observeNativePromptRouting({
    ...input,
    projectId: input.projectId,
  });
  const configured = observed.configured;
  if (input.startedAt === undefined)
    return {
      configured,
      promptSubmissions: 0,
      subagentsStarted: 0,
      subagentsStopped: 0,
      reportedModels: [],
    };
  const found = await readEvents({
    fs: input.fs,
    stateRoot: input.stateRoot,
    harness: observed.harness,
    projectId: input.projectId,
    since: input.startedAt,
  });
  const summary = summarizeEvents(found.events);
  return {
    configured,
    promptSubmissions: summary.promptSubmissions,
    subagentsStarted: summary.subagentsStarted,
    subagentsStopped: summary.subagentsStopped,
    reportedModels: summary.reportedModels,
  };
}
