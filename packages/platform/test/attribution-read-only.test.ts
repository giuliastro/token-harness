import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { type PlatformFacts } from '@token-harness/core';
import { NodeFileSystem } from '../src/fs/node-filesystem.js';
import { readAttributionSalt, SALT_FILE_NAME } from '../src/metrics/attribution-salt.js';

const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test', arch: 'x64', nodeVersion: process.versions.node, isWsl: false,
};

describe('read-only attribution salt', () => {
  it('does not create a salt or state root on an empty machine', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'th-observe-salt-'));
    try {
      const root = join(sandbox, 'uninitialized');
      const result = await readAttributionSalt(new NodeFileSystem(facts), root);
      assert.equal(result.salt, null);
      assert.equal(existsSync(root), false);
    } finally { rmSync(sandbox, {recursive:true,force:true}); }
  });

  it('does not overwrite an invalid salt', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'th-observe-salt-'));
    try {
      const salt = join(sandbox, SALT_FILE_NAME);
      writeFileSync(salt, 'invalid-salt\n');
      const result = await readAttributionSalt(new NodeFileSystem(facts), sandbox);
      assert.equal(result.salt, null);
      assert.equal(readFileSync(salt, 'utf8'), 'invalid-salt\n');
      assert.ok(result.diagnostics.some(d => d.code === 'attribution-salt-read-only-unavailable'));
    } finally { rmSync(sandbox, {recursive:true,force:true}); }
  });
});
