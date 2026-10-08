import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { it } from 'node:test';
import type { PlatformFacts } from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { inspectApplicationUpdate } from '../src/commands/application-update.js';
import type { CommandContext } from '../src/commands/context.js';

it('keeps a desktop installation outside npm self-update and identifies its own release version', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'th-desktop-update-'));
  try {
    const facts: PlatformFacts = {
      os:
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'macos'
            : 'linux',
      osDisplayName: 'test',
      arch: 'x64',
      nodeVersion: '24.13.0',
      isWsl: false,
    };
    const entry = join(directory, 'token-harness.mjs');
    writeFileSync(entry, '// fixture');
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'token-harness',
        version: '0.1.30',
        tokenHarnessDistribution: 'desktop',
      }),
    );
    const context = {
      applicationEntryScript: entry,
      adapters: {
        fs: new NodeFileSystem(facts),
        runner: {
          run: () => {
            throw new Error('Desktop inspection must never query or update npm');
          },
        },
      },
    } as unknown as CommandContext;
    const inspection = await inspectApplicationUpdate(context);
    assert.equal(inspection?.row.installed, '0.1.30');
    assert.equal(inspection?.row.verdict, 'unsupported-installation');
    assert.equal(inspection?.installationRoot, null);
    assert.equal(inspection?.destination, null);
    assert.match(inspection?.diagnostics[0]?.message ?? '', /desktop.*GitHub Releases/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
