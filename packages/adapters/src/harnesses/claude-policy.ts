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
  const version =
    versionResult.failure === null && versionResult.exitCode === 0 && !versionResult.stdoutTruncated
      ? /\b(\d+\.\d+\.\d+)\b/.exec(versionResult.stdout)?.[1]
      : undefined;
  const environment = context.runner.readNativeConfigurationEnvironment?.() ?? null;
  const path = context.fs.join(context.paths.home, '.claude', 'settings.json');
  const observation: NativeEffortObservation = {
    harnessVersion: version ?? 'unknown',
    supported: [],
    current: null,
    preferenceState: 'unreadable',
    preferenceReason: 'The user preference has not been read.',
    source: 'native-cli+filesystem',
    verification: 'config-only',
    writable: false,
    writeBlock: null,
    reason: '',
    path,
    files: [],
    environment,
  };
  const block = (code: NonNullable<NativeEffortObservation['writeBlock']>, reason: string) => {
    // Keep the first reason a change is not admissible. Readability is reported separately.
    if (observation.writeBlock === null) {
      observation.writeBlock = code;
      observation.reason = reason;
    }
  };

  // Exact-version admission belongs to mutation, not observation. A newer CLI must not
  // hide a readable saved preference or be silently admitted for writes by reading it.
  if (version === undefined) {
    block(
      'cli',
      'The Claude version could not be checked. Use /effort inside Claude to change it.',
    );
  } else if (!REVIEWED_VERSIONS.has(version)) {
    block(
      'version',
      'Claude ' +
        version +
        ' is not reviewed for automatic preference changes. Readable user settings are still shown.',
    );
  } else {
    const help = await context.runner.run({ ...request, args: ['--help'] });
    if (help.failure === null && help.exitCode === 0 && !help.stdoutTruncated) {
      const advertised = /--effort\s+<level>[\s\S]{0,120}?\(([^)]+)\)/.exec(help.stdout)?.[1];
      const levels = new Set(advertised?.split(',').map((part) => part.trim()) ?? []);
      observation.supported = PERSISTENT_EFFORTS.filter((level) => levels.has(level));
    }
    if (observation.supported.length === 0)
      block(
        'cli',
        'This Claude CLI did not expose the reviewed effort controls. Use /effort inside Claude.',
      );
  }
  if (environment === null) {
    observation.preferenceReason =
      'The Claude configuration environment could not be inspected, so the user settings location is not confirmed.';
    block('environment', observation.preferenceReason);
    return observation;
  }
  if (environment.claudeConfigDirectory !== null) {
    observation.preferenceReason =
      'Claude uses a custom configuration location. This reader does not inspect that location.';
    block('custom-root', observation.preferenceReason);
    return observation;
  }
  if (
    environment.claudeEffortOverridden ||
    environment.claudeModelOverridden ||
    environment.claudeBackendOverridden
  )
    block(
      'override',
      'A Claude environment override is present. The saved user preference may not be the level used by your session.',
    );

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
      block(
        'settings',
        'The settings hierarchy exceeds the inspection bound. No change is allowed.',
      );
      break;
    }
    directory = parent;
  }
  for (const file of [...new Set(paths)]) {
    const userFile = file === path;
    try {
      const stat = await context.fs.stat(file);
      if (stat === null) {
        observation.files.push({ path: file, digest: null });
        if (userFile) {
          observation.preferenceState = 'unset';
          observation.preferenceReason =
            'No user settings file exists. The active model default or other settings may apply.';
        }
        continue;
      }
      if (stat.kind !== 'file' || stat.byteLength > MAX_SETTINGS_BYTES)
        throw new Error('unreadable settings');
      const bytes = await context.fs.readFile(file);
      if (bytes.length > MAX_SETTINGS_BYTES) throw new Error('oversized settings');
      observation.files.push({ path: file, digest: digestBytes(bytes) });
      const parsed = parseJsonDocumentText(decoder.decode(bytes));
      if (parsed.state !== 'parsed' || !record(parsed.document))
        throw new Error('unsupported settings document');
      const settings = parsed.document;
      if (userFile) {
        if (!Object.hasOwn(settings, 'effortLevel')) {
          observation.preferenceState = 'unset';
          observation.preferenceReason =
            'No effort preference is saved in the user settings. A model default or another settings layer may apply.';
        } else {
          const value = settings['effortLevel'];
          if (typeof value === 'string' && PERSISTENT_EFFORTS.some((level) => level === value)) {
            observation.current = value;
            observation.preferenceState = 'configured';
            observation.preferenceReason =
              'Read from Claude user settings. Project, organization, environment or session overrides may still apply.';
          } else {
            observation.preferenceState = 'unreadable';
            observation.preferenceReason =
              'The saved effort value is not a recognized persistent level. It was left unchanged.';
            block('settings', observation.preferenceReason);
          }
        }
      }
      if (settings['alwaysThinkingEnabled'] === false || hasEffortEnvironment(settings))
        block(
          'override',
          'A settings-level thinking, model or backend override is present. The saved effort is not proof of the active session level.',
        );
      if (!userFile && Object.hasOwn(settings, 'effortLevel'))
        block(
          'override',
          'A project or local effort preference takes precedence. Change it in Claude or in that project, not in the global user preference.',
        );
    } catch {
      if (userFile) {
        observation.preferenceState = 'unreadable';
        observation.preferenceReason =
          'The user settings could not be read safely: inaccessible, malformed, oversized, or using unsupported comments.';
      }
      block(
        'settings',
        'A settings document could not be safely inspected. Check Claude settings before changing the preference.',
      );
      break;
    }
  }
  // A readable but unreviewed value must never become a writable target.
  if (observation.current !== null && !observation.supported.includes(observation.current))
    block(
      'cli',
      'The installed CLI does not advertise the saved effort level for managed changes.',
    );
  observation.writable = observation.writeBlock === null;
  if (observation.writable)
    observation.reason =
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
