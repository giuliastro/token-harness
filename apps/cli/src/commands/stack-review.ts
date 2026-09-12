import {
  EXIT_CODES,
  commandResult,
  fingerprintConfiguredStack,
  type CommandResult,
  type StackCombinationReviewCaptureReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { runDoctor } from './doctor.js';

/**
 * Capture the exact configured multi-provider identity without deciding compatibility.
 * A reviewer can use the JSON output together with real verification/benchmark evidence
 * to create a deliberate registry record later.
 */
export async function runStackReview(
  context: CommandContext,
): Promise<CommandResult<StackCombinationReviewCaptureReport>> {
  const doctor = await runDoctor(context);
  const detections = doctor.data?.providers ?? [];
  const fingerprint = fingerprintConfiguredStack(detections);
  const ready = fingerprint !== null;

  return commandResult({
    command: 'stack-review',
    exitCode: EXIT_CODES.ok,
    diagnostics: [...doctor.diagnostics],
    data: {
      capturedAt: context.now(),
      ready,
      fingerprint,
      reviewState: 'pending-manual-decision',
      instructions: ready
        ? [
            'Test this exact provider/version/harness combination together; individual provider health is not sufficient.',
            'Record the real verification and benchmark evidence used for the decision.',
            'Only then add an exact reviewed or incompatible record to the shipped registry.',
          ]
        : [
            'Configure at least two managed optimization providers on this machine, then run stack-review again.',
          ],
    },
  });
}
