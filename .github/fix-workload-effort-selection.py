from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'expected one anchor in {path}, got {text.count(old)}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'apps/cli/src/commands/optimize.ts',
    """  const workloadCoverage = assessWorkloadCoverage({
    tasksRemaining: input.tasksRemaining,
    capacity: workloadCapacity,
  });
  const budgetDecision = constrainBudgetForWorkload(
    assessBudgetDecision(budgetWindows, taskClass),
    workloadCoverage,
  );
""",
    """  const workloadCoverage = assessWorkloadCoverage({
    tasksRemaining: input.tasksRemaining,
    capacity: workloadCapacity,
  });
  const rawBudgetDecision = assessBudgetDecision(budgetWindows, taskClass);
  const budgetDecision = constrainBudgetForWorkload(rawBudgetDecision, workloadCoverage);
  // A workload shortfall can suppress quota-derived headroom and veto costlier learned recovery,
  // but it is not independent quality evidence for lowering the profile's base effort.
  const effortBudgetDecision =
    workloadCoverage.protectCapacity &&
    rawBudgetDecision.state !== 'conserve' &&
    rawBudgetDecision.state !== 'wait-for-reset'
      ? {
          ...rawBudgetDecision,
          allowEffortIncrease: false,
          reasons: budgetDecision.reasons,
        }
      : budgetDecision;
""",
)

replace_once(
    'apps/cli/src/commands/optimize.ts',
    """          pace: budgetWindows,
          contextPressure: pressure.pressure,
          budgetDecision,
        });
""",
    """          pace: budgetWindows,
          contextPressure: pressure.pressure,
          budgetDecision: effortBudgetDecision,
        });
""",
)

replace_once(
    'tests/integration/workload-aware-optimize.test.ts',
    "    assert.equal(advice.recommendedEffort, 'low');\n",
    "    assert.equal(advice.recommendedEffort, 'medium');\n",
)
