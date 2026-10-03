/** Harness-native hook entries used by the Token Harness prompt router. */
import type { HarnessId, JsonValue } from '@token-harness/core';

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

    const handler: Record<string, JsonValue> = {
      type: 'command',
      command: executable,
      args: ['__internal-prompt-router', 'claude', commandEvent],
      timeout: 10,
    };
    return { eventName, value: { hooks: [handler] } };
  });
}
