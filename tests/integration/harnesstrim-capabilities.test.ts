/**
 * PLAN §15 item 43a — the write set `harnesstrim capabilities` declares, as a fixture.
 *
 * RFC 0002 requires a *reviewed* write set for a delegated install, and reviewing it by hand is
 * what pinned `delegatedInstallReview.upstreamVersion` to one release. The machine-readable
 * declaration does not remove the review; it turns it into a fixture that compares the declaration
 * against what an apply actually wrote. The fixture is the exact output of `harnesstrim
 * capabilities` at the recorded version, committed under `tests/fixtures/providers/`.
 *
 * These tests fail when upstream changes what it declares it writes — which is the point: a
 * reviewed write set that stopped matching the installer is drift no amount of hand-review reading
 * catches on its own.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  claudeAdapter,
  compareCapabilities,
  harnesstrimAdapter,
  type HarnessTrimCapabilities,
  type ProviderContext,
} from '@token-harness/adapters';
import type { FileStat, PlatformFacts } from '@token-harness/core';
import { FakeProcessRunner } from '@token-harness/platform';
import { FIXTURES_ROOT } from '@token-harness/tests';

const FIXTURE = JSON.parse(
  readFileSync(`${FIXTURES_ROOT}providers/harnesstrim-capabilities.json`, 'utf8'),
) as HarnessTrimCapabilities;

const FACTS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11 Pro',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

function context(runner: FakeProcessRunner): ProviderContext {
  return {
    fs: {
      join: (...parts) => parts.join('\\'),
      dirname: (path) => path.slice(0, path.lastIndexOf('\\')),
      basename: (path) => path.slice(path.lastIndexOf('\\') + 1),
      isInside: (candidate, parent) => candidate.startsWith(parent),
      stat: (): Promise<FileStat | null> => Promise.resolve(null),
      readFile: () => Promise.resolve(new TextEncoder().encode('')),
      writeFile: () => Promise.reject(new Error('read-only test port')),
      appendFile: () => Promise.reject(new Error('read-only test port')),
      createDirectory: () => Promise.reject(new Error('read-only test port')),
      remove: () => Promise.reject(new Error('read-only test port')),
      readDirectory: () => Promise.resolve([]),
    },
    runner,
    facts: FACTS,
    paths: {
      home: 'C:\\Users\\dev',
      config: 'C:\\Users\\dev\\cfg',
      data: 'C:\\Users\\dev\\data',
      state: 'C:\\Users\\dev\\state',
      cache: 'C:\\Users\\dev\\cache',
    },
    projectRoot: 'C:\\work\\demo',
    harnessConfigs: [],
    now: () => '2026-08-04T12:00:00.000Z',
    localDatabase: null,
    projectIdFor: () => 'p_test',
  };
}

describe('the harnesstrim capabilities fixture', () => {
  it('is the declaration the manifest review was made against', () => {
    // The fixture is the recorded upstream output; compareCapabilities runs the same comparison
    // detection performs live. This branch of the fixture test is what fails when the committed
    // snapshot stops matching the manifest — before any user has the newer build installed.
    const warnings = compareCapabilities(harnesstrimAdapter.manifest, FIXTURE);
    assert.deepEqual(
      warnings.map((warning) => warning.message),
      [],
    );
  });

  it('declares a claude write set that covers every reviewed path and sits in the boundary', () => {
    const review = harnesstrimAdapter.manifest.delegatedInstallReview;
    assert.ok(review);
    const claude = FIXTURE.harnesses['claude'];
    assert.ok(claude);

    const declared = claude.writeSet.map((entry) =>
      entry.replace(/\s*\([^)]*\)\s*$/, '').replaceAll('\\', '/'),
    );
    for (const reviewed of review.reviewedWriteSet) {
      assert.ok(
        declared.some(
          (entry) =>
            reviewed === entry || reviewed.startsWith(entry.endsWith('/') ? entry : `${entry}/`),
        ),
        `reviewed path ${reviewed} is not covered by the declared claude write set`,
      );
    }
    for (const entry of declared) {
      assert.ok(
        review.containmentBoundary.some(
          (boundary) => entry === boundary || entry.startsWith(`${boundary}/`),
        ),
        `declared write-set path ${entry} sits outside the containment boundary`,
      );
    }
  });

  it('is what an apply writes: the reviewed plan writes exactly the fixture-declared Claude skills', async () => {
    // The skills-only invocation writes exactly the reviewed write set. The fixture is the
    // machine-readable version of that declaration at the recorded upstream version, so the two
    // must name the same paths — "declaration against what an apply actually wrote".
    const review = harnesstrimAdapter.manifest.delegatedInstallReview;
    assert.ok(review);

    const runner = new FakeProcessRunner()
      .expect({ executable: 'harnesstrim', args: ['--version'], respond: { stdout: '0.0.7' } })
      .expect({
        executable: 'harnesstrim',
        args: ['capabilities'],
        respond: { stdout: JSON.stringify(FIXTURE) },
      });

    const result = await harnesstrimAdapter.plan(context(runner), {
      ownership: [],
      harnesses: [claudeAdapter.manifest],
      desiredState: 'configured',
    });
    const action = result.actions[0];
    assert.ok(action !== undefined && action.kind === 'delegated-provider-install');

    const written = action.expectedArtifacts.map((artifact) =>
      artifact.path.replaceAll('\\', '/').replace(/^.*?\.claude\//, '.claude/'),
    );
    assert.deepEqual(written, review.reviewedWriteSet);

    // And every path apply writes is inside the fixture-declared claude write set.
    const declared = FIXTURE.harnesses['claude']?.writeSet.map((entry) =>
      entry.replace(/\s*\([^)]*\)\s*$/, '').replaceAll('\\', '/'),
    );
    assert.ok(declared);
    for (const path of written) {
      assert.ok(
        declared.some(
          (entry) => path === entry || path.startsWith(entry.endsWith('/') ? entry : `${entry}/`),
        ),
        `apply writes ${path}, which the declared write set does not cover`,
      );
    }
  });

  it('leaves detection silent against the fixture declaration', async () => {
    const runner = new FakeProcessRunner()
      .expect({ executable: 'harnesstrim', args: ['--version'], respond: { stdout: '0.1.0' } })
      .expect({
        executable: 'harnesstrim',
        args: ['capabilities'],
        respond: { stdout: JSON.stringify(FIXTURE) },
      });

    const detection = await harnesstrimAdapter.detect(context(runner));
    assert.equal(detection.state, 'installed');
    assert.equal(
      detection.warnings.some((warning) => warning.code === 'provider-capabilities-drift'),
      false,
    );
  });
});
