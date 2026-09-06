/** Read-only, digest-bound persisted Claude policy identity for controlled task experiments. */
import {
  digestBytes,
  parseJsonDocumentText,
  type BenchmarkPolicySnapshot,
  type NativeEffortObservation,
} from '@token-harness/core';
import type { HarnessContext } from './contract.js';

const MAX_BYTES = 1024 * 1024;

export async function readClaudeBenchmarkPolicy(
  context: HarnessContext,
  effort: NativeEffortObservation | null,
): Promise<BenchmarkPolicySnapshot | null> {
  if (effort === null || !effort.writable || effort.current === null || effort.environment === null)
    return null;
  // Reuse the reviewed version/environment/hierarchy witness; never widen mutation admission.
  if (
    effort.environment.claudeConfigDirectory !== null ||
    effort.environment.claudeModelOverridden ||
    effort.environment.claudeEffortOverridden ||
    effort.environment.claudeBackendOverridden
  )
    return null;
  let model: string | null = null;
  try {
    for (const file of effort.files) {
      const stat = await context.fs.stat(file.path);
      if (stat === null) {
        if (file.digest !== null) return null;
        continue;
      }
      if (file.digest === null || stat.kind !== 'file' || stat.byteLength > MAX_BYTES) return null;
      const bytes = await context.fs.readFile(file.path);
      if (bytes.byteLength > MAX_BYTES || digestBytes(bytes) !== file.digest) return null;
      const parsed = parseJsonDocumentText(new TextDecoder().decode(bytes));
      if (
        parsed.state !== 'parsed' ||
        parsed.document === null ||
        Array.isArray(parsed.document) ||
        typeof parsed.document !== 'object'
      )
        return null;
      const settings = parsed.document;
      if (
        [
          'modelOverrides',
          'availableModels',
          'fallbackModel',
          'modelFallbacks',
          'apiKeyHelper',
        ].some((key) => Object.hasOwn(settings, key))
      )
        return null;
      if (!Object.hasOwn(settings, 'model')) continue;
      // A project selection or floating alias does not establish the user's fixed policy tuple.
      if (file.path !== effort.path) return null;
      const value = settings['model'];
      if (typeof value !== 'string' || !/^claude-[a-z0-9][a-z0-9.-]{0,120}$/.test(value))
        return null;
      model = value;
    }
  } catch {
    return null;
  }
  return model === null
    ? null
    : {
        model,
        reasoningEffort: effort.current,
        verbosity: null,
        verification: 'config-only',
      };
}
