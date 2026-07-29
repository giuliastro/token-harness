/**
 * Programmatic surface of the CLI package.
 *
 * The golden-file suite in `tests/integration` renders reports through these
 * exports rather than by spawning a process: the transcripts are a contract
 * about rendering, and testing them through a subprocess would only add a shell
 * between the assertion and the thing being asserted.
 */

export { run, DEFAULT_COMMANDS, type RunOptions, type Streams, type CommandTable } from './run.js';
export { main } from './main.js';
export {
  parseArgv,
  detectJsonMode,
  AVAILABLE_COMMANDS,
  PLANNED_COMMANDS,
  type AvailableCommand,
  type Invocation,
  type CommandOptions,
} from './argv.js';
export { usageText } from './usage.js';
export { TOOL_VERSION } from './version.js';
export type { CommandContext } from './commands/context.js';
export { runDoctor } from './commands/doctor.js';
export { runPlan } from './commands/plan.js';
export { runStatus } from './commands/status.js';
export * from './render/index.js';
