import { scheduleCapacityMain } from './schedule-capacity-main.js';
import { hasMixedWorkloadFlag, scheduleMixedWorkloadMain } from './schedule-mixed-workload.js';
import type { ScheduleRuntime } from './schedule-main.js';

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

const MIXED_HELP = `
Mixed queued-workload mode
  token-harness schedule --current <claude|codex> --candidate <claude|codex> \\
    --workload mechanical=2,standard=3,hard=1

  --workload <class=count,...>  Allocate a new-task backlog by task class using empirical
                                five-hour + weekly accepted-task capacity. It is mutually
                                exclusive with --task-class, --tasks-left, manual pace/quality,
                                handoff, and transfer-benefit flags.

Mixed mode is advisory and never launches a harness. Candidate assignments require at least three
coherent quality-gated observations for that exact task class plus complete five-hour/weekly
capacity evidence. Unproven work stays unallocated rather than becoming a guessed switch.
`;

export async function scheduleDispatchMain(
  argv: readonly string[],
  streams?: Streams,
  runtime?: ScheduleRuntime,
): Promise<number> {
  if (hasMixedWorkloadFlag(argv) && !argv.includes('--help') && !argv.includes('--version')) {
    return scheduleMixedWorkloadMain(argv, streams, runtime);
  }

  if (argv.includes('--help') && !argv.includes('--json')) {
    const output =
      streams ??
      ({
        out: (text: string) => process.stdout.write(text),
        err: (text: string) => process.stderr.write(text),
      } satisfies Streams);
    const exitCode = await scheduleCapacityMain(argv, output, runtime);
    output.out(MIXED_HELP);
    return exitCode;
  }

  return scheduleCapacityMain(argv, streams, runtime);
}
