/**
 * The two inputs `update` needs before it can plan anything — RFC 0004 §Provider update policy and
 * §Amended.
 *
 * Version discovery and pins are tested here rather than through the command, because both are
 * decisions about *what the machine said* and the command is where those decisions turn into
 * actions. The winget fixture below is captured verbatim from a real `winget show` run, localized
 * header included, which is the whole reason the parser is anchored where it is.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  knownPackageManagers,
  knownVersionQueryChannels,
  queryAvailableVersion,
  readPins,
  type FileStat,
  type FileSystemPort,
  type ProcessOutcome,
  type ProcessRunner,
} from '../src/index.js';

/**
 * Verbatim from `winget show --id rtk-ai.rtk --exact --versions` on an Italian Windows install.
 *
 * The header says `Versione`, not `Version`. A parser keyed on that word would have worked on the
 * machine of whoever wrote it and silently reported nothing everywhere else, which is why the real
 * output is the fixture rather than a tidied version of it.
 */
const WINGET_ITALIAN = [
  'Trovato rtk [rtk-ai.rtk]',
  'Versione',
  '--------',
  '0.44.0',
  '0.43.0',
  '0.42.4',
  '',
].join('\r\n');

/** The same table as an English install would print it. Only the header differs. */
const WINGET_ENGLISH = WINGET_ITALIAN.replace('Versione', 'Version').replace(
  'Trovato rtk',
  'Found rtk',
);

function runner(result: Partial<ProcessOutcome>): { commands: string[]; runner: ProcessRunner } {
  const commands: string[] = [];
  return {
    commands,
    runner: {
      run(request) {
        commands.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
          ...result,
        });
      },
    },
  };
}

describe('asking a channel what version it has', () => {
  it('reads the newest version out of a localized winget table', async () => {
    const { commands, runner: process } = runner({ stdout: WINGET_ITALIAN });
    const outcome = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });

    assert.equal(outcome.status, 'found');
    assert.equal(outcome.version, '0.44.0');
    assert.deepEqual(commands, ['winget show --id rtk-ai.rtk --exact --versions']);
  });

  it('reads the English table identically', async () => {
    // The point of the parser: the separator line and the body are the same in both, so the answer
    // must be too. If this ever diverges from the test above, the parser has grown a dependency on
    // a translated word.
    const { runner: process } = runner({ stdout: WINGET_ENGLISH });
    const outcome = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.version, '0.44.0');
  });

  it('reads a pnpm answer, which is a version and nothing else', async () => {
    // Verified against the machine: `pnpm view harnesstrim version` → `0.0.6`.
    const { commands, runner: process } = runner({ stdout: '0.0.6\n' });
    const outcome = await queryAvailableVersion({
      packageManager: 'pnpm',
      packageName: 'harnesstrim',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'found');
    assert.equal(outcome.version, '0.0.6');
    assert.deepEqual(commands, ['pnpm view harnesstrim version']);
  });

  it('answers `unknown` rather than guessing when the table shape is not the one verified', async () => {
    // No separator line: a future winget, or a different subcommand. Reading further down and
    // hoping would be reading an unknown format.
    const { runner: process } = runner({ stdout: 'Versione: 0.44.0\r\n' });
    const outcome = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'unknown');
    assert.equal(outcome.version, null);
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'version-query-unreadable'));
  });

  it('distinguishes a channel it cannot ask from one that answered badly', async () => {
    const { runner: process } = runner({});
    const unsupported = await queryAvailableVersion({
      packageManager: 'homebrew',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    // `unsupported` and `unknown` are different answers, and the row `update` builds from them says
    // different things. Collapsing them printed "the channel did not report a version" about a
    // channel that was never invoked.
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.destination, null);
    assert.ok(unsupported.diagnostics.some((entry) => entry.code === 'version-query-unsupported'));
  });

  it('reports the destination it reached, even when the answer was useless', async () => {
    const { runner: process } = runner({ stdout: 'nothing parseable' });
    const outcome = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    // RFC 0004 §Network policy: the disclosure covers what was reached, not what came back.
    assert.equal(outcome.destination, 'winget package index');
  });

  it('marks the unverified channel as unverified', async () => {
    const { runner: process } = runner({ stdout: 'rtk = "0.42.0"    # a proxy\n' });
    const outcome = await queryAvailableVersion({
      packageManager: 'cargo',
      packageName: 'rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.version, '0.42.0');
    // Parsed, and still flagged: the form is cargo's documented one and has not been observed.
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'version-query-unverified'));
  });

  it('fails rather than reporting a version when the channel could not run', async () => {
    const { runner: process } = runner({
      exitCode: null,
      failure: { reason: 'executable-not-found', message: 'missing' },
    });
    const outcome = await queryAvailableVersion({
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      runner: process,
      cwd: '/work',
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.version, null);
  });

  it('can ask more channels than it can install through, on purpose', () => {
    /**
     * The asymmetry is the assertion, because a test demanding the two match would force an
     * unverified pnpm install argv into the build to satisfy it.
     *
     * A query is a read; an install is a mutation. `pnpm view <pkg> version` was verified against
     * the machine, a global pnpm install was not, and RFC 0003 records that HarnessTrim — the
     * provider whose channel is pnpm — "is not installed by Token Harness at all". So nothing
     * needs the install side today.
     *
     * What must hold is the other direction: anything installable must be queryable, or `update`
     * could not report on a provider `plan` had installed.
     */
    assert.deepEqual(knownPackageManagers(), ['cargo', 'winget']);
    assert.deepEqual(knownVersionQueryChannels(), ['cargo', 'pnpm', 'winget']);
    for (const manager of knownPackageManagers()) {
      assert.ok(knownVersionQueryChannels().includes(manager), manager);
    }
  });
});

/** A filesystem holding exactly the files a case needs, and nothing else. */
function files(entries: Readonly<Record<string, string>>): FileSystemPort {
  const encoder = new TextEncoder();
  const stat: FileStat = { kind: 'file', byteLength: 0, mode: null };
  return {
    join: (...segments) => segments.join('/'),
    dirname: (path) => path.slice(0, path.lastIndexOf('/')),
    basename: (path) => path.slice(path.lastIndexOf('/') + 1),
    isInside: (candidate, parent) => candidate.startsWith(parent),
    stat: (path) => Promise.resolve(path in entries ? stat : null),
    readFile: (path) => Promise.resolve(encoder.encode(entries[path] ?? '')),
    writeFile: () => Promise.reject(new Error('read-only in this test')),
    appendFile: () => Promise.reject(new Error('read-only in this test')),
    createDirectory: () => Promise.reject(new Error('read-only in this test')),
    remove: () => Promise.reject(new Error('read-only in this test')),
    readDirectory: () => Promise.resolve([]),
  };
}

const STATE = '/state';
const PROJECT = '/project';

describe('pins', () => {
  it('reads a global pin', async () => {
    const set = await readPins({
      fs: files({
        '/state/pins.json': JSON.stringify({
          schemaVersion: 1,
          pins: [{ provider: 'rtk', version: '0.42.0' }],
        }),
      }),
      stateRoot: STATE,
      projectRoot: PROJECT,
    });
    assert.equal(set.pins.get('rtk'), '0.42.0');
    assert.deepEqual(set.diagnostics, []);
  });

  it('is empty and quiet when there is no pin file', async () => {
    const set = await readPins({ fs: files({}), stateRoot: STATE, projectRoot: PROJECT });
    assert.equal(set.pins.size, 0);
    // No pin file is the ordinary case, not a finding.
    assert.deepEqual(set.diagnostics, []);
  });

  it('finds a project pin, reports it, and does not honor it', async () => {
    const set = await readPins({
      fs: files({
        '/project/.token-harness/pins.json': JSON.stringify({
          schemaVersion: 1,
          pins: [{ provider: 'rtk', version: '0.1.0' }],
        }),
      }),
      stateRoot: STATE,
      projectRoot: PROJECT,
    });

    /**
     * RFC 0004 §Repository trust: a project-local file may not influence installation before the
     * repository is trusted, and no trust mechanism exists in this build. Honoring this would let
     * any cloned repository choose which version of a tool the user runs.
     */
    assert.equal(set.pins.size, 0);
    assert.equal(set.unhonoredProjectPinPath, '/project/.token-harness/pins.json');
    assert.ok(set.diagnostics.some((entry) => entry.code === 'project-pin-not-honored'));
  });

  it('refuses a schema version it does not know instead of reading it optimistically', async () => {
    const set = await readPins({
      fs: files({
        '/state/pins.json': JSON.stringify({
          schemaVersion: 99,
          pins: [{ provider: 'rtk', version: '0.42.0' }],
        }),
      }),
      stateRoot: STATE,
      projectRoot: PROJECT,
    });
    // A pin is a restraint. Applying whatever happened to parse out of an unknown document is how a
    // restraint silently becomes something other than what was written.
    assert.equal(set.pins.size, 0);
    assert.ok(set.diagnostics.some((entry) => entry.code === 'pin-schema-unsupported'));
  });

  it('names a pin whose version is a typo rather than dropping it', async () => {
    const set = await readPins({
      fs: files({
        '/state/pins.json': JSON.stringify({
          schemaVersion: 1,
          pins: [
            { provider: 'rtk', version: 'lastest' },
            { provider: 'harnesstrim', version: '0.0.6' },
          ],
        }),
      }),
      stateRoot: STATE,
      projectRoot: PROJECT,
    });
    // Silently dropping it would look identical to no pin at all, and the user would watch the
    // provider update anyway with nothing explaining why.
    assert.equal(set.pins.has('rtk'), false);
    assert.equal(set.pins.get('harnesstrim'), '0.0.6');
    assert.ok(set.diagnostics.some((entry) => entry.code === 'pin-version-unparseable'));
  });

  it('says so when the file is not JSON', async () => {
    const set = await readPins({
      fs: files({ '/state/pins.json': '{ this is not json' }),
      stateRoot: STATE,
      projectRoot: PROJECT,
    });
    assert.equal(set.pins.size, 0);
    assert.ok(set.diagnostics.some((entry) => entry.code === 'pin-file-unreadable'));
  });
});
