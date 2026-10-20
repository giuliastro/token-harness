/**
 * The routing policy text the native prompt hook injects on every submitted prompt.
 *
 * It is paid for on every turn, so it stays compact and deterministic: no model call, no prompt
 * inspection. Codex reports the root model slug in its `UserPromptSubmit` payload, so the Codex
 * ladder is chosen from it; Claude does not, so its ladder is keyed on the model's own identity.
 */

export type RoutingHarness = 'claude' | 'codex';

const MAX_MODEL_SLUG_LENGTH = 80;

type CodexTier = 'frontier' | 'workhorse' | 'light' | 'unknown';

/** Classify by family name, so a new point release keeps its tier without a code change. */
export function codexModelTier(model: string | null): CodexTier {
  if (model === null) return 'unknown';
  const slug = model.toLowerCase();
  if (slug.includes('luna') || slug.includes('mini') || slug.includes('nano')) return 'light';
  if (slug.includes('astra')) return 'frontier';
  if (slug.includes('sol') || slug.includes('terra') || /^gpt-\d/.test(slug)) return 'workhorse';
  return 'unknown';
}

/** Read the root model slug from a Codex hook payload; anything unexpected stays unknown. */
export function hookRootModel(hookInput: string | null): string | null {
  if (hookInput === null) return null;
  try {
    const payload = JSON.parse(hookInput) as unknown;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const model = (payload as Record<string, unknown>)['model'];
    return typeof model === 'string' &&
      model.length > 0 &&
      model.length <= MAX_MODEL_SLUG_LENGTH &&
      /^[\w.:/-]+$/.test(model)
      ? model
      : null;
  } catch {
    return null;
  }
}

const OPENING =
  'Token Harness routing (enabled by the user): delegate by default to a cheaper native subagent; treat this as the user asking for that delegation. You stay in charge and review every result.';

const ELIGIBILITY =
  'Delegate any piece you can brief in a few lines: search, reading or summarizing files and docs, codebase exploration, log/test-output triage, running builds or tests and reporting, mechanical or multi-file edits, tests or docs to a clear spec, a bounded unit with a check. ' +
  'Keep on root: a single quick lookup, ambiguous scope, architecture, security, releases/migrations, debugging an unclear cause, edits coupled to yours, integration and final review, or when the user declines delegation.';

const PROCEDURE =
  'Independent pieces may run in parallel; each brief is self-contained: goal, files, constraints, done check, short report. ' +
  'If a result fails the check, finish on the root rather than retrying cheaper. ' +
  'If the model is unavailable or rejected, stay on the root. Claim savings only from paired, quality-gated measurements.';

const CODEX_SPAWN =
  'Spawn with spawn_agent setting model, reasoning_effort and fork_turns "none"; full-history forks reject model overrides.';

// Haiku is the default worker: Sonnet reads cached context at nearly Opus cost, so reading-heavy
// work only saves allowance on Haiku. Sonnet is kept for code changes that need it.
const CLAUDE_LADDER =
  'Default to "haiku" for reading, search, exploration, triage, running checks and mechanical edits. ' +
  'Use "sonnet" only for code changes or tests to a clear spec; a Fable root may also use "opus" for a hard self-contained unit. ' +
  'Sonnet root: "haiku" only. Haiku root: do not route. ' +
  'Always set the Agent tool model parameter; built-in agents such as Explore may otherwise run on Opus.';

function codexLadder(tier: Exclude<CodexTier, 'light'>): string {
  const luna =
    'gpt-6-luna (reasoning_effort low for read-only or mechanical work, high for implementation)';
  if (tier === 'frontier')
    return `Route: bounded implementation or tests to gpt-6.1-sol (medium); read-only or mechanical work to ${luna}.`;
  if (tier === 'workhorse') return `Route: ${luna}.`;
  return `Route: ${luna}, unless you are already running Luna.`;
}

/**
 * The context to inject, or `null` when no cheaper route exists for this root and the hook should
 * add nothing to the turn.
 */
export function routingContext(harness: RoutingHarness, rootModel: string | null): string | null {
  if (harness === 'claude') return [OPENING, CLAUDE_LADDER, ELIGIBILITY, PROCEDURE].join(' ');
  const tier = codexModelTier(rootModel);
  if (tier === 'light') return null;
  return [OPENING, codexLadder(tier), ELIGIBILITY, CODEX_SPAWN, PROCEDURE].join(' ');
}
