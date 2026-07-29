import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { TOOL_VERSION } from '../src/version.js';
import { usageText } from '../src/usage.js';
import { AVAILABLE_COMMANDS, PLANNED_COMMANDS } from '../src/argv.js';

// dist/test/ -> package root
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

describe('version and usage', () => {
  it('keeps the compiled-in version and package.json in step', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
    assert.equal(TOOL_VERSION, manifest.version);
  });

  it('lists every command, including the ones this build does not carry', () => {
    const text = usageText(null);
    for (const command of [...AVAILABLE_COMMANDS, ...PLANNED_COMMANDS]) {
      assert.match(text, new RegExp(`\\b${command}\\b`), command);
    }
  });

  it('has usage text for every available command', () => {
    for (const command of AVAILABLE_COMMANDS) {
      assert.match(usageText(command), new RegExp(`^token-harness ${command} `));
    }
  });
});
