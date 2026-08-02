/**
 * The state-root permission property — RFC 0004 §State directory permissions.
 *
 * "The tests assert the property, not the call":
 *
 * - on POSIX, stat and assert the mode;
 * - on Windows, parse the effective ACL and assert the ACE set, including a fixture
 *   with a widened inherited ACL that must be rejected.
 *
 * The Windows branch is exercised on all three platforms through
 * `FakeProcessRunner`, which stands in for `icacls` and `whoami`, plus a real
 * end-to-end pass that runs only on native Windows and does use the real ones. The
 * fake covers the ACL states a CI runner cannot be put into; the real pass proves
 * the fake is describing the right commands.
 */

import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import {
  FakeProcessRunner,
  NodeProcessRunner,
  createExecutableResolver,
  ensureStateRoot,
  extractSecurityDescriptor,
  nodeExecutableProbe,
} from '../src/index.js';

const NATIVE_WINDOWS = process.platform === 'win32';
const POSIX_ONLY = NATIVE_WINDOWS ? 'POSIX only' : false;
const WINDOWS_ONLY = NATIVE_WINDOWS ? false : 'native Windows only';

const POSIX_FACTS: PlatformFacts = {
  os: process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const WINDOWS_FACTS: PlatformFacts = { ...POSIX_FACTS, os: 'windows', isWsl: false };

const OWNER_SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-state-'));
});

after(() => {
  // POSIX fixtures deliberately exercise restrictive modes. Repair every directory before Node
  // descends into it for cleanup; making only the sandbox traversable is insufficient.
  if (!NATIVE_WINDOWS) {
    const restoreTraversal = (path: string): void => {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        if (statSync(child).isDirectory()) restoreTraversal(child);
      }
    };
    restoreTraversal(sandbox);
  }
  rmSync(sandbox, { recursive: true, force: true });
});

function freshPath(): string {
  counter += 1;
  return join(sandbox, `root-${String(counter)}`);
}

/**
 * A fake `icacls`/`whoami` pair.
 *
 * The `/save` expectation writes the descriptor to the path icacls was asked to
 * write it to, which is what lets the Windows read-back path run unchanged on Linux
 * and macOS.
 */
function windowsRunner(sddl: string | null, options: { whoami?: boolean } = {}) {
  const runner = new FakeProcessRunner();
  runner.expect({
    executable: 'whoami',
    respond:
      options.whoami === false ? { exitCode: 1 } : { stdout: `"DEV\\dev","${OWNER_SID}"\r\n` },
  });
  runner.expect({
    executable: 'icacls',
    args: (args) => args.includes('/grant:r'),
    respond: { exitCode: 0 },
  });
  runner.expect({
    executable: 'icacls',
    args: (args) => args.includes('/save'),
    respond: (request) => {
      if (sddl === null) return { exitCode: 1, stderr: 'Access is denied.' };
      const target = request.args[request.args.indexOf('/save') + 1];
      if (target !== undefined) writeFileSync(target, `root\n${sddl}\n`, 'utf8');
      return { exitCode: 0 };
    },
  });
  return runner;
}

describe('POSIX', { skip: POSIX_ONLY }, () => {
  it('creates the directory at mode 0700 and asserts the mode afterwards', async () => {
    const path = freshPath();
    const runner = new FakeProcessRunner();
    const result = await ensureStateRoot({ path, facts: POSIX_FACTS, runner, create: true });
    assert.equal(result.status.verdict, 'ok');
    assert.equal(result.status.posixMode, '0700');
    assert.deepEqual(result.diagnostics, []);
    // The property, read back from the filesystem rather than from what we asked for.
    assert.equal(statSync(path).mode & 0o777, 0o700);
    // Nothing was spawned: a fake with no matching expectation throws, so reaching
    // here is the assertion that POSIX never shells out.
    assert.equal(runner.calls.length, 0);
  });

  it('is independent of the umask, which is why chmod follows mkdir', async () => {
    const previous = process.umask(0o000);
    try {
      const path = freshPath();
      const result = await ensureStateRoot({
        path,
        facts: POSIX_FACTS,
        runner: new FakeProcessRunner(),
        create: true,
      });
      assert.equal(result.status.posixMode, '0700');
      assert.equal(statSync(path).mode & 0o777, 0o700);
    } finally {
      process.umask(previous);
    }
  });

  it('creates missing parents', async () => {
    const path = join(sandbox, 'deep', 'nested', 'state');
    const result = await ensureStateRoot({
      path,
      facts: POSIX_FACTS,
      runner: new FakeProcessRunner(),
      create: true,
    });
    assert.equal(result.status.verdict, 'ok');
  });

  it('is idempotent', async () => {
    const path = freshPath();
    const request = { path, facts: POSIX_FACTS, runner: new FakeProcessRunner(), create: true };
    assert.equal((await ensureStateRoot(request)).status.verdict, 'ok');
    assert.equal((await ensureStateRoot(request)).status.verdict, 'ok');
    assert.equal(statSync(path).mode & 0o777, 0o700);
  });

  it('reports an absent directory as absent when creation was not requested', async () => {
    const result = await ensureStateRoot({
      path: freshPath(),
      facts: POSIX_FACTS,
      runner: new FakeProcessRunner(),
      create: false,
    });
    assert.equal(result.status.verdict, 'absent');
    assert.deepEqual(result.diagnostics, []);
  });

  const modes: ReadonlyArray<readonly [number, boolean]> = [
    [0o700, true],
    [0o500, true],
    [0o000, true],
    [0o750, false],
    [0o755, false],
    [0o707, false],
    [0o701, false],
  ];

  for (const [mode, expectedOk] of modes) {
    it(`mode ${mode.toString(8).padStart(4, '0')} ${expectedOk ? 'satisfies' : 'violates'} the invariant`, async () => {
      const path = freshPath();
      mkdirSync(path);
      chmodSync(path, mode);
      const result = await ensureStateRoot({
        path,
        facts: POSIX_FACTS,
        runner: new FakeProcessRunner(),
        create: true,
      });
      // The asserted property is "no group or other bits", not "exactly 0700": a
      // directory at 0500 denies every additional principal just as well.
      assert.equal(result.status.verdict, expectedOk ? 'ok' : 'permissions-unexpected');
      if (!expectedOk) {
        assert.equal(result.diagnostics[0]?.code, 'state-directory-permissions-unexpected');
        assert.equal(result.diagnostics[0]?.severity, 'error');
        assert.equal(result.diagnostics[0]?.path, path);
      }
    });
  }

  it('reports a wrong mode rather than repairing it', async () => {
    const path = freshPath();
    mkdirSync(path);
    chmodSync(path, 0o755);
    await ensureStateRoot({
      path,
      facts: POSIX_FACTS,
      runner: new FakeProcessRunner(),
      create: true,
    });
    // RFC 0004 §Post-apply drift: "Drift is reported, never silently repaired."
    assert.equal(statSync(path).mode & 0o777, 0o755);
  });

  it('reports a path that exists as a file as unverifiable', async () => {
    const path = freshPath();
    writeFileSync(path, 'not a directory');
    const result = await ensureStateRoot({
      path,
      facts: POSIX_FACTS,
      runner: new FakeProcessRunner(),
      create: true,
    });
    assert.equal(result.status.verdict, 'unverifiable');
    assert.equal(result.diagnostics[0]?.code, 'state-directory-unverifiable');
  });
});

describe('the Windows ACL path, on every platform', () => {
  const CORRECT = `O:${OWNER_SID}G:${OWNER_SID}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;${OWNER_SID})`;
  const INHERITED_CORRECT = `O:${OWNER_SID}D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${OWNER_SID})`;
  const WIDENED = `O:${OWNER_SID}D:AI(A;OICIID;FA;;;WD)(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${OWNER_SID})`;

  it('creates the directory, applies an explicit DACL by SID, and reads it back', async () => {
    const path = freshPath();
    const runner = windowsRunner(CORRECT);
    const result = await ensureStateRoot({ path, facts: WINDOWS_FACTS, runner, create: true });

    assert.equal(result.status.verdict, 'ok');
    assert.equal(
      result.status.posixMode,
      null,
      'the mode carries no access information on Windows',
    );
    assert.equal(result.status.inheritanceBlocked, true);
    assert.deepEqual(result.diagnostics, []);

    const grant = runner.calls.find((call) => call.args.includes('/grant:r'));
    assert.notEqual(grant, undefined);
    assert.ok(grant?.args.includes('/inheritance:r'), 'inheritance must be detached');
    assert.ok(grant?.args.includes(`*${OWNER_SID}:(OI)(CI)(F)`));
    assert.ok(grant?.args.includes('*S-1-5-18:(OI)(CI)(F)'));
    assert.ok(grant?.args.includes('*S-1-5-32-544:(OI)(CI)(F)'));
  });

  it('rejects a widened inherited ACL and names the offending principal', async () => {
    const path = freshPath();
    mkdirSync(path);
    const result = await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner(WIDENED),
      create: false,
    });
    assert.equal(result.status.verdict, 'permissions-unexpected');
    assert.deepEqual(result.status.unexpectedPrincipals, ['WD']);
    assert.equal(result.diagnostics[0]?.code, 'state-directory-permissions-unexpected');
    assert.equal(result.diagnostics[0]?.severity, 'error');
    assert.match(result.diagnostics[0]?.message ?? '', /WD/);
  });

  it('accepts an inherited ACL with permitted principals, and warns that it is inherited', async () => {
    const path = freshPath();
    mkdirSync(path);
    const result = await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner(INHERITED_CORRECT),
      create: false,
    });
    assert.equal(result.status.verdict, 'ok');
    assert.equal(result.status.inheritanceBlocked, false);
    // A warning, not an error: warnings do not contribute to the exit code, and the
    // principals — which are what the invariant is about — are correct.
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]?.code, 'state-directory-inheritance-not-blocked');
    assert.equal(result.diagnostics[0]?.severity, 'warning');
  });

  it('does not touch the directory, or run anything, when it is absent and creation was not requested', async () => {
    const runner = windowsRunner(CORRECT);
    const result = await ensureStateRoot({
      path: freshPath(),
      facts: WINDOWS_FACTS,
      runner,
      create: false,
    });
    assert.equal(result.status.verdict, 'absent');
    assert.equal(runner.calls.length, 0);
  });

  it('fails rather than proceeding when the current user SID cannot be determined', async () => {
    const path = freshPath();
    mkdirSync(path);
    const result = await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner(CORRECT, { whoami: false }),
      create: false,
    });
    assert.equal(result.status.verdict, 'unverifiable');
    assert.equal(result.diagnostics[0]?.code, 'state-directory-unverifiable');
  });

  it('fails rather than proceeding when the ACL cannot be read', async () => {
    const path = freshPath();
    mkdirSync(path);
    const result = await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner(null),
      create: false,
    });
    // RFC 0004: "or the ACL cannot be read, Token Harness fails with the
    // unsupported-environment code rather than continuing into a location whose
    // protection it has not verified."
    assert.equal(result.status.verdict, 'unverifiable');
  });

  it('fails rather than proceeding when the descriptor cannot be parsed', async () => {
    const path = freshPath();
    mkdirSync(path);
    const result = await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner('this is not a security descriptor'),
      create: false,
    });
    assert.equal(result.status.verdict, 'unverifiable');
  });

  it('leaves no snapshot file behind', async () => {
    const path = freshPath();
    mkdirSync(path);
    await ensureStateRoot({
      path,
      facts: WINDOWS_FACTS,
      runner: windowsRunner(CORRECT),
      create: false,
    });
    assert.equal(
      statSync(`${path}.acl-${String(process.pid)}`, { throwIfNoEntry: false }),
      undefined,
    );
  });
});

describe('icacls /save decoding', () => {
  it('picks the descriptor line out of the saved file', () => {
    assert.equal(
      extractSecurityDescriptor('TokenHarness\r\nD:PAI(A;OICI;FA;;;SY)\r\n'),
      'D:PAI(A;OICI;FA;;;SY)',
    );
  });

  it('returns null when there is no descriptor', () => {
    assert.equal(extractSecurityDescriptor('TokenHarness\r\n'), null);
  });
});

describe('native Windows, end to end with the real icacls', { skip: WINDOWS_ONLY }, () => {
  function realRunner(facts: PlatformFacts) {
    return new NodeProcessRunner({
      facts,
      env: process.env,
      resolve: createExecutableResolver({
        facts,
        env: process.env,
        cwd: sandbox,
        probe: nodeExecutableProbe(),
      }),
    });
  }

  it('creates a state root whose effective ACL satisfies the invariant', async () => {
    const facts: PlatformFacts = {
      os: 'windows',
      osDisplayName: 'Windows',
      arch: 'x64',
      nodeVersion: process.versions.node,
      isWsl: false,
    };
    const path = freshPath();
    const result = await ensureStateRoot({ path, facts, runner: realRunner(facts), create: true });
    assert.equal(result.status.verdict, 'ok', JSON.stringify(result.diagnostics));
    assert.equal(result.status.inheritanceBlocked, true);
  });

  it('rejects the same directory once Everyone is granted read', async () => {
    const facts: PlatformFacts = {
      os: 'windows',
      osDisplayName: 'Windows',
      arch: 'x64',
      nodeVersion: process.versions.node,
      isWsl: false,
    };
    const runner = realRunner(facts);
    const path = freshPath();
    assert.equal(
      (await ensureStateRoot({ path, facts, runner, create: true })).status.verdict,
      'ok',
    );

    // `*S-1-1-0` is Everyone. Granted by SID so the test is not localised either.
    const widen = await runner.run({
      executable: 'icacls',
      args: [path, '/grant', '*S-1-1-0:(OI)(CI)(R)', '/Q'],
      cwd: sandbox,
    });
    assert.equal(widen.exitCode, 0, widen.stderr);

    const result = await ensureStateRoot({ path, facts, runner, create: false });
    assert.equal(result.status.verdict, 'permissions-unexpected');
    assert.ok(result.status.unexpectedPrincipals.length > 0);
    assert.equal(result.diagnostics[0]?.code, 'state-directory-permissions-unexpected');
  });
});
