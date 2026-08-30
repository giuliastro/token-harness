/**
 * `token-harness context` — RFC 0011 Phase 18.2.
 *
 * Read-only inventory of static instructions, effective harness configuration and MCP exposure.
 */

import { listHarnessAdapters } from '@token-harness/adapters';
import {
  EXIT_CODES,
  commandResult,
  diagnostic,
  harnessId,
  type CommandResult,
  type ContextReport,
  type HarnessContextObservation,
  type InstructionFileObservation,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const CONTEXT_HARNESSES = new Set([CLAUDE, CODEX]);

function emptyObservation(
  id: typeof CLAUDE,
  state: HarnessContextObservation['state'],
): HarnessContextObservation {
  return {
    harnessId: id,
    state,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    projectDocMaxBytes: null,
    toolOutputTokenLimit: null,
    toolSearchEnabled: null,
    projectRootMarkers: null,
    projectDocFallbackFilenames: [],
    configInstructionBytes: null,
    availableModels: [],
    modelCatalogTruncated: false,
    mcpServers: [],
    mcpInventoryTruncated: false,
    diagnostics: [],
  };
}

async function fileObservation(
  context: CommandContext,
  input: {
    harnessId: typeof CLAUDE;
    path: string;
    scope: 'user' | 'project';
    loadedBytes: number | null;
  },
): Promise<InstructionFileObservation | null> {
  if (context.adapters === null) return null;
  const stat = await context.adapters.fs.stat(input.path);
  if (stat === null || stat.kind !== 'file') return null;
  const loadedBytes =
    input.loadedBytes === null ? null : Math.min(input.loadedBytes, stat.byteLength);
  return {
    harnessId: input.harnessId,
    path: input.path,
    scope: input.scope,
    byteLength: stat.byteLength,
    loadedBytes,
    truncated: loadedBytes === null ? null : loadedBytes < stat.byteLength,
    source: 'filesystem',
  };
}

async function directoryHasMarker(
  context: CommandContext,
  directory: string,
  markers: readonly string[],
): Promise<boolean> {
  if (context.adapters === null) return false;
  for (const marker of markers) {
    if (marker === '') continue;
    const stat = await context.adapters.fs.stat(context.adapters.fs.join(directory, marker));
    if (stat !== null) return true;
  }
  return false;
}

async function codexSearchDirectories(
  context: CommandContext,
  observation: HarnessContextObservation,
): Promise<string[]> {
  if (context.adapters === null) return [context.projectRoot];
  const markers = observation.projectRootMarkers ?? ['.git'];
  if (markers.length === 0) return [context.projectRoot];

  let cursor = context.projectRoot;
  let root: string | null = null;
  while (true) {
    if (await directoryHasMarker(context, cursor, markers)) {
      root = cursor;
      break;
    }
    const parent = context.adapters.fs.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  if (root === null) return [context.projectRoot];

  const directories: string[] = [];
  cursor = context.projectRoot;
  while (true) {
    directories.push(cursor);
    if (cursor === root) break;
    const parent = context.adapters.fs.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  directories.reverse();
  return directories;
}

async function codexInstructionFiles(
  context: CommandContext,
  observation: HarnessContextObservation,
): Promise<InstructionFileObservation[]> {
  if (context.adapters === null) return [];
  const candidates = [
    'AGENTS.override.md',
    'AGENTS.md',
    ...observation.projectDocFallbackFilenames.filter(
      (name) => name !== '' && name !== 'AGENTS.override.md' && name !== 'AGENTS.md',
    ),
  ];

  let remaining = observation.projectDocMaxBytes;
  const results: InstructionFileObservation[] = [];
  for (const directory of await codexSearchDirectories(context, observation)) {
    let selected: string | null = null;
    for (const candidate of candidates) {
      const path = context.adapters.fs.join(directory, candidate);
      const stat = await context.adapters.fs.stat(path);
      if (stat !== null && stat.kind === 'file') {
        selected = path;
        break;
      }
    }
    if (selected === null) continue;

    const item = await fileObservation(context, {
      harnessId: CODEX,
      path: selected,
      scope: 'project',
      loadedBytes: remaining,
    });
    if (item === null) continue;
    results.push(item);
    if (remaining !== null && item.loadedBytes !== null) {
      remaining = Math.max(0, remaining - item.loadedBytes);
    }
  }
  return results;
}

async function claudeInstructionFiles(
  context: CommandContext,
): Promise<InstructionFileObservation[]> {
  if (context.adapters === null) return [];
  const candidates: Array<{ path: string; scope: 'user' | 'project' }> = [
    { path: context.adapters.fs.join(context.projectRoot, 'CLAUDE.md'), scope: 'project' },
    {
      path: context.adapters.fs.join(context.projectRoot, '.claude', 'CLAUDE.md'),
      scope: 'project',
    },
    {
      path: context.adapters.fs.join(context.adapters.paths.home, '.claude', 'CLAUDE.md'),
      scope: 'user',
    },
    { path: context.adapters.fs.join(context.adapters.paths.home, 'CLAUDE.md'), scope: 'user' },
  ];

  const results: InstructionFileObservation[] = [];
  for (const candidate of candidates) {
    const item = await fileObservation(context, {
      harnessId: CLAUDE,
      path: candidate.path,
      scope: candidate.scope,
      loadedBytes: null,
    });
    if (item !== null) results.push(item);
  }
  return results;
}

export async function runContext(context: CommandContext): Promise<CommandResult<ContextReport>> {
  const report: ContextReport = {
    platform: context.platform,
    projectRoot: context.projectRoot,
    observedAt: context.now(),
    instructions: [],
    knownLoadedInstructionBytes: 0,
    discoveredInstructionBytes: 0,
    instructionHierarchy: [],
    harnesses: [],
  };

  if (context.adapters === null) {
    return commandResult({ command: 'context', exitCode: EXIT_CODES.ok, data: report });
  }

  if (context.harness !== null && !CONTEXT_HARNESSES.has(context.harness)) {
    const warning = diagnostic({
      severity: 'warning',
      code: 'context-harness-unsupported',
      subject: context.harness,
      message: 'Context-cost observability currently targets Claude Code and Codex',
      remediation: 'Run token-harness context without --harness, or select claude or codex',
    });
    return commandResult({
      command: 'context',
      exitCode: EXIT_CODES.ok,
      data: report,
      diagnostics: [warning],
    });
  }

  const harnessContext = {
    fs: context.adapters.fs,
    runner: context.adapters.runner,
    facts: context.platform,
    paths: context.adapters.paths,
    projectRoot: context.projectRoot,
  };

  const adapters = listHarnessAdapters()
    .filter((adapter) => CONTEXT_HARNESSES.has(adapter.manifest.id))
    .filter((adapter) => context.harness === null || adapter.manifest.id === context.harness);

  for (const adapter of adapters) {
    const detection = await adapter.detect(harnessContext);
    if (detection.state === 'absent') {
      report.harnesses.push(emptyObservation(adapter.manifest.id, 'absent'));
      continue;
    }
    if (adapter.observeContext === undefined) {
      const observation = emptyObservation(adapter.manifest.id, 'unavailable');
      observation.diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'context-observation-unavailable',
          subject: adapter.manifest.id,
          message: adapter.manifest.displayName + ' has no supported context inventory reader',
          remediation: 'Treat this harness context cost as unknown',
        }),
      );
      report.harnesses.push(observation);
      continue;
    }
    report.harnesses.push(await adapter.observeContext(harnessContext, report.observedAt));
  }

  const codex = report.harnesses.find((item) => item.harnessId === CODEX);
  if (codex !== undefined && codex.state !== 'absent') {
    report.instructions.push(...(await codexInstructionFiles(context, codex)));
  }
  const claude = report.harnesses.find((item) => item.harnessId === CLAUDE);
  if (claude !== undefined && claude.state !== 'absent') {
    report.instructions.push(...(await claudeInstructionFiles(context)));
  }

  report.knownLoadedInstructionBytes = report.instructions.reduce(
    (total, item) => total + (item.loadedBytes ?? 0),
    0,
  );
  report.discoveredInstructionBytes = report.instructions.reduce(
    (total, item) => total + item.byteLength,
    0,
  );

  const hierarchyDiagnostics = [];
  for (const harness of report.harnesses) {
    const files = report.instructions.filter((item) => item.harnessId === harness.harnessId);
    const projectFiles = files.filter((item) => item.scope === 'project');
    const userFiles = files.filter((item) => item.scope === 'user');
    const projectDirectories = new Set(
      projectFiles.map((item) => context.adapters?.fs.dirname(item.path) ?? item.path),
    );
    const largestProjectFileBytes =
      projectFiles.length === 0
        ? null
        : Math.max(...projectFiles.map((item) => item.byteLength));
    const knownLoadedProjectBytes = projectFiles.reduce(
      (total, item) => total + (item.loadedBytes ?? 0),
      0,
    );
    const usesMostOfCodexBudget =
      harness.projectDocMaxBytes !== null &&
      harness.projectDocMaxBytes > 0 &&
      knownLoadedProjectBytes / harness.projectDocMaxBytes >= 0.75;
    const largeSingleCandidate =
      projectFiles.length === 1 &&
      largestProjectFileBytes !== null &&
      largestProjectFileBytes >= 32 * 1024;
    const monolithicProjectInstructions =
      projectFiles.length === 1 && (usesMostOfCodexBudget || largeSingleCandidate);

    const reason = monolithicProjectInstructions
      ? usesMostOfCodexBudget
        ? 'one project instruction file consumes at least 75% of the harness project-doc byte budget'
        : 'one project instruction candidate is at least 32 KiB'
      : null;

    report.instructionHierarchy.push({
      harnessId: harness.harnessId,
      projectFileCount: projectFiles.length,
      userFileCount: userFiles.length,
      distinctProjectDirectories: projectDirectories.size,
      nestedProjectHierarchy: projectDirectories.size > 1,
      largestProjectFileBytes,
      monolithicProjectInstructions,
      reason,
    });

    if (monolithicProjectInstructions) {
      hierarchyDiagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'instruction-file-monolithic',
          subject: harness.harnessId,
          message:
            harness.harnessId +
            ' project instructions are concentrated in one large file instead of scoped hierarchy',
          path: projectFiles[0]?.path ?? null,
          remediation:
            'Move subtree-specific rules into nested instruction files where the harness supports hierarchy',
        }),
      );
    }
  }

  return commandResult({
    command: 'context',
    exitCode: EXIT_CODES.ok,
    data: report,
    diagnostics: [
      ...report.harnesses.flatMap((item) => item.diagnostics),
      ...hierarchyDiagnostics,
    ],
  });
}
