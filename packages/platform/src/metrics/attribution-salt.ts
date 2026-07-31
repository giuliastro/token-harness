/**
 * The machine-local salt RFC 0005 §Privacy requires for `projectId`.
 *
 * "`projectId` is a local stable hash with a machine-local salt." *Stable* means the salt
 * must outlive the process, so it is a file; *machine-local* means it must never be shipped
 * with the tool or derived from anything a second machine could reproduce, so it is random.
 *
 * ## Why writing this is not a read-only violation
 *
 * RFC 0004 §Command behavior makes `doctor` and `status` read-only, and a file appearing on
 * first run looks like a breach of that. It is not, because the state root itself is
 * provisioned at startup — created, and its ACL verified — before any command runs. The salt
 * is provisioned in the same step, for the same reason: it is part of making the state
 * directory usable, not part of what a command does with it.
 *
 * What would be a violation is a command touching a *harness's* configuration, or the
 * project, and this touches neither.
 */

import { randomBytes } from 'node:crypto';

import {
  isUsableSalt,
  PROJECT_SALT_BYTES,
  type Diagnostic,
  type FileSystemPort,
  diagnostic,
} from '@token-harness/core';

/** File name inside the state root. Named for what it is, so nobody edits it by mistake. */
export const SALT_FILE_NAME = 'attribution-salt';

export interface AttributionSaltResolution {
  /** The salt, or null when one could not be established. */
  salt: string | null;
  diagnostics: Diagnostic[];
}

/**
 * Reads the salt, creating one when there is none.
 *
 * A salt that exists but is unusable — truncated to zero bytes by a crash, or edited — is
 * replaced rather than trusted. `isUsableSalt` is what draws that line, and the reason is in
 * `core`: a short salt is worse than no salt, because it looks like one. Replacing it
 * changes every `projectId` on the machine, so it is reported rather than done silently.
 */
export async function resolveAttributionSalt(
  fs: FileSystemPort,
  stateRoot: string,
): Promise<AttributionSaltResolution> {
  const path = fs.join(stateRoot, SALT_FILE_NAME);
  const diagnostics: Diagnostic[] = [];

  let existing: string | null = null;
  if ((await fs.stat(path)) !== null) {
    try {
      existing = new TextDecoder().decode(await fs.readFile(path)).trim();
    } catch {
      existing = null;
    }
  }

  if (existing !== null && isUsableSalt(existing)) {
    return { salt: existing, diagnostics };
  }

  if (existing !== null) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'attribution-salt-replaced',
        message:
          'The project attribution salt was unusable and has been replaced, so project identifiers in new events will not match older ones',
        path,
        remediation:
          'Nothing to do; reports grouped by project may show a split before and after this point',
      }),
    );
  }

  const salt = randomBytes(PROJECT_SALT_BYTES).toString('hex');
  try {
    // `0600` where it means something. On Windows the state root's ACL is what protects
    // this, and RFC 0004 §State directory permissions has already verified it.
    await fs.writeFile(path, new TextEncoder().encode(`${salt}\n`), '0600');
  } catch (error) {
    // A salt that cannot be persisted must not be used: it would make every `projectId`
    // change on the next run, and a report grouped by project would fragment silently.
    return {
      salt: null,
      diagnostics: [
        ...diagnostics,
        diagnostic({
          severity: 'warning',
          code: 'attribution-salt-unwritable',
          message: `The project attribution salt could not be stored, so metrics cannot be attributed to a project: ${error instanceof Error ? error.message : String(error)}`,
          path,
          remediation: 'Check that the Token Harness state directory is writable',
        }),
      ],
    };
  }

  return { salt, diagnostics };
}
