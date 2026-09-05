import { NodeFileSystem, resolveHostEnvironment } from '@token-harness/platform';

export interface ScheduleHandoffObserverInput {
  handoffFile: string;
}

/**
 * Measure the exact byte length of the current handoff file for `schedule`.
 *
 * The content is never decoded, logged, persisted, or returned. This adapter exists only at the
 * host boundary so schedule policy stays filesystem-independent.
 */
export async function observeScheduleHandoffBytes(
  input: ScheduleHandoffObserverInput,
): Promise<number | null> {
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) return null;

  const fs = new NodeFileSystem(resolution.environment.facts);
  const stat = await fs.stat(input.handoffFile);
  if (stat === null || stat.kind !== 'file') return null;

  try {
    const content = await fs.readFile(input.handoffFile);
    return content.byteLength;
  } catch {
    return null;
  }
}
