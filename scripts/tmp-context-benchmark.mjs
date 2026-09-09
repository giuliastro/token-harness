import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [from, to] of replacements) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${path}: expected one anchor, found ${count}: ${from.slice(0, 80)}`);
    text = text.replace(from, to);
  }
  await writeFile(path, text);
}

await patch('packages/core/src/domain/benchmark.ts', [
  [
    "import type { UsageConfidence, UsageWindowSnapshot } from './budget.js';\nimport type { BenchmarkPolicySnapshot } from './context-cost.js';",
    "import type { UsageConfidence, UsageWindowSnapshot } from './budget.js';\nimport {\n  parseTaskBenchmarkContextSnapshot,\n  type TaskBenchmarkContextSnapshot,\n} from './benchmark-context.js';\nimport type { BenchmarkPolicySnapshot } from './context-cost.js';",
  ],
  [
    "  usageBefore: UsageWindowSnapshot[];\n  usageAfter: UsageWindowSnapshot[];\n  /** Local token volume is evidence about workload, not backend subscription quota. */",
    "  usageBefore: UsageWindowSnapshot[];\n  usageAfter: UsageWindowSnapshot[];\n  /** Additive schema-1 context witness. Inventory/exposure is not subscription quota. */\n  contextAtStart?: TaskBenchmarkContextSnapshot | null;\n  /** Additive schema-1 context witness captured at task completion. */\n  contextAtFinish?: TaskBenchmarkContextSnapshot | null;\n  /** Local token volume is evidence about workload, not backend subscription quota. */",
  ],
  [
    "  usageBefore: UsageWindowSnapshot[];\n  /**\n   * Cumulative ccusage session counters at start, or null when local history was unavailable.",
    "  usageBefore: UsageWindowSnapshot[];\n  /** Additive schema-1 context witness captured before the task starts. */\n  contextAtStart?: TaskBenchmarkContextSnapshot | null;\n  /**\n   * Cumulative ccusage session counters at start, or null when local history was unavailable.",
  ],
  [
    "  const parsedLocalSessions = parseLocalSessionSnapshots(row['localSessionsBefore']);\n  const localSessionsBefore = parsedLocalSessions === undefined ? null : parsedLocalSessions;",
    "  const parsedLocalSessions = parseLocalSessionSnapshots(row['localSessionsBefore']);\n  const localSessionsBefore = parsedLocalSessions === undefined ? null : parsedLocalSessions;\n  const hasContextAtStart = Object.hasOwn(row, 'contextAtStart');\n  const contextAtStart = hasContextAtStart\n    ? parseTaskBenchmarkContextSnapshot(row['contextAtStart'])\n    : undefined;",
  ],
  [
    "    usageBefore === null ||\n    parsedLocalSessions === undefined\n  ) {",
    "    usageBefore === null ||\n    parsedLocalSessions === undefined ||\n    (hasContextAtStart && contextAtStart === undefined)\n  ) {",
  ],
  [
    "      usageBefore,\n      localSessionsBefore,\n    },",
    "      usageBefore,\n      ...(hasContextAtStart ? { contextAtStart: contextAtStart ?? null } : {}),\n      localSessionsBefore,\n    },",
  ],
  [
    "  const hasBoundaryPolicy = Object.hasOwn(row, 'policyAtFinish');\n  const policyAtFinish = hasBoundaryPolicy ? parseBoundaryPolicy(row['policyAtFinish']) : undefined;",
    "  const hasBoundaryPolicy = Object.hasOwn(row, 'policyAtFinish');\n  const policyAtFinish = hasBoundaryPolicy ? parseBoundaryPolicy(row['policyAtFinish']) : undefined;\n  const hasContextAtStart = Object.hasOwn(row, 'contextAtStart');\n  const contextAtStart = hasContextAtStart\n    ? parseTaskBenchmarkContextSnapshot(row['contextAtStart'])\n    : undefined;\n  const hasContextAtFinish = Object.hasOwn(row, 'contextAtFinish');\n  const contextAtFinish = hasContextAtFinish\n    ? parseTaskBenchmarkContextSnapshot(row['contextAtFinish'])\n    : undefined;",
  ],
  [
    "    outcome === null ||\n    (hasBoundaryPolicy && policyAtFinish === undefined)\n  ) {",
    "    outcome === null ||\n    (hasBoundaryPolicy && policyAtFinish === undefined) ||\n    (hasContextAtStart && contextAtStart === undefined) ||\n    (hasContextAtFinish && contextAtFinish === undefined)\n  ) {",
  ],
  [
    "      localUsage,\n      outcome,\n      ...(hasBoundaryPolicy ? { policyAtFinish: policyAtFinish ?? null } : {}),",
    "      localUsage,\n      outcome,\n      ...(hasContextAtStart ? { contextAtStart: contextAtStart ?? null } : {}),\n      ...(hasContextAtFinish ? { contextAtFinish: contextAtFinish ?? null } : {}),\n      ...(hasBoundaryPolicy ? { policyAtFinish: policyAtFinish ?? null } : {}),",
  ],
  [
    "  localUsage?: TaskLocalUsage | null;\n  policyAtFinish?: BenchmarkPolicySnapshot | null;",
    "  localUsage?: TaskLocalUsage | null;\n  contextAtFinish?: TaskBenchmarkContextSnapshot | null;\n  policyAtFinish?: BenchmarkPolicySnapshot | null;",
  ],
  [
    "    usageAfter: input.usageAfter,\n    localUsage: input.localUsage ?? null,\n    ...(input.policyAtFinish !== undefined ? { policyAtFinish: input.policyAtFinish } : {}),",
    "    usageAfter: input.usageAfter,\n    localUsage: input.localUsage ?? null,\n    ...(capture.contextAtStart !== undefined ? { contextAtStart: capture.contextAtStart } : {}),\n    ...(input.contextAtFinish !== undefined ? { contextAtFinish: input.contextAtFinish } : {}),\n    ...(input.policyAtFinish !== undefined ? { policyAtFinish: input.policyAtFinish } : {}),",
  ],
]);

await patch('apps/cli/src/commands/benchmark-capture.ts', [
  [
    "  snapshotTaskLocalSessions,\n  type CommandResult,",
    "  snapshotTaskLocalSessions,\n  taskBenchmarkContextSnapshot,\n  type CommandResult,",
  ],
  [
    "  const policy = benchmarkPolicySnapshot(\n    contextResult.data?.harnesses.find((item) => item.harnessId === harness),\n  );",
    "  const contextObservation = contextResult.data?.harnesses.find(\n    (item) => item.harnessId === harness,\n  );\n  const policy = benchmarkPolicySnapshot(contextObservation);\n  const contextAtStart = taskBenchmarkContextSnapshot(contextObservation);",
  ],
  [
    "    usageBefore: budget?.windows ?? [],\n    localSessionsBefore,",
    "    usageBefore: budget?.windows ?? [],\n    contextAtStart,\n    localSessionsBefore,",
  ],
  [
    "  const completed = completeTaskBenchmarkCapture(parsed.capture, {\n    completedAt,",
    "  const finishContextObservation = contextResult.data?.harnesses.find(\n    (item) => item.harnessId === parsed.capture.harnessId,\n  );\n  const completed = completeTaskBenchmarkCapture(parsed.capture, {\n    completedAt,",
  ],
  [
    "    localUsage,\n    policyAtFinish: benchmarkPolicySnapshot(\n      contextResult.data?.harnesses.find((item) => item.harnessId === parsed.capture.harnessId),\n    ),",
    "    localUsage,\n    contextAtFinish: taskBenchmarkContextSnapshot(finishContextObservation),\n    policyAtFinish: benchmarkPolicySnapshot(finishContextObservation),",
  ],
]);
