/**
 * Generates the published matrices — PLAN §8.3, last bullet: "publish compatibility,
 * verification-tier, and known-limitations matrices."
 *
 * The generators live here rather than in the `tests/tools` script, because
 * `tests/integration/matrices.test.ts` imports them to compare against the committed file. A plain
 * `.mjs` under `tests/tools` is not compiled, so a test cannot import it; `tests/tools/matrices.mjs`
 * is now a runner that calls into this module. `scripts/` was the first home and cannot work at all:
 * it is not a workspace package, so it cannot import the adapter registries this reads.
 *
 * ## Why these are generated
 *
 * Every fact in the first two matrices already exists, in the manifests. A hand-written table
 * beside them is a second copy of the same data with nobody to notice when they disagree — and the
 * failure is silent and one-directional: the docs go stale while the code stays right, so the
 * matrix keeps making a promise the build stopped keeping.
 *
 * So the two derivable matrices come out of `listHarnessAdapters()` and `listProviderAdapters()`,
 * and `tests/integration/matrices.test.ts` asserts the committed file is what this script produces.
 * Editing the tables by hand fails that test, which is the point.
 *
 * ## What is not generated, and why the section is still checked
 *
 * Known limitations are prose. Several of them are facts about the *world* rather than about a
 * manifest field — that Codex keeps hook enablement in state no adapter can read, that a rollback
 * cannot uninstall a package — and reducing them to a table cell would lose the part a reader needs.
 *
 * They are therefore written by hand, with one machine-checked constraint: every `limitation`
 * string any manifest declares must appear in that section. A limitation a provider states and the
 * document omits is the exact drift generating the other two matrices is meant to prevent.
 *
 * ## The tables must stay Prettier-clean
 *
 * `docs/matrices.md` is formatted by Prettier like every other file, so this generator has to emit
 * what Prettier would leave alone — it does not pad table cells, and neither does this. If the two
 * ever disagree, `pnpm format` rewrites the file and `matrices.test.ts` fails on the next run. That
 * is a loud, well-labelled failure rather than a silent one, which is why the file is not simply
 * added to `.prettierignore`: excluding it would stop Prettier checking the hand-written prose too.
 */

import { join } from 'node:path';

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  formatTestedRange,
  type HarnessManifest,
  type VerificationTier,
} from '@token-harness/core';

import { REPO_ROOT } from './fixtures.js';

// `REPO_ROOT` rather than counting `dirname` levels: this module compiles to `tests/dist/src/`,
// which is a different depth from the source, and a hand-counted chain is wrong in one of the two.
export const MATRICES_PATH = join(REPO_ROOT, 'docs', 'matrices.md');

/** The marker the hand-written section begins at. Everything above it is generated. */
export const HANDWRITTEN_MARKER = '## Known limitations';

function table(header: readonly string[], rows: readonly string[][]): string {
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

/** A cell that would otherwise be empty says so, because a blank cell reads as an oversight. */
function cell(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function compatibilityMatrix(): string {
  const rows: string[][] = [];
  for (const provider of listProviderAdapters()) {
    for (const support of provider.manifest.harnesses) {
      const claimed = provider.manifest.capabilities
        .filter((capability) => capability.harnesses.includes(support.harness))
        .map((capability) => `\`${capability.capability}\``);
      rows.push([
        provider.manifest.id,
        support.harness,
        formatTestedRange(support.testedVersions),
        // A provider may declare support for a harness and claim no capability on it. That is a
        // real state — adopted and measured, never an owner — and an empty cell would hide it.
        claimed.length === 0 ? 'none claimed' : claimed.join(', '),
      ]);
    }
  }
  return table(['Provider', 'Harness', 'Tested harness versions', 'Capabilities claimed'], rows);
}

function harnessMatrix(): string {
  const rows = listHarnessAdapters().map((adapter) => {
    const manifest = adapter.manifest;
    return [
      manifest.id,
      formatTestedRange(manifest.testedVersions),
      manifest.verificationTier,
      manifest.toolFamilies.map((family) => `\`${family.id}\``).join(', '),
      manifest.receiptFamily,
      manifest.requiresEnablement ? 'yes' : 'no',
    ];
  });
  return table(
    [
      'Harness',
      'Tested versions',
      'Declared tier',
      'Tool families',
      'Receipt family',
      'Needs enablement',
    ],
    rows,
  );
}

/**
 * The strongest tier the *harness* could ever support, from its own declarations.
 *
 * RFC 0007: with no externally observable receipt nothing above `config-only` is provable, and a
 * harness whose hook enablement is persisted state no adapter can read cannot be shown to have run
 * either.
 */
function harnessCeiling(manifest: HarnessManifest): VerificationTier {
  if (manifest.receiptFamily === 'none') return 'config-only';
  if (manifest.requiresEnablement) return 'config-only';
  return 'canary';
}

function tierMatrix(): string {
  const rows: string[][] = [];
  for (const provider of listProviderAdapters()) {
    for (const support of provider.manifest.harnesses) {
      const harness = listHarnessAdapters().find(
        (adapter) => adapter.manifest.id === support.harness,
      );
      const ceiling = harness === undefined ? null : harnessCeiling(harness.manifest);
      /**
       * States the gap; does not invent its cause.
       *
       * An earlier version of this column derived a *reason* from the harness alone and produced a
       * row that contradicted itself: HarnessTrim on Claude is `config-only` beside "the receipt is
       * readable, so interception can be observed". Both halves were true of Claude and the
       * sentence was false, because what caps HarnessTrim there is its own opt-in telemetry — a
       * fact no manifest field carries.
       *
       * Generated prose that is plausible and wrong is worse than a column that stops at what it
       * knows. So the derivable part is reported and the cause is left to the prose below, which a
       * person writes and the test checks for completeness.
       */
      rows.push([
        provider.manifest.id,
        support.harness,
        support.verificationTier,
        cell(ceiling),
        ceiling === null
          ? 'harness not registered in this build'
          : support.verificationTier === ceiling
            ? 'at the harness ceiling'
            : 'below the harness ceiling — see Known limitations',
      ]);
    }
  }
  return table(['Provider', 'Harness', 'Declared tier', 'Harness ceiling', 'Gap'], rows);
}

function platformMatrix(): string {
  const rows: string[][] = [];
  for (const provider of listProviderAdapters()) {
    for (const platform of provider.manifest.platforms) {
      rows.push([
        provider.manifest.id,
        platform.wsl ? `${platform.os} (WSL)` : platform.os,
        platform.supported ? 'supported' : 'not supported',
        cell(platform.limitation),
      ]);
    }
  }
  return table(['Provider', 'Platform', 'Support', 'Stated limitation'], rows);
}

function metricsMatrix(): string {
  const rows = listProviderAdapters().map((provider) => [
    provider.manifest.id,
    provider.manifest.metrics.source,
    provider.manifest.metrics.mode,
    provider.manifest.metrics.locations.length === 0
      ? '—'
      : provider.manifest.metrics.locations.map((location) => `\`${location}\``).join(', '),
  ]);
  return table(['Provider', 'Metrics source', 'Importer mode', 'Default locations'], rows);
}

/** Every limitation any manifest declares, for the check the test performs. */
export function declaredLimitations(): string[] {
  const stated: string[] = [];
  for (const provider of listProviderAdapters()) {
    for (const platform of provider.manifest.platforms) {
      if (platform.limitation !== null && platform.limitation !== '') {
        stated.push(platform.limitation);
      }
    }
  }
  for (const harness of listHarnessAdapters()) {
    const note = harness.manifest.enablementNote;
    if (note !== null && note !== '') stated.push(note);
  }
  return stated;
}

export function generatedSection(): string {
  return [
    '<!-- Generated by tests/tools/matrices.mjs. Do not edit above the known-limitations heading. -->',
    '',
    '# Compatibility, verification tiers, and known limitations',
    '',
    'Everything above the known-limitations heading is generated from the provider and harness',
    'manifests by `node tests/tools/matrices.mjs`, and `tests/integration/matrices.test.ts` fails if the',
    'committed file and the manifests disagree. A hand-maintained copy of data the code already holds',
    'goes stale in one direction only: the document keeps promising what the build stopped doing.',
    '',
    '## Provider and harness compatibility',
    '',
    'A tested range is a record of versions that were actually exercised, not a semver range. A',
    'version outside it is reported as such and treated conservatively rather than refused.',
    '',
    compatibilityMatrix(),
    '',
    '## Harnesses',
    '',
    harnessMatrix(),
    '',
    '## Verification tiers',
    '',
    'RFC 0007: a tier is what can be *proved* about an integration, per harness and per version.',
    '`config-only` is not a lesser installation — it is an honest statement that the configuration is',
    'correct and that nothing available can show it ran.',
    '',
    tierMatrix(),
    '',
    '## Platforms',
    '',
    platformMatrix(),
    '',
    '## Metrics sources',
    '',
    'RFC 0005 §Importer degradation policy: an importer states the fidelity mode it runs in, and',
    '`unavailable` is a supported answer rather than a defect.',
    '',
    metricsMatrix(),
    '',
  ].join('\n');
}
