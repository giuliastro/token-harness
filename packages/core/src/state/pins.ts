/**
 * Provider version pins — RFC 0004 §Provider update policy and §Amended: a pin is global at
 * `0.1.0`, and a project pin waits for repository trust.
 *
 * ## Why this is read-only
 *
 * RFC 0001's command surface declares nine commands and none of them is `pin`. A pin is therefore
 * configuration the user writes, not state Token Harness manages, and this module reads it. Adding
 * a writer would put a tenth command in the build without an RFC declaring it — and a pin written
 * by the tool whose updates it restrains is a strange thing to offer before anyone has asked for it.
 *
 * ## Why a project pin is found and refused rather than ignored
 *
 * §Repository trust: "project-local provider manifests or filters are untrusted by default. Before
 * they can influence installation or execution, the user must trust the repository." A version pin
 * influences installation by construction, and no trust mechanism exists in this build — so
 * honoring one would let any cloned repository choose which version of a tool the user runs.
 *
 * Silently ignoring it would be just as wrong in the other direction: someone wrote that file
 * expecting it to matter. So it is read, reported as unhonored, and not obeyed.
 */

import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import { parseSemanticVersion } from '../domain/version.js';
import type { FileSystemPort } from './filesystem.js';

export const PIN_SCHEMA_VERSION = 1;

/** `<state>/pins.json`, and the project counterpart this build reports but does not honor. */
export const PIN_FILE_NAME = 'pins.json';
export const PROJECT_PIN_PATH = ['.token-harness', PIN_FILE_NAME];

export interface ProviderPin {
  provider: string;
  /** An exact version. A range would be a policy, and a pin is a decision. */
  version: string;
}

export interface PinSet {
  /** Honored pins, by provider id. */
  pins: Map<string, string>;
  /** A project pin file that was found and deliberately not applied. Null when there was none. */
  unhonoredProjectPinPath: string | null;
  diagnostics: Diagnostic[];
}

interface RawPinFile {
  schemaVersion?: unknown;
  pins?: unknown;
}

function parsePins(raw: unknown, path: string, diagnostics: Diagnostic[]): ProviderPin[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'pin-file-unreadable',
        message: `${path} is not a pin document, so no pin from it is applied`,
        remediation: `Write it as {"schemaVersion": ${String(PIN_SCHEMA_VERSION)}, "pins": [{"provider": "rtk", "version": "0.42.0"}]}`,
      }),
    );
    return [];
  }

  const file = raw as RawPinFile;
  if (file.schemaVersion !== PIN_SCHEMA_VERSION) {
    /**
     * An unknown schema version is refused, not read optimistically.
     *
     * A pin is a restraint the user asked for. Reading a document this build does not understand
     * and applying whatever happened to parse is the way a restraint silently becomes narrower or
     * wider than what was written.
     */
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'pin-schema-unsupported',
        message: `${path} declares schema version ${String(file.schemaVersion ?? 'none')}; this build reads ${String(PIN_SCHEMA_VERSION)}`,
        remediation: 'Update Token Harness, or rewrite the file at the supported schema version',
      }),
    );
    return [];
  }

  if (!Array.isArray(file.pins)) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'pin-file-unreadable',
        message: `${path} has no \`pins\` array`,
        remediation: 'Add a `pins` array, or remove the file',
      }),
    );
    return [];
  }

  const pins: ProviderPin[] = [];
  for (const entry of file.pins) {
    if (typeof entry !== 'object' || entry === null) continue;
    const provider = (entry as { provider?: unknown }).provider;
    const version = (entry as { version?: unknown }).version;
    if (typeof provider !== 'string' || provider === '') continue;
    if (typeof version !== 'string' || parseSemanticVersion(version) === null) {
      // Named rather than dropped: a pin whose version is a typo would otherwise look like no pin
      // at all, and the user would watch the provider update anyway with nothing explaining it.
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'pin-version-unparseable',
          message: `The pin for ${provider} in ${path} does not name a semantic version, so it is not applied`,
          remediation: `Write an exact version, for example "0.42.0"`,
        }),
      );
      continue;
    }
    pins.push({ provider, version });
  }
  return pins;
}

async function readJson(
  fs: FileSystemPort,
  path: string,
  diagnostics: Diagnostic[],
): Promise<unknown | undefined> {
  const stat = await fs.stat(path);
  if (stat === null) return undefined;
  const bytes = await fs.readFile(path);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'pin-file-unreadable',
        message: `${path} is not valid JSON, so no pin from it is applied`,
        remediation: 'Fix the syntax, or remove the file',
      }),
    );
    return undefined;
  }
}

export interface ReadPinsInput {
  fs: FileSystemPort;
  /** The machine-global state directory, whose protection §Backup policy establishes. */
  stateRoot: string;
  projectRoot: string;
}

export async function readPins(input: ReadPinsInput): Promise<PinSet> {
  const diagnostics: Diagnostic[] = [];
  const globalPath = input.fs.join(input.stateRoot, PIN_FILE_NAME);
  const raw = await readJson(input.fs, globalPath, diagnostics);
  const pins = new Map<string, string>();
  if (raw !== undefined) {
    for (const pin of parsePins(raw, globalPath, diagnostics)) {
      pins.set(pin.provider, pin.version);
    }
  }

  const projectPath = input.fs.join(input.projectRoot, ...PROJECT_PIN_PATH);
  const projectStat = await input.fs.stat(projectPath);
  let unhonoredProjectPinPath: string | null = null;
  if (projectStat !== null) {
    unhonoredProjectPinPath = projectPath;
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'project-pin-not-honored',
        message: `${projectPath} pins a provider version, and this build does not honor a project pin`,
        remediation:
          'Move the pin to the machine-global pin file if you want it applied. A project pin needs the repository-trust mechanism RFC 0004 requires before a repository may influence which version you run.',
      }),
    );
  }

  return { pins, unhonoredProjectPinPath, diagnostics };
}
