import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { effectiveMcpExposure, harnessId, type HarnessContextObservation } from '../src/index.js';

function observation(
  state: 'active' | 'available' | 'inactive' | 'unknown',
): HarnessContextObservation {
  const id = harnessId('codex');
  return {
    harnessId: id,
    state: 'observed',
    model: null,
    reasoningEffort: null,
    verbosity: null,
    projectDocMaxBytes: null,
    toolOutputTokenLimit: null,
    toolSearchEnabled: false,
    toolDeferral: {
      harnessId: id,
      mechanism: 'native-tool-search',
      state,
      scope: 'mcp-tools',
      evidenceSource: 'compatibility',
      reason: 'test',
    },
    projectRootMarkers: null,
    projectDocFallbackFilenames: [],
    configInstructionBytes: null,
    managedConfigTarget: null,
    managedConfigOriginsObserved: false,
    managedConfigFieldOrigins: [],
    availableModels: [],
    modelCatalogTruncated: false,
    mcpServers: [
      {
        harnessId: id,
        name: 'large',
        toolCount: 60,
        runtimeStatus: 'ready',
        authStatus: 'authenticated',
        pluginId: null,
        source: 'native-rpc',
      },
    ],
    mcpInventoryTruncated: false,
    diagnostics: [],
  };
}

describe('native tool deferral pressure', () => {
  it('removes static MCP pressure only when deferral is proven active', () => {
    const active = effectiveMcpExposure(observation('active'));
    assert.equal(active.rawKnownToolCount, 60);
    assert.equal(active.knownToolCountForPressure, 0);
    assert.equal(active.serverCountForPressure, 0);
  });

  it('does not credit an available-but-unverified mechanism as savings', () => {
    const available = effectiveMcpExposure(observation('available'));
    assert.equal(available.rawKnownToolCount, 60);
    assert.equal(available.knownToolCountForPressure, 60);
    assert.equal(available.serverCountForPressure, 1);
  });

  it('does not let the legacy toolSearchEnabled boolean override richer evidence', () => {
    const active = observation('active');
    active.toolSearchEnabled = false;
    assert.equal(effectiveMcpExposure(active).knownToolCountForPressure, 0);
  });
});
