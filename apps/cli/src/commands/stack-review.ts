import {
  EXIT_CODES,
  commandResult,
  fingerprintConfiguredStack,
  summarizeStackCombinationVerification,
  type CommandResult,
  type StackCombinationReviewCaptureReport,
  type StackCombinationVerificationEvidence,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { runDoctor } from './doctor.js';
import { runVerify } from './verify.js';

function describePairs(rows: readonly StackCombinationVerificationEvidence[]): string {
  return rows.map((row) => `${row.providerId} on ${row.harnessId}`).join(', ');
}

function reviewInstructions(
  ready: boolean,
  evidence: readonly StackCombinationVerificationEvidence[],
): string[] {
  if (!ready) {
    return [
      'Configure at least two managed optimization providers on this machine, then run stack-review again.',
    ];
  }

  const instructions = [
    'Test this exact provider/version/harness combination together; individual provider health is not sufficient.',
  ];
  const failed = evidence.filter((row) => row.runtimeEvidence === 'failed');
  const notExercised = evidence.filter((row) => row.runtimeEvidence === 'not-exercised');
  const unavailable = evidence.filter((row) => row.runtimeEvidence === 'unavailable');

  if (failed.length > 0) {
    instructions.push(
      `Resolve failed or degraded passive verification before review: ${describePairs(failed)}.`,
    );
  }
  if (notExercised.length > 0) {
    instructions.push(
      `Passive runtime evidence is still missing for: ${describePairs(notExercised)}. Normal agent use may produce no receipt.`,
      'Generate an operation the provider is guaranteed to record, then rerun verify and stack-review; for reducers this means a qualifying reduction. If that cannot be produced deterministically without extra cost, retain controlled benchmark or manual evidence instead.',
    );
  }
  if (unavailable.length > 0) {
    instructions.push(
      `No passive runtime witness is available for: ${describePairs(unavailable)}. Retain controlled benchmark or manual evidence for those pairs.`,
    );
  }
  if (evidence.length > 0 && evidence.every((row) => row.runtimeEvidence === 'observed')) {
    instructions.push(
      'Passive runtime evidence is observed for every configured provider/harness pair; retain controlled combined-stack benchmark evidence before deciding compatibility.',
    );
  } else {
    instructions.push(
      'Record the remaining real verification and combined-stack benchmark evidence used for the decision.',
    );
  }
  instructions.push(
    'Only then add an exact reviewed or incompatible record to the shipped registry.',
  );
  return instructions;
}

/**
 * Capture the exact configured multi-provider identity without deciding compatibility.
 * Passive verification is reused only to make evidence gaps explicit. No active canary,
 * benchmark, provider mutation, or compatibility decision is performed here.
 */
export async function runStackReview(
  context: CommandContext,
): Promise<CommandResult<StackCombinationReviewCaptureReport>> {
  const doctor = await runDoctor(context);
  const detections = doctor.data?.providers ?? [];
  const fingerprint = fingerprintConfiguredStack(detections);
  const ready = fingerprint !== null;
  const verify = ready ? await runVerify(context) : null;
  const verificationEvidence = summarizeStackCombinationVerification(
    fingerprint,
    verify?.data?.results ?? [],
  );

  return commandResult({
    command: 'stack-review',
    exitCode: EXIT_CODES.ok,
    diagnostics: [...doctor.diagnostics],
    data: {
      capturedAt: context.now(),
      ready,
      fingerprint,
      verificationEvidence,
      reviewState: 'pending-manual-decision',
      instructions: reviewInstructions(ready, verificationEvidence),
    },
  });
}
