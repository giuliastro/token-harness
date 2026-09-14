import type { ApplyReport, CommandResult } from '@token-harness/core';

import type { CommandContext } from './context.js';
import {
  runGitNexusCandidateApply,
  runGitNexusCandidateUninstall,
} from './gitnexus-candidate-lifecycle.js';
import {
  runCandidateApply as runMcptoonCandidateApply,
  runCandidateUninstall as runMcptoonCandidateUninstall,
} from './mcptoon-candidate-lifecycle.js';

/** Candidate lifecycle router. Candidate-specific implementations remain isolated and fail closed. */
export function runCandidateApply(context: CommandContext): Promise<CommandResult<ApplyReport>> {
  return context.optimizationCandidate === 'gitnexus'
    ? runGitNexusCandidateApply(context)
    : runMcptoonCandidateApply(context);
}

export function runCandidateUninstall(context: CommandContext): Promise<CommandResult<ApplyReport>> {
  return context.optimizationCandidate === 'gitnexus'
    ? runGitNexusCandidateUninstall(context)
    : runMcptoonCandidateUninstall(context);
}
