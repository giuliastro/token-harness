/** Harness-native hook entries used by the Token Harness prompt router. */
import { parseSemanticVersion, type HarnessId, type JsonValue } from '@token-harness/core';

/** Patch releases use the documented event schema; this is config support, not a live receipt. */
export function nativePromptRoutingVersionSupported(
  harness: HarnessId,
  version: string | null,
): boolean {
  const parsed = version === null ? null : parseSemanticVersion(version);
  if (parsed === null || parsed.prerelease !== null) return false;
  return harness === 'codex'
    ? parsed.major === 0 &&
        ((parsed.minor === 159 && parsed.patch <= 1) ||
          (parsed.minor === 160 && parsed.patch === 0))
    : harness === 'claude' &&
        parsed.major === 2 &&
        parsed.minor === 1 &&
        parsed.patch >= 274 &&
        parsed.patch <= 288;
}

export const NATIVE_PROMPT_ROUTING_EVENTS = [
  { eventName: 'UserPromptSubmit', commandEvent: 'prompt-submit' },
  { eventName: 'SubagentStart', commandEvent: 'subagent-start' },
  { eventName: 'SubagentStop', commandEvent: 'subagent-stop' },
] as const;

export interface NativePromptRoutingHookEntry {
  eventName: (typeof NATIVE_PROMPT_ROUTING_EVENTS)[number]['eventName'];
  value: JsonValue;
}

/**
 * Build the native per-event entry shape. Paths, Windows launch fields, and handler schemas belong
 * to these harness adapters; the CLI only appends the returned values to their declared config.
 */
export function nativePromptRoutingHookEntries(
  harness: HarnessId,
  executable = 'token-harness',
  platform: 'windows' | 'macos' | 'linux' = 'linux',
): NativePromptRoutingHookEntry[] {
  return NATIVE_PROMPT_ROUTING_EVENTS.map(({ eventName, commandEvent }) => {
    if (harness === 'codex') {
      const command = `${executable} __internal-prompt-router codex ${commandEvent}`;
      const handler: Record<string, JsonValue> = {
        type: 'command',
        command,
        commandWindows: command,
        timeout: 10,
      };
      if (commandEvent === 'prompt-submit') handler['additionalContextLimit'] = 500;
      return { eventName, value: { hooks: [handler] } };
    }

    // npm's .cmd shim cannot be CreateProcess'd by Claude's exec form on Windows.
    // Shell form resolves the shim through the native shell; arguments are fixed literals.
    const handler: Record<string, JsonValue> =
      platform === 'windows'
        ? {
            type: 'command',
            command: `${executable} __internal-prompt-router claude ${commandEvent}`,
            timeout: 10,
          }
        : {
            type: 'command',
            command: executable,
            args: ['__internal-prompt-router', 'claude', commandEvent],
            timeout: 10,
          };
    return { eventName, value: { hooks: [handler] } };
  });
}
