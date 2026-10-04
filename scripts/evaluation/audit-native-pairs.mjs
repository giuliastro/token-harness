/** Read-only audit of native recordings. Default is preview; --apply writes one new sanitized file. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tasks } from './paired-native-fixtures.mjs';

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--input') || !args.includes('--fingerprint'))
  throw new Error(
    'Use --input <recording-directory> --fingerprint <recorded.json> [--output <new.json> --apply]',
  );
if (args.includes('--apply') && !args.includes('--output'))
  throw new Error('--apply requires --output');
const root = path.resolve(value('--input'));
const fingerprint = JSON.parse(await fs.readFile(path.resolve(value('--fingerprint')), 'utf8'));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = async (file) => fs.readFile(file, 'utf8');
const jsonl = (text) =>
  text
    .trim()
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
const results = [];
for (const harness of ['claude', 'codex']) {
  for (const taskClass of Object.keys(tasks)) {
    const task = tasks[taskClass];
    const variants = [];
    for (const variant of ['baseline', 'optimized']) {
      const folder = path.join(root, `${harness}-${taskClass}`, variant);
      const [receiptText, protocolText, stream, checks, acceptance, solution] = await Promise.all([
        read(path.join(folder, 'receipt.json')),
        read(path.join(folder, 'protocol.json')),
        read(path.join(folder, 'native-output.jsonl')),
        read(path.join(folder, 'acceptance.log')),
        read(path.join(folder, 'acceptance.test.mjs')),
        read(path.join(folder, 'solution.mjs')),
      ]);
      const receipt = JSON.parse(receiptText);
      const protocol = JSON.parse(protocolText);
      const events = jsonl(stream);
      const completed = events.findLast(
        (event) => event.type === 'result' || event.type === 'turn.completed',
      );
      if (!completed?.usage)
        throw new Error(`Missing native usage: ${harness}-${taskClass}-${variant}`);
      const usage = completed.usage;
      const reportedTotal =
        harness === 'codex'
          ? usage.input_tokens + usage.output_tokens
          : usage.input_tokens +
            usage.cache_creation_input_tokens +
            usage.cache_read_input_tokens +
            usage.output_tokens;
      if (reportedTotal !== receipt.localUsage?.totalTokens)
        throw new Error(`Native usage does not match receipt: ${harness}-${taskClass}-${variant}`);
      const content = events.flatMap((event) => event.message?.content ?? []);
      const tools = content.filter((item) => item.type === 'tool_use' && item.name === 'Bash');
      const returns = content.filter((item) => item.type === 'tool_result');
      const commands =
        harness === 'codex'
          ? events
              .filter(
                (event) =>
                  event.type === 'item.completed' && event.item?.type === 'command_execution',
              )
              .map((event) => ({
                command: event.item.command,
                output: event.item.aggregated_output ?? '',
                failed: event.item.exit_code !== 0,
              }))
          : tools.map((tool) => {
              const responses = returns.filter((item) => item.tool_use_id === tool.id);
              return {
                command: tool.input.command,
                output: responses.map((item) => String(item.content)).join('\n'),
                failed: responses.length === 0 || responses.some((item) => item.is_error === true),
              };
            });
      const testCommands = commands.filter((command) => /node.*--test/.test(command.command));
      const failedTests = testCommands.filter(
        (command) => command.failed || /(?:^|\n)# fail [1-9]/.test(command.output),
      );
      const failedTools = commands.filter((command) => command.failed);
      const testsFrozen = sha(acceptance) === sha(task.tests + '\n');
      const independentPass =
        protocol.checkExitCode === 0 && /(?:^|\n)# fail 0(?:\r?\n|$)/.test(checks);
      const codeAccepted = testsFrozen && independentPass && protocol.nativeExitCode === 0;
      const errorCodes = [
        ...new Set([
          ...receipt.outcome.errorCodes,
          ...(!testsFrozen ? ['acceptance-file-modified'] : []),
          ...(!independentPass ? ['independent-acceptance-failed'] : []),
          ...(failedTools.length ? ['native-tool-execution-failed'] : []),
          ...(!testCommands.length ? ['native-validation-not-observed'] : []),
        ]),
      ];
      const metricsPath = path.join(folder, '.harnesstrim', 'metrics.jsonl');
      const metrics = jsonl(
        await read(metricsPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        }),
      ).filter(
        (event) =>
          event.harness === harness &&
          event.ts >= receipt.startedAt &&
          event.ts <= receipt.completedAt,
      );
      const harnesstrim = metrics.map((event) => ({
        eventId: event.eventId,
        observedAt: event.ts,
        reducer: event.reducer,
        beforeChars: event.beforeChars,
        afterChars: event.afterChars,
        changed: event.changed,
        reductionFailed: event.reductionFailed,
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
      }));
      const quotaReason =
        harness === 'codex'
          ? 'Excluded from task comparison: the parent Codex chat was active on the same account.'
          : 'Native authoritative allowance windows were unavailable.';
      const auditedReceipt = {
        ...receipt,
        // The observations remain authoritative account facts. They are not attributable task costs.
        usageBefore: [],
        usageAfter: [],
        outcome: {
          qualityGate: codeAccepted && errorCodes.length === 0 ? 'passed' : 'failed',
          attempts: Math.max(1, failedTests.length + 1),
          failedAttempts: failedTests.length,
          errorCodes,
        },
      };
      variants.push({
        variant,
        receipt: auditedReceipt,
        acceptedCode: codeAccepted,
        testsFrozen,
        acceptanceTests: Number(/^# tests (\d+)/m.exec(checks)?.[1] ?? 0),
        nativeValidationCalls: testCommands.length,
        failedValidationCalls: failedTests.length,
        nativeToolFailures: failedTools.length,
        failedProviderCommands: failedTools.filter((command) =>
          command.command.includes('__internal-rtk-run'),
        ).length,
        wallClockMs: protocol.wallClockMs,
        billedApiCost: null,
        listPriceEstimateUsd: protocol.listPriceEstimate,
        accountObservations: {
          before: receipt.usageBefore,
          after: receipt.usageAfter,
          taskAttribution: 'unavailable',
          reason: quotaReason,
        },
        promptCallbackDelta: protocol.callbackDelta,
        harnesstrim,
        sourceHashes: {
          initial: sha(task.source),
          acceptance: sha(acceptance),
          final: sha(solution),
          nativeStream: sha(stream),
          independentValidation: sha(checks),
          originalReceipt: sha(receiptText),
          originalProtocol: sha(protocolText),
        },
      });
    }
    results.push({
      id: `native-win-${harness}-${taskClass}`,
      harness,
      taskClass,
      order: taskClass === 'standard' ? ['optimized', 'baseline'] : ['baseline', 'optimized'],
      variants,
    });
  }
}
const output = {
  schemaVersion: 1,
  capturedOn: results[0].variants[0].receipt.startedAt.slice(0, 10),
  platform: fingerprint.platform,
  fingerprint,
  limitations: [
    'One trial per profile/class; no confidence interval or universal benefit claim.',
    'Joint RTK + HarnessTrim + routing profile; marginal routing value was not isolated.',
    'Codex workspace-write trials passed code acceptance but their RTK commands failed twice each.',
    'Quota snapshots are account observations only, excluded from task receipts due to concurrent parent activity.',
    'Claude list price estimates are not billed API cost. Local tokens, characters and quota remain separate.',
    'No subagents were requested in these fixtures. Prompt callbacks alone do not prove a child model.',
    'These recordings predate the pinned Windows RTK launcher repair; later canaries are a separate evidence class.',
  ],
  pairs: results,
};
if (args.includes('--apply')) {
  const destination = path.resolve(value('--output'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
}
console.log(
  JSON.stringify(
    {
      dryRun: !args.includes('--apply'),
      pairs: results.map((pair) => ({
        id: pair.id,
        variants: pair.variants.map((variant) => ({
          variant: variant.variant,
          acceptedCode: variant.acceptedCode,
          comparisonQuality: variant.receipt.outcome.qualityGate,
          localTokens: variant.receipt.localUsage.totalTokens,
          nativeToolFailures: variant.nativeToolFailures,
          failedValidationCalls: variant.failedValidationCalls,
          callbackDelta: variant.promptCallbackDelta,
        })),
      })),
    },
    null,
    2,
  ),
);
