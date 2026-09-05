/**
 * Golden files for both renderings — PLAN §1.3.
 *
 * "Human output is golden-compared, not only JSON."
 *
 * The five RFC 0006 §Golden path transcripts are independent scenarios, each
 * with its own fixture tree under `tests/fixtures/golden/<name>/`. They are not
 * one session and must not be read as consistent with each other.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { serializeEnvelope, toEnvelope, type CommandResult } from '@token-harness/core';
import { renderHuman } from 'token-harness';

import { listGoldenScenarios, loadGolden, normalizeGolden } from '../src/index.js';

/** The transcripts RFC 0006 §Golden path declares, in document order. */
const RFC_SCENARIOS = [
  'doctor-installed-unwired',
  'plan-clean',
  'plan-brownfield-conflict',
  'verify-managed-and-adopted',
  'metrics-week',
];

describe('golden files', () => {
  it('covers every RFC 0006 golden-path transcript', () => {
    const present = listGoldenScenarios();
    for (const name of RFC_SCENARIOS) {
      assert.ok(present.includes(name), `missing golden scenario ${name}`);
    }
    const rfcSourced = present.filter(
      (name) => loadGolden(name).scenario.source === 'RFC 0006 §Golden path',
    );
    assert.deepEqual(
      rfcSourced.sort(),
      [...RFC_SCENARIOS].sort(),
      'the set of RFC-sourced golden scenarios changed',
    );
  });

  for (const name of listGoldenScenarios()) {
    describe(name, () => {
      const golden = loadGolden(name);
      const { scenario, result } = golden;
      const normalizeOptions = {
        toolVersion: scenario.toolVersion,
        home: scenario.roots.home,
        stateRoot: scenario.roots.stateRoot,
        projectRoot: scenario.roots.projectRoot,
      };

      it('renders the human transcript', () => {
        const rendering = renderHuman(result as CommandResult<unknown>, {
          toolVersion: scenario.toolVersion,
          home: scenario.roots.home,
          decorate: false,
          verbose: true,
        });
        assert.equal(
          normalizeGolden(rendering.report, normalizeOptions),
          normalizeGolden(golden.expectedText, normalizeOptions),
        );
      });

      it('renders the JSON envelope', () => {
        const serialized = serializeEnvelope(
          toEnvelope(result as CommandResult<unknown>, scenario.toolVersion),
        );
        assert.equal(
          normalizeGolden(serialized, normalizeOptions),
          normalizeGolden(golden.expectedJson, normalizeOptions),
        );
      });

      it('agrees with the envelope on the exit code', () => {
        const envelope = toEnvelope(result as CommandResult<unknown>, scenario.toolVersion);
        assert.equal(envelope.exitCode, result.exitCode);
      });
    });
  }
});
