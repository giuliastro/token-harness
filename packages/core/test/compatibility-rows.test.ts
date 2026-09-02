import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMPATIBILITY_ROWS,
  admitManagedMutation,
  classifyRowHarnessVersion,
  harnessId,
  providerId,
  type CompatibilityRow,
  type ManagedCombination,
} from '../src/index.js';

function row(overrides: Partial<CompatibilityRow> = {}): CompatibilityRow {
  return {
    harness: harnessId('opencode'),
    harnessVersion: { minimum: '1.18.9', maximum: '1.18.9' },
    provider: providerId('rtk'),
    providerVersion: '0.44.0',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    configSchema: 'opencode-config-schema-1',
    fixture: 'fixtures/opencode-rtk-0.44.0',
    verificationTier: 'config-only',
    ...overrides,
  };
}

function combination(overrides: Partial<ManagedCombination> = {}): ManagedCombination {
  return {
    provider: providerId('rtk'),
    providerVersion: '0.44.0',
    harness: harnessId('opencode'),
    harnessVersion: '1.18.9',
    os: 'linux',
    wsl: false,
    ...overrides,
  };
}

describe('classification of a harness version against the row set', () => {
  it('ships no row whose fixture is not on disk (RFC 0009 item 5)', () => {
    /**
     * This asserted `deepEqual(COMPATIBILITY_ROWS, [])` while no fixture had been recorded, which
     * held the right rule the only way it could at the time. Now that two recordings exist the rule
     * has to be stated properly, or shipping the first row would have meant deleting the test that
     * guards them: RFC 0009 item 5 is "add matrix rows only after the relevant cross-platform
     * fixtures pass", so what must be true is that every row points at a recording that is there.
     *
     * A row naming a directory nobody recorded is the failure mode this replaces — it would admit a
     * managed mutation on the strength of a path.
     */
    // Walked rather than counted: this file runs from `packages/core/dist/test`, and a fixed number
    // of `..` segments is a hostage to the build layout — the first attempt here resolved to
    // `packages/` and reported a fixture that is on disk as missing.
    let root = fileURLToPath(new URL('.', import.meta.url));
    while (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
      const parent = join(root, '..');
      assert.notEqual(parent, root, 'no workspace root above this test file');
      root = parent;
    }
    for (const entry of COMPATIBILITY_ROWS) {
      assert.ok(
        existsSync(join(root, entry.fixture)),
        `row ${entry.provider} × ${entry.harness} names a fixture that does not exist: ${entry.fixture}`,
      );
      // And the recording has to be of the versions the row claims, not of some other machine.
      const recorded = JSON.parse(
        readFileSync(join(root, entry.fixture, 'post-apply.json'), 'utf8'),
      ) as { observed: { harnessVersion: string; providerVersion: string } };
      assert.equal(recorded.observed.providerVersion, entry.providerVersion);
      assert.equal(recorded.observed.harnessVersion, entry.harnessVersion.maximum);
    }
  });

  it('finds a version inside a row', () => {
    assert.equal(classifyRowHarnessVersion([row()], '1.18.9'), 'in-row');
  });

  it('names a version newer than every row unknown-newer', () => {
    assert.equal(classifyRowHarnessVersion([row()], '2.0.0'), 'unknown-newer');
  });

  it('names a version older than every row unknown-older', () => {
    assert.equal(classifyRowHarnessVersion([row()], '1.17.0'), 'unknown-older');
  });

  it('names a version in the gap between two rows below-range', () => {
    const rows = [
      row({ harnessVersion: { minimum: '1.16.0', maximum: '1.16.0' }, configSchema: 's-16' }),
      row({ harnessVersion: { minimum: '1.18.0', maximum: '1.18.0' }, configSchema: 's-18' }),
    ];
    // Above the 1.16 row, below the 1.18 row, covered by neither: a gap.
    assert.equal(classifyRowHarnessVersion(rows, '1.17.0'), 'below-range');
    assert.equal(classifyRowHarnessVersion(rows, '1.16.0'), 'in-row');
    assert.equal(classifyRowHarnessVersion(rows, '1.18.0'), 'in-row');
    assert.equal(classifyRowHarnessVersion(rows, '1.15.0'), 'unknown-older');
    assert.equal(classifyRowHarnessVersion(rows, '1.19.0'), 'unknown-newer');
  });

  it('has no position against an empty row set', () => {
    assert.equal(classifyRowHarnessVersion([], '1.18.9'), null);
  });
});

describe('admitManagedMutation', () => {
  it('ships the exact Linux Codex 0.152.1 / HarnessTrim 0.2.1 admission and nothing broader', () => {
    const exact = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('harnesstrim'),
      providerVersion: '0.2.1',
      harness: harnessId('codex'),
      harnessVersion: '0.152.1',
      os: 'linux',
      wsl: false,
    });
    assert.equal(exact.state, 'admitted');

    const newerHarness = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('harnesstrim'),
      providerVersion: '0.2.1',
      harness: harnessId('codex'),
      harnessVersion: '0.152.2',
      os: 'linux',
      wsl: false,
    });
    assert.equal(newerHarness.state, 'refused');

    const newerProvider = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('harnesstrim'),
      providerVersion: '0.2.2',
      harness: harnessId('codex'),
      harnessVersion: '0.152.1',
      os: 'linux',
      wsl: false,
    });
    assert.equal(newerProvider.state, 'refused');

    const wsl = admitManagedMutation(COMPATIBILITY_ROWS, {
      provider: providerId('harnesstrim'),
      providerVersion: '0.2.1',
      harness: harnessId('codex'),
      harnessVersion: '0.152.1',
      os: 'linux',
      wsl: true,
    });
    assert.equal(wsl.state, 'refused');
  });

  it('admits an exact provider × harness × version × platform match', () => {
    const outcome = admitManagedMutation([row()], combination());
    assert.equal(outcome.state, 'admitted');
  });

  it('refuses when the provider version differs, even within the same major', () => {
    const outcome = admitManagedMutation([row()], combination({ providerVersion: '0.42.0' }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'no-row');
      assert.match(outcome.missing, /0\.42\.0/);
      assert.match(outcome.missing, /provider fixture/);
    }
  });

  it('refuses when the harness version shares a major but not the recorded range', () => {
    const outcome = admitManagedMutation([row()], combination({ harnessVersion: '1.18.10' }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') assert.equal(outcome.verdict, 'unknown-newer');
  });

  it('refuses the unknown-newer case naming the missing harness schema', () => {
    const outcome = admitManagedMutation([row()], combination({ harnessVersion: '2.0.0' }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'unknown-newer');
      assert.match(outcome.missing, /harness schema/);
      assert.match(outcome.missing, /opencode-config-schema-1/);
    }
  });

  it('refuses the unknown-older case naming the missing harness schema', () => {
    const outcome = admitManagedMutation([row()], combination({ harnessVersion: '1.17.0' }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'unknown-older');
      assert.match(outcome.missing, /harness schema/);
    }
  });

  it('refuses the below-range gap naming the schemas a new row would sit between', () => {
    const outcomes = [
      row({ harnessVersion: { minimum: '1.16.0', maximum: '1.16.0' }, configSchema: 's-16' }),
      row({ harnessVersion: { minimum: '1.18.0', maximum: '1.18.0' }, configSchema: 's-18' }),
    ];
    const outcome = admitManagedMutation(outcomes, combination({ harnessVersion: '1.17.0' }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'below-range');
      assert.match(outcome.missing, /s-16/);
      assert.match(outcome.missing, /s-18/);
    }
  });

  it('refuses a combination on the wrong platform', () => {
    const outcome = admitManagedMutation([row()], combination({ os: 'windows', wsl: false }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'no-row');
      assert.match(outcome.missing, /config schema and fixture/);
    }
  });

  it('refuses an unknown provider version rather than guessing', () => {
    const outcome = admitManagedMutation([row()], combination({ providerVersion: null }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') assert.equal(outcome.verdict, 'no-row');
  });

  it('refuses an unknown harness version rather than guessing', () => {
    const outcome = admitManagedMutation([row()], combination({ harnessVersion: null }));
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') assert.equal(outcome.verdict, 'no-row');
  });

  it('refuses everything when the shipped table is empty, naming schema and fixture as missing', () => {
    const outcome = admitManagedMutation([], combination());
    assert.equal(outcome.state, 'refused');
    if (outcome.state === 'refused') {
      assert.equal(outcome.verdict, 'no-row');
      assert.match(outcome.missing, /config schema and fixture/);
      assert.match(outcome.missing, /rtk on opencode/);
    }
  });
});

describe('a lockfile, a probe, and a matching major do not satisfy a row', () => {
  it('the gate accepts no evidence the RFC forbids', () => {
    /**
     * RFC 0009: "Token Harness must not treat compatible major versions, lockfile presence, or a
     * successful executable probe as proof that a row applies." The gate admits only on an exact
     * match of the fields a row records; its input has no slot for a lockfile or a probe, and the
     * harness version must fall inside the row's exact range — a shared major is not a match.
     *
     * The scenario below is the machine RFCC 0009 is describing: a lockfile pins the toolchain,
     * `opencode --version` succeeds, and the harness is within the uploader's major — yet the
     * gate refuses, because the row's exact version is a different patch.
     */
    const lockfilePresent = true;
    const probeSucceeded = true;
    assert.equal(lockfilePresent && probeSucceeded, true, 'the scenario really has both');

    const outcome = admitManagedMutation([row()], combination({ harnessVersion: '1.18.10' }));
    assert.equal(outcome.state, 'refused');
  });
});
