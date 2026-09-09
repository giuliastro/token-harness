import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected exactly one replacement anchor`);
  }
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

// Core: model tool deferral as evidence, not a guessed boolean.
replaceOnce(
  'packages/core/src/domain/context-cost.ts',
  `export type ContextObservationSource = 'native-rpc' | 'native-cli' | 'filesystem';\n`,
  `export type ContextObservationSource = 'native-rpc' | 'native-cli' | 'filesystem';\n\nexport type ToolDeferralState = 'active' | 'available' | 'inactive' | 'unknown';\n\n/**\n * Read-only evidence about a mechanism that can keep tool schemas out of the model-visible\n * surface until they are needed. \`available\` means the reviewed harness build contains the\n * mechanism but Token Harness cannot prove the live model/provider gate; it is deliberately not\n * a synonym for \`active\`.\n */\nexport interface ToolDeferralObservation {\n  harnessId: HarnessId;\n  mechanism: 'native-tool-search' | 'native-defer-loading' | 'external';\n  state: ToolDeferralState;\n  scope: 'mcp-tools' | 'tool-catalog';\n  evidenceSource: ContextObservationSource | 'compatibility';\n  reason: string;\n}\n`,
);
replaceOnce(
  'packages/core/src/domain/context-cost.ts',
  `  toolSearchEnabled: boolean | null;\n  projectRootMarkers: string[] | null;`,
  `  /** Legacy/raw harness feature value. Never treat it as effective deferral by itself. */\n  toolSearchEnabled: boolean | null;\n  /** Additive evidence; omitted by legacy observations. */\n  toolDeferral?: ToolDeferralObservation | null;\n  projectRootMarkers: string[] | null;`,
);
replaceOnce(
  'packages/core/src/domain/context-cost.ts',
  `export interface ContextReport {\n`,
  `export interface EffectiveMcpExposure {\n  rawServerCount: number;\n  rawKnownToolCount: number;\n  serverCountForPressure: number;\n  knownToolCountForPressure: number;\n  deferralState: ToolDeferralState | null;\n}\n\n/**\n * Counts only evidence that is actually model-visible for pressure scoring. A merely \`available\`\n * mechanism cannot reduce the count: only runtime-proven \`active\` deferral does.\n */\nexport function effectiveMcpExposure(\n  observation: Pick<HarnessContextObservation, 'mcpServers' | 'toolDeferral'>,\n): EffectiveMcpExposure {\n  const rawServerCount = observation.mcpServers.length;\n  const rawKnownToolCount = observation.mcpServers.reduce(\n    (total, server) => total + (server.toolCount ?? 0),\n    0,\n  );\n  const deferralState = observation.toolDeferral?.state ?? null;\n  return {\n    rawServerCount,\n    rawKnownToolCount,\n    serverCountForPressure: deferralState === 'active' ? 0 : rawServerCount,\n    knownToolCountForPressure: deferralState === 'active' ? 0 : rawKnownToolCount,\n    deferralState,\n  };\n}\n\nexport interface ContextReport {\n`,
);

// CLI context: decorate the reviewed Codex 0.146 observation with native capability evidence.
replaceOnce(
  'apps/cli/src/commands/context-cost.ts',
  `  type InstructionFileObservation,\n} from '@token-harness/core';`,
  `  type InstructionFileObservation,\n  type ToolDeferralObservation,\n} from '@token-harness/core';`,
);
replaceOnce(
  'apps/cli/src/commands/context-cost.ts',
  `const CONTEXT_HARNESSES = new Set([CLAUDE, CODEX]);\n`,
  `const CONTEXT_HARNESSES = new Set([CLAUDE, CODEX]);\n\nfunction nativeToolDeferral(\n  harness: typeof CLAUDE,\n  version: string | null,\n  verdict: string | null,\n): ToolDeferralObservation | null {\n  if (harness !== CODEX) return null;\n\n  // Upstream Codex 0.146.0 has removed the old tool_search compatibility toggles: MCP tools are\n  // deferred whenever tool_search is actually available, which in turn depends on model support\n  // plus provider namespace-tools support. app-server model/list does not expose both live gates,\n  // so this is capability evidence, not a claim that the current turn is actively deferred.\n  if (version === '0.146.0' && verdict === 'in-range') {\n    return {\n      harnessId: CODEX,\n      mechanism: 'native-tool-search',\n      state: 'available',\n      scope: 'mcp-tools',\n      evidenceSource: 'compatibility',\n      reason:\n        'Codex 0.146.0 contains native MCP tool-search deferral; the live model/provider gate is not exposed by the observed app-server catalog, so effective activation is unverified',\n    };\n  }\n\n  return {\n    harnessId: CODEX,\n    mechanism: 'native-tool-search',\n    state: 'unknown',\n    scope: 'mcp-tools',\n    evidenceSource: 'compatibility',\n    reason:\n      'This Codex version is outside the reviewed native tool-deferral evidence; do not infer activation from the legacy tool_search config flag',\n  };\n}\n`,
);
replaceOnce(
  'apps/cli/src/commands/context-cost.ts',
  `    report.harnesses.push(await adapter.observeContext(harnessContext, report.observedAt));\n`,
  `    const observation = await adapter.observeContext(harnessContext, report.observedAt);\n    const deferral = nativeToolDeferral(\n      adapter.manifest.id,\n      detection.version,\n      detection.versionVerdict,\n    );\n    if (deferral !== null) observation.toolDeferral = deferral;\n    report.harnesses.push(observation);\n`,
);

// Optimizer: active deferral can lower MCP static pressure; available/unknown remains visible but uncredited.
replaceOnce(
  'apps/cli/src/commands/optimize.ts',
  `  estimateAcceptedTaskCapacityForPolicy,\n`,
  `  effectiveMcpExposure,\n  estimateAcceptedTaskCapacityForPolicy,\n`,
);
replaceOnce(
  'apps/cli/src/commands/optimize.ts',
  `  const knownTools = harness.mcpServers\n    .filter((server) => server.toolCount !== null)\n    .reduce((total, server) => total + (server.toolCount ?? 0), 0);\n  const hasUnknownTools = harness.mcpServers.some((server) => server.toolCount === null);\n`,
  `  const mcpExposure = effectiveMcpExposure(harness);\n  const knownTools = mcpExposure.rawKnownToolCount;\n  const hasUnknownTools = harness.mcpServers.some((server) => server.toolCount === null);\n`,
);
replaceOnce(
  'apps/cli/src/commands/optimize.ts',
  `  if (knownTools >= 50 || harness.mcpServers.length >= 12) score = Math.max(score, 2);\n  else if (knownTools >= 20 || harness.mcpServers.length >= 6) score = Math.max(score, 1);\n  if (harness.mcpServers.length > 0) {\n    evidence.push({\n      code: 'mcp-exposure',\n      summary:\n        String(harness.mcpServers.length) +\n        ' MCP servers, ' +\n        String(knownTools) +\n        (hasUnknownTools ? '+?' : '') +\n        ' tools visible in inventory',\n    });\n  }\n`,
  `  if (\n    mcpExposure.knownToolCountForPressure >= 50 ||\n    mcpExposure.serverCountForPressure >= 12\n  )\n    score = Math.max(score, 2);\n  else if (\n    mcpExposure.knownToolCountForPressure >= 20 ||\n    mcpExposure.serverCountForPressure >= 6\n  )\n    score = Math.max(score, 1);\n  if (harness.mcpServers.length > 0) {\n    const deferral = harness.toolDeferral;\n    evidence.push({\n      code:\n        deferral?.state === 'active'\n          ? 'mcp-native-deferral-active'\n          : deferral?.state === 'available'\n            ? 'mcp-native-deferral-available'\n            : 'mcp-exposure',\n      summary:\n        String(harness.mcpServers.length) +\n        ' MCP servers, ' +\n        String(knownTools) +\n        (hasUnknownTools ? '+?' : '') +\n        (deferral?.state === 'active'\n          ? ' tools inventoried; native tool deferral is runtime-proven active, so they are not counted as direct static MCP pressure'\n          : deferral?.state === 'available'\n            ? ' tools inventoried; native tool deferral exists in this reviewed harness build but its live model/provider gate is unverified'\n            : ' tools visible in inventory'),\n    });\n  }\n`,
);
replaceOnce(
  'apps/cli/src/commands/optimize.ts',
  `      action:\n        'Review this high-exposure MCP server before a long task; do not remove it without usage or task-relevance evidence',\n`,
  `      action:\n        context.toolDeferral?.state === 'available'\n          ? 'Verify native tool deferral before adding another MCP reduction layer; do not remove this server without usage or task-relevance evidence'\n          : 'Review this high-exposure MCP server before a long task; do not remove it without usage or task-relevance evidence',\n`,
);

// Existing integration fixture: prove 0.146 gets capability evidence even with no legacy feature flag.
replaceOnce(
  'apps/cli/test/context-cost.test.ts',
  `    assert.deepEqual(result.data.harnesses[0]?.managedConfigTarget, {\n`,
  `    assert.equal(result.data.harnesses[0]?.toolSearchEnabled, null);\n    assert.deepEqual(result.data.harnesses[0]?.toolDeferral, {\n      harnessId: 'codex',\n      mechanism: 'native-tool-search',\n      state: 'available',\n      scope: 'mcp-tools',\n      evidenceSource: 'compatibility',\n      reason:\n        'Codex 0.146.0 contains native MCP tool-search deferral; the live model/provider gate is not exposed by the observed app-server catalog, so effective activation is unverified',\n    });\n    assert.deepEqual(result.data.harnesses[0]?.managedConfigTarget, {\n`,
);

// Pure pressure semantics: only active evidence earns a reduction.
fs.writeFileSync(
  'packages/core/test/tool-deferral.test.ts',
  `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\nimport { effectiveMcpExposure, harnessId, type HarnessContextObservation } from '../src/index.js';\n\nfunction observation(state: 'active' | 'available' | 'inactive' | 'unknown'): HarnessContextObservation {\n  const id = harnessId('codex');\n  return {\n    harnessId: id, state: 'observed', model: null, reasoningEffort: null, verbosity: null,\n    projectDocMaxBytes: null, toolOutputTokenLimit: null, toolSearchEnabled: false,\n    toolDeferral: { harnessId: id, mechanism: 'native-tool-search', state, scope: 'mcp-tools', evidenceSource: 'compatibility', reason: 'test' },\n    projectRootMarkers: null, projectDocFallbackFilenames: [], configInstructionBytes: null,\n    managedConfigTarget: null, managedConfigOriginsObserved: false, managedConfigFieldOrigins: [],\n    availableModels: [], modelCatalogTruncated: false,\n    mcpServers: [\n      { harnessId: id, name: 'large', toolCount: 60, runtimeStatus: 'ready', authStatus: 'authenticated', pluginId: null, source: 'native-rpc' },\n    ],\n    mcpInventoryTruncated: false, diagnostics: [],\n  };\n}\n\ndescribe('native tool deferral pressure', () => {\n  it('removes static MCP pressure only when deferral is proven active', () => {\n    const active = effectiveMcpExposure(observation('active'));\n    assert.equal(active.rawKnownToolCount, 60);\n    assert.equal(active.knownToolCountForPressure, 0);\n    assert.equal(active.serverCountForPressure, 0);\n  });\n\n  it('does not credit an available-but-unverified mechanism as savings', () => {\n    const available = effectiveMcpExposure(observation('available'));\n    assert.equal(available.rawKnownToolCount, 60);\n    assert.equal(available.knownToolCountForPressure, 60);\n    assert.equal(available.serverCountForPressure, 1);\n  });\n\n  it('does not let the legacy toolSearchEnabled boolean override richer evidence', () => {\n    const active = observation('active');\n    active.toolSearchEnabled = false;\n    assert.equal(effectiveMcpExposure(active).knownToolCountForPressure, 0);\n  });\n});\n`,
  'utf8',
);

// Record the decisive upstream finding next to the initial spike.
fs.writeFileSync(
  'docs/spikes/codex-native-tool-search-upstream-2026-09-09.md',
  `# Codex native MCP tool-search evidence — 2026-09-09\n\n## Finding\n\nThe reviewed Codex 0.146.0 source already contains the modern tool-search behavior: the old \`tool_search\` compatibility flag is a removed no-op, and the old \`tool_search_always_defer_mcp_tools\` flag is also removed because MCP tools are deferred whenever tool search is available.\n\nCurrent upstream keeps the same contract. \`mcp_tool_exposure.rs\` registers effective MCP tools as deferred when \`search_tool_enabled\` is true. \`search_tool_enabled\` requires both model metadata \`supports_search_tool\` and provider capability \`namespace_tools\`.\n\nUpstream commit \`c53b1dae09db40902c59f6a0d57d0dcc334926db\` (2026-06-22, PR #29486) made this the default path for all effective MCP tools whenever those two gates support it.\n\n## Important observation gap\n\nCodex app-server \`model/list\` does not currently expose \`supports_search_tool\` in its v2 Model schema, and Token Harness does not have a supported read of the provider's namespace-tools gate. Therefore Token Harness can prove that the mechanism exists in reviewed Codex 0.146.0, but cannot yet prove it is active for the current model/provider turn.\n\nThe old \`config.features.tool_search\` value must not be used as effective-state truth: in the reviewed source that flag is a compatibility tombstone/no-op.\n\n## Token Harness policy\n\n- Codex 0.146.0: report native MCP tool-search deferral as **available**, effective activation unverified.\n- Unknown/newer/unreviewed Codex: report the mechanism as **unknown** until its contract is reviewed.\n- Only runtime-proven **active** deferral may remove MCP tools from static context-pressure scoring.\n- **available** is useful for provider selection: do not install or recommend an overlapping external Lazy MCP-style layer merely because the MCP inventory is large. First verify whether the native path can be observed.\n- The legacy feature boolean remains raw compatibility evidence only and cannot override the richer state.\n\n## Next probe\n\nFind a stable Codex app-server/session response that exposes effective tool namespaces or search-tool availability. If none exists, benchmark native behavior with a controlled MCP fixture rather than adding a guessed config key.\n`,
  'utf8',
);
