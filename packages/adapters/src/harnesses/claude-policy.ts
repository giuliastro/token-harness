/** Claude's persisted effort preference. No model, auth, hooks or billing changes. */
import {
  digestBytes,
  jsonValueDigest,
  parseJsonDocumentText,
  type Diagnostic,
  diagnostic,
  type MergeJsonAction,
  type NativeEffortObservation,
  type JsonValue,
  type TransactionJournal,
  type RemoveOwnedChangeAction,
  type OwnedJsonEntryRecord,
} from '@token-harness/core';
import type { HarnessContext } from './contract.js';

// Exact CLI evidence, not a provider compatibility row or a live-session claim.
// See docs/spikes/claude-codex-native-policy.md.
const REVIEWED_VERSIONS = new Set(['2.1.261']);
const PERSISTENT_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
const MAX_SETTINGS_BYTES = 1024 * 1024;
const decoder = new TextDecoder();

function record(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasEffortEnvironment(settings: Record<string, JsonValue>): boolean {
  const env = settings['env'];
  return (
    record(env) &&
    Object.keys(env).some((key) =>
      /^(?:CLAUDE_CODE_EFFORT_LEVEL|MAX_THINKING_TOKENS|CLAUDE_CODE_DISABLE_THINKING|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|ANTHROPIC_(?:MODEL|BASE_URL|API_KEY|AUTH_TOKEN|DEFAULT_.*_MODEL|CUSTOM_MODEL_OPTION))$/i.test(
        key,
      ),
    )
  );
}

export async function readClaudeNativeEffort(
  context: HarnessContext,
): Promise<NativeEffortObservation | null> {
  const request = {
    executable: 'claude',
    cwd: context.projectRoot,
    timeoutMs: 10_000,
    maxOutputBytes: 128 * 1024,
  };
  const versionResult = await context.runner.run({ ...request, args: ['--version'] });
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(versionResult.stdout)?.[1];
  if (
    versionResult.failure !== null ||
    versionResult.exitCode !== 0 ||
    versionResult.stdoutTruncated ||
    version === undefined ||
    !REVIEWED_VERSIONS.has(version)
  ) {
    return null;
  }
  const help = await context.runner.run({ ...request, args: ['--help'] });
  if (help.failure !== null || help.exitCode !== 0 || help.stdoutTruncated) return null;
  const advertised = /--effort\s+<level>[\s\S]{0,120}?\(([^)]+)\)/.exec(help.stdout)?.[1];
  if (advertised === undefined) return null;
  const levels = new Set(advertised.split(',').map((part) => part.trim()));
  const supported = PERSISTENT_EFFORTS.filter((level) => levels.has(level));
  if (supported.length === 0) return null;

  const environment = context.runner.readNativeConfigurationEnvironment?.() ?? null;
  // A custom root is not guessed. This initial path only manages the standard user scope.
  const path = context.fs.join(context.paths.home, '.claude', 'settings.json');
  const observation: NativeEffortObservation = {
    harnessVersion: version,
    supported: [...supported],
    current: null,
    source: 'native-cli+filesystem',
    verification: 'config-only',
    writable: false,
    reason: 'The native configuration environment was not observed',
    path,
    files: [],
    environment,
  };
  if (environment === null) return observation;
  if (
    environment.claudeConfigDirectory !== null ||
    environment.claudeEffortOverridden ||
    environment.claudeModelOverridden ||
    environment.claudeBackendOverridden
  ) {
    observation.reason =
      'A custom Claude root, effort/model environment or backend override is present; leave it untouched';
    return observation;
  }

  const paths = [path];
  let directory = context.projectRoot;
  let depth = 0;
  while (true) {
    paths.push(
      context.fs.join(directory, '.claude', 'settings.json'),
      context.fs.join(directory, '.claude', 'settings.local.json'),
    );
    const parent = context.fs.dirname(directory);
    if (parent === directory || parent === '') break;
    if (++depth > 64) {
      observation.reason = 'The settings hierarchy exceeds the inspection bound';
      return observation;
    }
    directory = parent;
  }
  let blocked: string | null = null;
  for (const file of [...new Set(paths)]) {
    try {
      const stat = await context.fs.stat(file);
      if (stat === null) {
        observation.files.push({ path: file, digest: null });
        continue;
      }
      if (stat.kind !== 'file' || stat.byteLength > MAX_SETTINGS_BYTES) {
        blocked = 'A settings document cannot be safely inspected';
        break;
      }
      const bytes = await context.fs.readFile(file);
      if (bytes.length > MAX_SETTINGS_BYTES) {
        blocked = 'A settings document is too large';
        break;
      }
      observation.files.push({ path: file, digest: digestBytes(bytes) });
      const parsed = parseJsonDocumentText(decoder.decode(bytes));
      if (parsed.state !== 'parsed' || !record(parsed.document)) {
        blocked = 'A settings document is malformed or contains unsupported comments';
        break;
      }
      const settings = parsed.document;
      if (settings['alwaysThinkingEnabled'] === false || hasEffortEnvironment(settings)) {
        blocked = 'A settings-level thinking, model or backend override is present';
        break;
      }
      if (file !== path && Object.hasOwn(settings, 'effortLevel')) {
        blocked = 'A project or local effort preference takes precedence; leave it untouched';
        break;
      }
      if (file === path && Object.hasOwn(settings, 'effortLevel')) {
        const value = settings['effortLevel'];
        if (typeof value !== 'string' || !supported.includes(value as (typeof supported)[number])) {
          blocked = 'The user effort preference is not a reviewed persistent value';
          break;
        }
        observation.current = value;
      }
    } catch {
      blocked = 'A settings document could not be read safely';
      break;
    }
  }
  observation.writable = blocked === null;
  observation.reason =
    blocked ??
    'Only the persisted user preference is observed; managed policy and running-session overrides may still take precedence';
  return observation;
}

export function planClaudeNativeEffort(
  observation: NativeEffortObservation | null | undefined,
  recommended: string | null,
): { actions: MergeJsonAction[]; diagnostics: Diagnostic[] } {
  const issue = (code: string, message: string) => ({
    actions: [],
    diagnostics: [
      diagnostic({
        severity: 'info',
        code,
        subject: 'claude',
        message,
        remediation:
          'Use Claude /effort for the current session, or inspect token-harness context --harness claude',
      }),
    ],
  });
  if (observation === null || observation === undefined) {
    return issue(
      'claude-native-policy-unavailable',
      'This Claude CLI version has no reviewed native-effort settings path',
    );
  }
  if (!observation.writable || observation.environment === null) {
    return issue('claude-native-policy-blocked', observation.reason);
  }
  if (recommended === null || recommended === observation.current)
    return { actions: [], diagnostics: [] };
  if (!observation.supported.includes(recommended)) {
    return issue(
      'claude-native-effort-unsupported',
      'The recommendation is not a persistent effort supported by the observed CLI',
    );
  }
  return {
    actions: [
      {
        kind: 'merge-json',
        id: 'claude-native-effort:' + recommended,
        riskClass: 'reversible',
        requiresNetwork: false,
        requiresElevation: false,
        affectedPaths: [observation.path],
        affectedProcesses: ['claude'],
        preconditions: [
          'Observed Claude version, environment and settings documents are unchanged',
        ],
        postconditions: [
          'User effortLevel=' + recommended + '; active-session effect is not claimed',
        ],
        rollbackData: 'file-snapshot',
        explanation:
          'Set Claude user effort preference to ' +
          recommended +
          '; reopen Claude and inspect /effort. Managed or session overrides may still win.',
        path: observation.path,
        ownedPointers: ['effortLevel'],
        createIfMissing: true,
        operations: [
          {
            kind: 'set',
            pointer: 'effortLevel',
            value: recommended,
            expectedValueDigest:
              observation.current === null ? null : jsonValueDigest(observation.current),
          },
        ],
        claudeEffortGuard: {
          version: observation.harnessVersion,
          environment: observation.environment,
          files: observation.files,
        },
      },
    ],
    diagnostics: [],
  };
}

/** Restore only journal-owned effort preferences; never remove a user's manual replacement. */
export function planClaudeNativeEffortRemoval(
  journals: readonly TransactionJournal[],
  userSettingsPath: string,
): RemoveOwnedChangeAction[] {
  const history: OwnedJsonEntryRecord[] = [];
  for (const journal of journals) {
    if (journal.outcome !== 'committed') continue;
    for (const entry of [...journal.entries].reverse()) {
      if (entry.actionId === 'remove:claude-native-effort' && entry.status === 'applied') {
        // An earlier lifecycle has already been removed. Do not resurrect its ownership.
        if (history.length === 0) return [];
        return removal(history, userSettingsPath);
      }
      if (!entry.actionId.startsWith('claude-native-effort:')) continue;
      for (const artifact of entry.ownership) {
        if (
          artifact.kind === 'owned-json-entry' &&
          artifact.path === userSettingsPath &&
          artifact.pointer === 'effortLevel' &&
          artifact.placement === 'value'
        )
          history.push(artifact);
      }
    }
  }
  return removal(history, userSettingsPath);
}

function removal(
  history: readonly OwnedJsonEntryRecord[],
  path: string,
): RemoveOwnedChangeAction[] {
  const first = history[0];
  if (first === undefined) return [];
  const target = { ...first };
  // Follow only an unbroken chain of our writes; a manual intervening choice is a boundary.
  for (const prior of history.slice(1)) {
    if (
      target.previousEffortValue === undefined ||
      jsonValueDigest(target.previousEffortValue) !== prior.valueDigest
    )
      break;
    if (prior.previousEffortValue === undefined) delete target.previousEffortValue;
    else target.previousEffortValue = prior.previousEffortValue;
  }
  return [
    {
      kind: 'remove-owned-change',
      id: 'remove:claude-native-effort',
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: [path],
      affectedProcesses: ['claude'],
      preconditions: ['The effort preference still matches the recorded managed value'],
      postconditions: ['Only the journal-owned effort preference is restored or removed'],
      rollbackData: 'file-snapshot',
      target,
      path,
      reverses: 'claude-native-effort',
      explanation: 'Restore the user effort preference from before the managed policy',
    },
  ];
}
