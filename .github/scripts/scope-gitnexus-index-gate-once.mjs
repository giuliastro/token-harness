import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`expected exactly one ${label}`);
  }
  return text.replace(oldText, newText);
}

const surfacePath = 'apps/cli/src/commands/candidate-campaign-surface.ts';
let surface = readFileSync(surfacePath, 'utf8');
surface = replaceOnce(
  surface,
  'async function validateGitNexusBenchmarkStart(context: CommandContext): Promise<Diagnostic | null> {',
  `async function validateGitNexusBenchmarkStart(\n  context: CommandContext,\n  requireIndexReadiness: boolean,\n): Promise<Diagnostic | null> {`,
  'GitNexus validator signature',
);
surface = replaceOnce(
  surface,
  `  const statusOutcome = await context.adapters.runner.run({\n    executable: 'gitnexus',`,
  `  if (!requireIndexReadiness) return null;\n\n  const statusOutcome = await context.adapters.runner.run({\n    executable: 'gitnexus',`,
  'GitNexus status probe',
);
surface = replaceOnce(
  surface,
  `export async function validateCandidateCampaignRuntimeSurface(\n  context: CommandContext,\n  requireProviderVersion: boolean,\n): Promise<Diagnostic | null> {`,
  `export async function validateCandidateCampaignRuntimeSurface(\n  context: CommandContext,\n  requireProviderVersion: boolean,\n  requireGitNexusIndexReadiness = true,\n): Promise<Diagnostic | null> {`,
  'runtime surface signature',
);
surface = replaceOnce(
  surface,
  `  if (candidateId === 'gitnexus') {\n    return validateGitNexusBenchmarkStart(context);\n  }`,
  `  if (candidateId === 'gitnexus') {\n    return validateGitNexusBenchmarkStart(context, requireGitNexusIndexReadiness);\n  }`,
  'GitNexus runtime dispatch',
);
writeFileSync(surfacePath, surface);

const lifecyclePath = 'apps/cli/src/commands/gitnexus-candidate-lifecycle.ts';
let lifecycle = readFileSync(lifecyclePath, 'utf8');
lifecycle = replaceOnce(
  lifecycle,
  `  return validateCandidateCampaignRuntimeSurface(\n    { ...context, benchmarkVariant: 'optimized' },\n    true,\n  );`,
  `  return validateCandidateCampaignRuntimeSurface(\n    { ...context, benchmarkVariant: 'optimized' },\n    true,\n    false,\n  );`,
  'managed lifecycle runtime check',
);
writeFileSync(lifecyclePath, lifecycle);
