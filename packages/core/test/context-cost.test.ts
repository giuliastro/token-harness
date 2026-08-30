import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessMcpServer, harnessId, type McpServerObservation } from '../src/index.js';

const CODEX = harnessId('codex');

function server(input: Partial<McpServerObservation> & { name: string }): McpServerObservation {
  return {
    harnessId: CODEX,
    name: input.name,
    toolCount: input.toolCount ?? null,
    runtimeStatus: input.runtimeStatus ?? null,
    authStatus: input.authStatus ?? null,
    pluginId: input.pluginId ?? null,
    source: input.source ?? 'native-rpc',
  };
}

describe('MCP server assessment', () => {
  it('flags high exposure without inventing removal evidence', () => {
    const result = assessMcpServer(
      server({ name: 'github', toolCount: 28, runtimeStatus: 'connected' }),
    );

    assert.equal(result.exposure, 'high');
    assert.equal(result.usability, 'usable');
    assert.equal(result.action, 'review-exposure');
    assert.equal(result.hasRemovalEvidence, false);
    assert.match(result.reason, /usage and task relevance are not observed/i);
  });

  it('flags an authentication problem as attention, not irrelevance', () => {
    const result = assessMcpServer(
      server({
        name: 'figma',
        toolCount: 12,
        runtimeStatus: 'authenticationRequired',
        authStatus: 'needs authentication',
      }),
    );

    assert.equal(result.exposure, 'moderate');
    assert.equal(result.usability, 'attention');
    assert.equal(result.action, 'fix-or-disable-if-unneeded');
    assert.equal(result.hasRemovalEvidence, false);
  });

  it('keeps unknown tool counts unknown', () => {
    const result = assessMcpServer(
      server({ name: 'custom', toolCount: null, runtimeStatus: 'connected' }),
    );

    assert.equal(result.exposure, 'unknown');
    assert.equal(result.action, 'none');
    assert.equal(result.hasRemovalEvidence, false);
  });
});
