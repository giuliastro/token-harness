/** Safe, progressive onboarding composed from the ordinary CLI commands. */

import {
  EXIT_CODES,
  commandResult,
  type CommandResult,
  type ApplyReport,
  type BudgetReport,
  type Diagnostic,
  type DoctorReport,
  type PlanReport,
  type SetupReport,
  type VerifyReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { runApply } from './apply.js';
import { runBudget } from './budget.js';
import { runDoctor } from './doctor.js';
import { runPlan } from './plan.js';
import { runVerify } from './verify.js';

function uniqueDiagnostics(groups: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.filter((entry) => {
      const key = `${entry.severity}\0${entry.code}\0${entry.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

export interface SetupOperations {
  doctor(context: CommandContext): Promise<CommandResult<DoctorReport>>;
  plan(context: CommandContext): Promise<CommandResult<PlanReport>>;
  apply(context: CommandContext): Promise<CommandResult<ApplyReport>>;
  verify(context: CommandContext): Promise<CommandResult<VerifyReport>>;
  budget(context: CommandContext): Promise<CommandResult<BudgetReport>>;
}

const DEFAULT_OPERATIONS: SetupOperations = {
  doctor: runDoctor,
  plan: runPlan,
  apply: runApply,
  verify: runVerify,
  budget: runBudget,
};

export async function runSetup(
  context: CommandContext,
  operations: SetupOperations = DEFAULT_OPERATIONS,
): Promise<CommandResult<SetupReport>> {
  const doctor = await operations.doctor(context);
  const detectedHarnesses = (doctor.data?.harnesses ?? []).filter(
    (harness) =>
      harness.state !== 'absent' &&
      (context.harness !== null
        ? harness.harnessId === context.harness
        : harness.harnessId === 'claude' || harness.harnessId === 'codex'),
  );
  const baseDoctor = doctor.data;

  if (baseDoctor === null) {
    return commandResult({
      command: 'setup',
      exitCode: doctor.exitCode,
      diagnostics: doctor.diagnostics,
    });
  }

  if (detectedHarnesses.length === 0) {
    return commandResult({
      command: 'setup',
      exitCode: EXIT_CODES.ok,
      data: {
        stage: 'needs-harness',
        changed: false,
        doctor: baseDoctor,
        plan: null,
        apply: null,
        verify: null,
        budget: null,
        nextStep: {
          command: null,
          description: 'Install and sign in to Claude Code or Codex, then run setup again.',
        },
      },
      diagnostics: doctor.diagnostics,
    });
  }

  /**
   * `doctor` deliberately reports a newer-than-tested version as a problem because its job is to
   * inventory every conservative boundary on the machine. Guided setup asks a narrower question:
   * "is the integration I am about to use actually broken?" A newer version is therefore a
   * limitation to surface and verify, not a reason to stop before verification. Likewise an
   * unrelated detected harness (for example Pi when setup is guiding Claude/Codex) must not block
   * the main onboarding path.
   */
  const setupHarnessIds = new Set(detectedHarnesses.map((harness) => harness.harnessId));
  const hasBrokenSetupIntegration =
    detectedHarnesses.some((harness) => harness.state === 'broken') ||
    baseDoctor.providers.some(
      (provider) =>
        provider.state === 'broken' &&
        provider.configuredHarnesses.some((harness) => setupHarnessIds.has(harness)),
    );

  if (hasBrokenSetupIntegration) {
    return commandResult({
      command: 'setup',
      exitCode: EXIT_CODES['problems-found'],
      data: {
        stage: 'attention',
        changed: false,
        doctor: baseDoctor,
        plan: null,
        apply: null,
        verify: null,
        budget: null,
        nextStep: {
          command: 'token-harness doctor --verbose',
          description: 'Review the broken active integration before changing configuration.',
        },
      },
      diagnostics: doctor.diagnostics,
    });
  }

  const presentIds = new Set(detectedHarnesses.map((harness) => harness.harnessId));
  const hasActiveProvider = baseDoctor.providers.some(
    (provider) =>
      provider.state === 'configured' &&
      provider.configuredHarnesses.some((harness) => presentIds.has(harness)),
  );

  if (hasActiveProvider) {
    const activeHarness =
      context.harness ??
      detectedHarnesses.find((harness) =>
        baseDoctor.providers.some((provider) =>
          provider.configuredHarnesses.includes(harness.harnessId),
        ),
      )?.harnessId ??
      null;
    const observationContext: CommandContext = { ...context, harness: activeHarness };
    const [verify, budget] = await Promise.all([
      operations.verify(observationContext),
      operations.budget(observationContext),
    ]);
    const healthy = verify.data?.healthyAtDeclaredTier === true;
    return commandResult({
      command: 'setup',
      exitCode: healthy ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
      data: {
        stage: healthy ? 'ready' : 'attention',
        changed: false,
        doctor: baseDoctor,
        plan: null,
        apply: null,
        verify: verify.data,
        budget: budget.data,
        nextStep: healthy
          ? {
              command: 'token-harness ui',
              description:
                'Open the dashboard once to review status; then use your coding agent normally.',
            }
          : {
              command: 'token-harness verify --verbose',
              description: 'Review the failed integration check.',
            },
      },
      diagnostics: uniqueDiagnostics([doctor.diagnostics, verify.diagnostics, budget.diagnostics]),
    });
  }

  const preferredHarness =
    context.harness ??
    detectedHarnesses.find((harness) => harness.harnessId === 'codex')?.harnessId ??
    detectedHarnesses[0]?.harnessId ??
    null;
  const setupContext: CommandContext = { ...context, harness: preferredHarness };
  const plan = await operations.plan(setupContext);
  if (
    plan.data === null ||
    plan.exitCode !== EXIT_CODES.ok ||
    plan.data.actions.length === 0 ||
    !plan.data.persisted
  ) {
    return commandResult({
      command: 'setup',
      exitCode: plan.exitCode === EXIT_CODES.ok ? EXIT_CODES['problems-found'] : plan.exitCode,
      data: {
        stage: 'attention',
        changed: false,
        doctor: baseDoctor,
        plan: plan.data,
        apply: null,
        verify: null,
        budget: null,
        nextStep: {
          command: 'token-harness plan --verbose',
          description: 'Review why no safe automatic configuration is available.',
        },
      },
      diagnostics: uniqueDiagnostics([doctor.diagnostics, plan.diagnostics]),
    });
  }

  if (!context.confirmed) {
    return commandResult({
      command: 'setup',
      exitCode: EXIT_CODES.ok,
      data: {
        stage: 'ready-to-configure',
        changed: false,
        doctor: baseDoctor,
        plan: plan.data,
        apply: null,
        verify: null,
        budget: null,
        nextStep: {
          command: 'token-harness setup --yes',
          description: 'Apply the reviewed, reversible configuration.',
        },
      },
      diagnostics: uniqueDiagnostics([doctor.diagnostics, plan.diagnostics]),
    });
  }

  const applied = await operations.apply({
    ...setupContext,
    planId: plan.data.planId,
    confirmed: true,
  });
  if (applied.data?.outcome !== 'committed' && applied.data?.outcome !== 'nothing-to-do') {
    return commandResult({
      command: 'setup',
      exitCode: applied.exitCode,
      data: {
        stage: 'attention',
        changed: false,
        doctor: baseDoctor,
        plan: plan.data,
        apply: applied.data,
        verify: null,
        budget: null,
        nextStep: {
          command: 'token-harness verify --verbose',
          description: 'Review the configuration result before continuing.',
        },
      },
      diagnostics: uniqueDiagnostics([doctor.diagnostics, plan.diagnostics, applied.diagnostics]),
    });
  }

  const [verify, budget] = await Promise.all([
    operations.verify(setupContext),
    operations.budget(setupContext),
  ]);
  const healthy = verify.data?.healthyAtDeclaredTier === true;
  const changed = applied.data?.results.some((result) => result.status === 'applied') === true;
  return commandResult({
    command: 'setup',
    exitCode: healthy ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: {
      stage: healthy ? 'ready' : 'attention',
      changed,
      doctor: baseDoctor,
      plan: plan.data,
      apply: applied.data,
      verify: verify.data,
      budget: budget.data,
      nextStep: healthy
        ? {
            command: 'token-harness ui',
            description:
              'Open the dashboard once to review status; then use your coding agent normally.',
          }
        : {
            command: 'token-harness verify --verbose',
            description: 'Review the failed integration check.',
          },
    },
    diagnostics: uniqueDiagnostics([
      doctor.diagnostics,
      plan.diagnostics,
      applied.diagnostics,
      verify.diagnostics,
      budget.diagnostics,
    ]),
  });
}
