/**
 * No rendered line may exceed 78 characters.
 *
 * This test exists because its absence was the whole defect. `plan` emitted 133-character lines,
 * `verify` 106, and diagnostics ran past 200 — all of which a terminal wraps mid-word, with no
 * indent, so a table stops looking like a table and reads as noise. It went unnoticed through
 * several rounds of "fixing the output" because every check was a human glancing at a wide terminal,
 * and because the golden fixtures happened to contain only short values.
 *
 * Two things are asserted, and the second is the one that would have caught it:
 *
 * 1. every line of every committed golden and CLI fixture fits;
 * 2. every line produced by rendering *adversarially long* data fits — a provider id, a path and a
 *    diagnostic message far longer than anything the fixtures contain.
 *
 * Character counts, not byte counts. An earlier measurement of this used `awk`, which counts bytes,
 * so every line containing an em-dash read three characters too wide and the numbers were wrong in
 * the direction that hides nothing but wastes time.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  commandResult,
  diagnostic,
  harnessId,
  providerId,
  type CommandResult,
  type DoctorReport,
  type PlatformFacts,
} from '@token-harness/core';
import { renderHuman } from 'token-harness';

import { CLI_ROOT, listGoldenScenarios, loadGolden } from '../src/index.js';

/** 80 columns is the floor for a terminal; 78 leaves room for a wrapping marker. */
const MAX_WIDTH = 78;

function widthOf(line: string): number {
  return [...line].length;
}

function assertFits(text: string, where: string): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const width = widthOf(line);
    assert.ok(
      width <= MAX_WIDTH,
      `${where} line ${String(index + 1)} is ${String(width)} characters:\n${line}`,
    );
  }
}

describe('nothing renders wider than a terminal', () => {
  it('holds for every committed golden transcript', () => {
    for (const name of listGoldenScenarios()) {
      const golden = loadGolden(name);
      assertFits(golden.expectedText, `golden/${name}/expected.txt`);
    }
  });

  it('holds for every committed CLI fixture', () => {
    for (const name of ['doctor-empty', 'help-root', 'plan-empty', 'status-empty', 'version']) {
      for (const stream of ['stdout.txt', 'stderr.txt']) {
        const path = join(CLI_ROOT, name, stream);
        let text = '';
        try {
          text = readFileSync(path, 'utf8');
        } catch {
          continue;
        }
        assertFits(text, `cli/${name}/${stream}`);
      }
    }
  });

  it('holds when the data is longer than any fixture', () => {
    /**
     * The case the fixtures cannot cover.
     *
     * Every committed transcript uses short ids and short messages, so a renderer that concatenates
     * without a width budget passes against all of them. This feeds values at the length real
     * machines actually produce — a deep Windows path, a sentence of a remediation — and asserts the
     * output still fits.
     */
    const platform: PlatformFacts = {
      os: 'windows',
      osDisplayName: 'Windows 11 Pro for Workstations',
      arch: 'x64',
      nodeVersion: '22.13.0',
      isWsl: false,
    };

    const report: DoctorReport = {
      platform,
      harnesses: [
        {
          harnessId: harnessId('claude'),
          state: 'configured',
          version: '2.1.212',
          versionVerdict: 'unknown-newer',
          configPath:
            'C:\\Users\\a-very-long-account-name\\AppData\\Roaming\\some\\deeply\\nested\\place\\settings.json',
          declaredVerificationTier: 'canary',
          evidence: [],
          warnings: [],
        },
      ],
      providers: [
        {
          providerId: providerId('harnesstrim'),
          state: 'configured',
          version: '0.0.6-rc.1+build.2026',
          executable: null,
          installationChannel: null,
          versionVerdict: 'unknown-newer',
          configuredHarnesses: [harnessId('claude'), harnessId('codex'), harnessId('opencode')],
          unmanagedHarnessesConfigured: [],
          supportsUnmanagedHarnesses: true,
          managedByTokenHarness: false,
          evidence: [],
          warnings: [],
        },
      ],
      problemCount: 2,
    };

    const result: CommandResult<DoctorReport> = commandResult<DoctorReport>({
      command: 'doctor',
      exitCode: 3,
      data: report,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'tool-family-not-covered',
          message:
            'PowerShell is not covered by any hook here, so commands using it are not optimized',
          path: 'C:\\Users\\a-very-long-account-name\\AppData\\Roaming\\some\\deeply\\nested\\settings.json',
          remediation: 'Optional. Widen the matcher, or accept the gap and read coverage with it',
        }),
      ],
    });

    const rendering = renderHuman(result, {
      toolVersion: '0.1.0',
      home: 'C:\\Users\\a-very-long-account-name',
      decorate: false,
    });
    assertFits(rendering.report, 'doctor with long values');
  });
});
