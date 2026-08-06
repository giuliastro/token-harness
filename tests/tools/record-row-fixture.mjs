/**
 * Records one stage of a compatibility-row fixture — RFC 0009 §Compatibility matrix, PLAN §15 item 44.
 *
 * ## Why a recorder exists at all
 *
 * A row is evidence. RFC 0009 lists what its fixture must cover, and the list is not something a
 * reviewer can produce by reading code: an empty configuration, a hand-configured brownfield
 * installation, the exact post-apply configuration, an update that invalidates the row, user drift
 * after apply, and rollback with user-owned entries preserved. Each is a *state of a real machine*,
 * and the only honest way to get one is to put a machine in that state and write down what is there.
 *
 * AGENTS.md forbids installing third-party software during tests, so the recording and the testing
 * are deliberately separate steps. This script records; the committed artifacts are what the suite
 * then exercises offline, on every platform in CI, forever.
 *
 * ## Why it records one stage per run rather than driving all six
 *
 * Two of the six are human by definition. "A hand-configured brownfield installation" means a user
 * configured it by hand, and "user drift after apply" means a user changed it afterwards — a script
 * that produced those would be recording its own idea of what a user does. So the operator moves the
 * machine between stages and runs this once per stage, and the stage name is an argument rather than
 * a loop.
 *
 * The post-apply stage has a further wrinkle worth stating: `apply` refuses a managed mutation that
 * no row admits, and the row is what this fixture is for. The way through is the injected row the
 * integration suites already use (`RunOptions.compatibilityRows`) — a provisional row is scaffolding
 * for the recording, and the reviewed row that ships cites the artifact it produced. Recording the
 * state that the *upstream* installer writes is equally valid where the managed plan delegates to it,
 * which is the case for HarnessTrim.
 *
 * ## Secrets
 *
 * Harness configuration holds API keys. This script copies configuration verbatim, because a fixture
 * with the values filed off no longer exercises the parser it exists to exercise — so it refuses to
 * run without `--reviewed`, and it prints every value it captured that looks like a credential. That
 * list is for a human to read before committing. There is no automatic redaction, deliberately: a
 * filter that silently missed one would be worse than no filter, and a filter that caught one would
 * teach the operator to stop looking.
 *
 * Usage:
 *
 *   node tests/tools/record-row-fixture.mjs \
 *     --stage empty --harness claude --provider rtk \
 *     --project . --out tests/fixtures/rows/rtk-claude --reviewed
 *
 * Stages: empty, brownfield, post-apply, invalidating-update, drift, rollback.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * The states RFC 0009 requires a row's fixture to cover, in the order the RFC lists them.
 *
 * `uninstall` is separate from `rollback` because the two do different things and only one of them
 * matches the RFC's phrase "rollback *and uninstall* with user-owned entries preserved". `rollback`
 * is whole-file time travel to the pre-apply snapshot — its own help says "anything you changed in
 * those files since the apply is inside the snapshot too and goes back with it" — so it discards
 * user drift by design. `uninstall` removes only what Token Harness owns. Recording one and calling
 * it both would file a fixture claiming preservation for the command that does not preserve.
 *
 * Found by recording the sequence on a real machine: rollback correctly threw away a hook the user
 * had added after the apply, which is right, and is not what the preservation clause is about.
 */
const STAGES = [
  'empty',
  'brownfield',
  'post-apply',
  'invalidating-update',
  'drift',
  'rollback',
  'uninstall',
];

/**
 * The configuration each harness keeps, and where.
 *
 * Duplicated from the harness manifests rather than imported: this script runs from a source
 * checkout against an *installed* build, and importing the workspace would make the recording
 * depend on the tree compiling. The paths are home- or project-relative exactly as the manifests
 * declare them, which is also why one recording stays valid across operating systems.
 */
const HARNESS_CONFIG = {
  claude: {
    home: ['.claude/settings.json', '.claude/settings.local.json', '.claude/skills'],
    project: ['.claude/settings.json', 'CLAUDE.md', '.claude/skills'],
    version: ['claude', '--version'],
  },
  codex: {
    home: ['.codex/hooks.json', '.codex/config.toml', '.codex/skills'],
    project: ['AGENTS.md', '.codex/skills', '.codex/hooks.json'],
    version: ['codex', '--version'],
  },
  opencode: {
    home: [
      '.config/opencode/opencode.jsonc',
      '.config/opencode/opencode.json',
      '.config/opencode/plugin',
      '.config/opencode/plugins',
    ],
    project: ['opencode.jsonc', 'opencode.json', '.opencode/plugin', '.opencode/plugins'],
    version: ['opencode', '--version'],
  },
};

/** Providers whose version belongs in the row. */
const PROVIDER_VERSION = {
  rtk: ['rtk', '--version'],
  harnesstrim: ['harnesstrim', '--version'],
};

/** Key names whose values get listed for review. Not a redaction list — a reading list. */
const SECRET_HINT = /key|token|secret|password|passwd|credential|auth|bearer|api[-_]?key/i;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (name === 'reviewed') {
      args.reviewed = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} needs a value`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

/**
 * Names to try for one executable, in order.
 *
 * Windows installs these tools as `.cmd` shims, and `execFileSync` runs an image directly — it
 * cannot execute a batch file. The first version of this used `shell: true` on win32, which worked
 * and earned a Node deprecation warning about unescaped argument concatenation. Naming the shim
 * extensions explicitly is both quieter and narrower: no shell is involved, so there is nothing to
 * escape.
 *
 * The bare name stays last so a POSIX machine, and a Windows one with a real executable, both work.
 */
function candidates(executable) {
  return process.platform === 'win32'
    ? [`${executable}.cmd`, `${executable}.exe`, executable]
    : [executable];
}

function versionOf(command) {
  const [executable, ...rest] = command;
  for (const candidate of candidates(executable)) {
    try {
      const stdout = execFileSync(candidate, rest, {
        encoding: 'utf8',
        timeout: 20_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(stdout);
      if (match?.[1] !== undefined) return match[1];
    } catch {
      // This spelling is not the one installed here. Try the next.
    }
  }
  // Not installed, or a build that rejects the flag. Both are facts about the machine, and a
  // recording that invented a version would be the one thing a row must never contain.
  return null;
}

/** A file or directory as the fixture records it: contents for a file, a listing for a directory. */
function capture(absolute) {
  const stat = fs.statSync(absolute, { throwIfNoEntry: false });
  if (stat === undefined) return { present: false };
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    return {
      present: true,
      kind: 'directory',
      // One level. A plugin directory's *entries* are the configuration — the modules inside are
      // upstream's code, not this project's fixture, and copying them would be vendoring.
      entries: entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file',
      })),
    };
  }
  return { present: true, kind: 'file', contents: fs.readFileSync(absolute, 'utf8') };
}

/** Every captured string value whose key looks like a credential, for the operator to read. */
function credentialCandidates(captured) {
  const found = [];
  for (const [label, record] of Object.entries(captured)) {
    if (record.kind !== 'file' || typeof record.contents !== 'string') continue;
    for (const [index, line] of record.contents.split('\n').entries()) {
      if (SECRET_HINT.test(line)) found.push(`${label}:${String(index + 1)}: ${line.trim()}`);
    }
  }
  return found;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { stage, harness, provider, project, out } = args;

  if (!STAGES.includes(stage)) {
    throw new Error(`--stage must be one of ${STAGES.join(', ')}`);
  }
  const config = HARNESS_CONFIG[harness];
  if (config === undefined) {
    throw new Error(`--harness must be one of ${Object.keys(HARNESS_CONFIG).join(', ')}`);
  }
  if (PROVIDER_VERSION[provider] === undefined) {
    throw new Error(`--provider must be one of ${Object.keys(PROVIDER_VERSION).join(', ')}`);
  }
  if (project === undefined || out === undefined) {
    throw new Error('--project and --out are both required');
  }
  if (args.reviewed !== true) {
    throw new Error(
      'Refusing to record without --reviewed. Harness configuration can hold API keys, and this ' +
        'script copies it verbatim: pass --reviewed to confirm you will read what it captured ' +
        'before committing it.',
    );
  }

  /**
   * `--home` records against an isolated home instead of the operator's own.
   *
   * It has to match whatever `apply-with-provisional-row.mjs` was given, because that is where the
   * post-apply state exists. Without it this reads the operator's real `~/.claude/settings.json`
   * and files their own configuration as the fixture for a state they never entered.
   *
   * Note for whoever picks the directory: RFC 0004 refuses a state root inside the system temporary
   * directory, so an isolated home under `/tmp` or `%TEMP%` will not resolve. That refusal is
   * correct, and it is how the first attempt here failed.
   */
  const home = args.home ?? os.homedir();
  const projectRoot = path.resolve(project);

  const captured = {};
  for (const relative of config.home) {
    captured[`~/${relative}`] = capture(path.join(home, relative));
  }
  for (const relative of config.project) {
    captured[`<project>/${relative}`] = capture(path.join(projectRoot, relative));
  }

  const record = {
    // The stage is the first field because it is what a reviewer checks first: a fixture filed
    // under the wrong stage describes a state nobody asked about.
    stage,
    harness,
    provider,
    observed: {
      // What the row will record. A null here is why a row cannot be written yet, not something
      // to fill in by hand later.
      harnessVersion: versionOf(config.version),
      providerVersion: versionOf(PROVIDER_VERSION[provider]),
      platform: {
        os:
          process.platform === 'win32'
            ? 'windows'
            : process.platform === 'darwin'
              ? 'macos'
              : 'linux',
        // WSL is a separate platform row, and `PlatformSupport` keeps the flag, so it is recorded
        // rather than folded into `linux`.
        wsl:
          process.platform === 'linux' &&
          fs.existsSync('/proc/version') &&
          /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')),
        arch: process.arch,
        nodeVersion: process.versions.node,
      },
    },
    configuration: captured,
  };

  const directory = path.resolve(out);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${stage}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  process.stdout.write(`recorded ${stage} to ${file}\n`);
  process.stdout.write(
    `  ${harness} ${String(record.observed.harnessVersion)} / ${provider} ${String(record.observed.providerVersion)} on ${record.observed.platform.os}${record.observed.platform.wsl ? ' (WSL)' : ''}\n`,
  );

  const present = Object.entries(captured).filter(([, value]) => value.present);
  process.stdout.write(
    `  captured ${String(present.length)} of ${String(Object.keys(captured).length)} declared locations\n`,
  );

  const candidates = credentialCandidates(captured);
  if (candidates.length > 0) {
    process.stdout.write(
      `\nREAD THESE BEFORE COMMITTING — ${String(candidates.length)} captured line(s) name something credential-shaped:\n`,
    );
    for (const line of candidates) process.stdout.write(`  ${line}\n`);
    process.stdout.write('\nNothing was redacted. Remove or replace anything real, then commit.\n');
  }

  const missing = STAGES.filter((entry) => !fs.existsSync(path.join(directory, `${entry}.json`)));
  process.stdout.write(
    missing.length === 0
      ? '\nAll six RFC 0009 stages are recorded here.\n'
      : `\nStill to record here: ${missing.join(', ')}\n`,
  );
}

main();
