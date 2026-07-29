/**
 * End-to-end goldens for the Phase 1 shell.
 *
 * These are project-local, not RFC-pinned: RFC 0006 §Golden path has no
 * transcript for an empty environment, for `status`, or for `--help`. They exist
 * so that the shape of the output with empty registries is a reviewed artifact
 * rather than whatever the code happens to print, and they are expected to
 * change when Phase 3 registers the first adapter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { captureRun, listCliScenarios, loadCliScenario, normalizeGolden } from '../src/index.js';

describe('cli shell goldens', () => {
  for (const name of listCliScenarios()) {
    it(name, async () => {
      const { scenario, expectedStdout, expectedStderr } = loadCliScenario(name);
      const actual = await captureRun({
        argv: scenario.argv,
        platform: scenario.platform,
        cwd: scenario.roots.projectRoot ?? 'C:\\work\\demo',
        home: scenario.roots.home,
        stateRoot: scenario.roots.stateRoot,
        env: {},
        stdoutIsTty: false,
        toolVersion: scenario.toolVersion,
      });

      const options = {
        toolVersion: scenario.toolVersion,
        home: scenario.roots.home,
        stateRoot: scenario.roots.stateRoot,
        projectRoot: scenario.roots.projectRoot,
      };

      assert.equal(actual.exitCode, scenario.expectedExitCode, 'exit code');
      assert.equal(
        normalizeGolden(actual.stdout, options),
        normalizeGolden(expectedStdout, options),
        'stdout',
      );
      assert.equal(
        normalizeGolden(actual.stderr, options),
        normalizeGolden(expectedStderr, options),
        'stderr',
      );
    });
  }

  it('has at least one scenario per Phase 1 command', () => {
    const names = listCliScenarios();
    for (const expected of ['doctor-empty', 'plan-empty', 'status-empty', 'help-root', 'version']) {
      assert.ok(names.includes(expected), `missing cli scenario ${expected}`);
    }
  });
});
