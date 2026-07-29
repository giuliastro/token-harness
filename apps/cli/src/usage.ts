/**
 * Usage text.
 *
 * The command list mirrors RFC 0001 §CLI contract. Commands this build does not
 * carry are shown and marked, rather than hidden: a user who reads `--help` and
 * then types `apply` should already know why it fails.
 */

import type { AvailableCommand } from './argv.js';

const ROOT_USAGE = `token-harness — one control plane for token-efficient coding agents

Usage
  token-harness <command> [flags]

Commands
  doctor      Report detected harnesses and providers
  plan        Compute a dry-run plan; nothing is changed
  status      Report applied pipelines, drift, and importer modes
  apply       Not in this build
  verify      Not in this build
  metrics     Not in this build
  update      Not in this build
  rollback    Not in this build
  uninstall   Not in this build

Flags
  --json               Emit one machine-readable envelope on stdout
  --harness <id>       Restrict the operation to one harness
  --provider <id>      Restrict the operation to one provider
  --project <dir>      Operate on that project instead of the current directory
  --version            Print the version and exit 0
  --help               Print usage and exit 0

Mutating commands are dry-run by default and there is no flag that skips
planning. Exit codes and the JSON envelope are specified in RFC 0006.`;

const COMMAND_USAGE: Readonly<Record<AvailableCommand, string>> = {
  doctor: `token-harness doctor — report detected harnesses and providers

Usage
  token-harness doctor [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when nothing is broken, and 3 when an integration is broken,
an exclusive scope carries an unowned entry, a version is outside its tested
range, or a verification fell below its declared tier. An empty environment is a
state, not a problem.`,
  plan: `token-harness plan — compute a dry-run plan

Usage
  token-harness plan [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when a plan was produced, and 4 when a hard conflict prevents
apply. Nothing is changed either way.`,
  status: `token-harness status — report applied pipelines, drift, and importer modes

Usage
  token-harness status [--json] [--harness <id>] [--provider <id>] [--project <dir>]

Read-only. Exits 0 when the live environment still matches the installation
receipt, and 3 when it does not. Drift is reported, never silently repaired.`,
};

export function usageText(topic: AvailableCommand | null): string {
  return topic === null ? ROOT_USAGE : COMMAND_USAGE[topic];
}
