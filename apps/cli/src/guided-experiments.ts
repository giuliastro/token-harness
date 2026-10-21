import { randomBytes } from 'node:crypto';
import { isTaskBenchmarkId, type CliEnvelope } from '@token-harness/core';
import type { BenchmarkPrepareReport } from './commands/benchmark-prepare.js';
import { GuideError, type GuideCall } from './guided.js';

type Ticket = { id: string; expires: number; args: string[]; plan: string | null; summary: string };
const ARMS = ['baseline', 'compression-only', 'routing-only', 'combined'];
const TASKS = ['mechanical', 'standard', 'hard', 'critical'];
const messages = (envelope: CliEnvelope<unknown>) =>
  envelope.diagnostics.map((item) => item.message);

/** Server-held approvals bind factorial preparation to the existing engine's exact plan id. */
export function createGuideExperiments(
  call: GuideCall,
  now = Date.now,
  random = () => randomBytes(32).toString('hex'),
) {
  let ticket: Ticket | null = null;
  let busy = false;
  return async (input: unknown): Promise<unknown> => {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw new GuideError(400, 'Choose an experiment action.');
    const data = input as Record<string, unknown>;
    if (busy) throw new GuideError(409, 'Another experiment operation is running.');
    busy = true;
    try {
      if (data['mode'] === 'apply') {
        if (
          Object.keys(data).some((key) => !['mode', 'ticket'].includes(key)) ||
          typeof data['ticket'] !== 'string'
        )
          throw new GuideError(400, 'Only the reviewed ticket is accepted.');
        const approved = ticket;
        ticket = null;
        if (approved === null || approved.id !== data['ticket'] || now() >= approved.expires)
          throw new GuideError(409, 'Review a fresh experiment preview.');
        const args = [
          ...approved.args,
          ...(approved.plan === null ? [] : ['--plan', approved.plan]),
          '--yes',
        ];
        const result = await call<unknown>(args);
        return {
          ok: result.exitCode === 0,
          summary: approved.summary,
          messages: messages(result),
          verificationTier: 'config-only',
        };
      }
      ticket = null;
      const mode = data['mode'];
      const allowed =
        mode === 'prepare'
          ? ['mode', 'name', 'harness', 'task', 'variant', 'startingState']
          : mode === 'finish'
            ? ['mode', 'name', 'variant', 'quality', 'attempts', 'failedAttempts']
            : ['mode', 'name'];
      if (Object.keys(data).some((key) => !allowed.includes(key)))
        throw new GuideError(400, 'Unsupported experiment option.');
      const name = data['name'];
      if (typeof name !== 'string' || !/^[a-z0-9]{1,32}$/.test(name))
        throw new GuideError(400, 'Use 1–32 lowercase letters or digits for the comparison name.');
      const id = 'desktop-factorial-' + name;
      if (!isTaskBenchmarkId(id)) throw new GuideError(400, 'Invalid comparison name.');
      if (mode === 'report')
        return { envelope: await call(['benchmark-factorial', '--benchmark-id', id]) };
      const variant = data['variant'];
      if (typeof variant !== 'string' || !ARMS.includes(variant))
        throw new GuideError(400, 'Choose one of the four comparison arms.');
      let args: string[],
        plan: string | null = null,
        summary: string,
        files = 0;
      if (mode === 'prepare') {
        const harness = data['harness'],
          task = data['task'],
          state = data['startingState'];
        if (
          typeof harness !== 'string' ||
          !['claude', 'codex'].includes(harness) ||
          typeof task !== 'string' ||
          !TASKS.includes(task) ||
          typeof state !== 'string' ||
          !state.trim() ||
          state.length > 256
        )
          throw new GuideError(400, 'Choose an agent, task class and initial version or fixture.');
        args = [
          'benchmark-prepare',
          '--benchmark-id',
          id,
          '--variant',
          variant,
          '--harness',
          String(harness),
          '--task',
          String(task),
          '--starting-state=' + state,
        ];
        const preview = await call<BenchmarkPrepareReport>(args);
        if (preview.exitCode !== 0 || preview.data?.status !== 'planned')
          return { ticket: null, ok: false, messages: messages(preview) };
        plan = preview.data.planId;
        if (!/^[a-f0-9]{8}$/.test(plan))
          throw new GuideError(409, 'The preparation plan could not be verified.');
        files = preview.data.paths.length;
        summary =
          'Temporarily prepare ' +
          variant +
          ' for ' +
          String(harness) +
          ': compression ' +
          (preview.data.compression ? 'on' : 'off') +
          ', native routing ' +
          (preview.data.routing ? 'on' : 'off') +
          '. This can change owned user-level agent configuration as well as project settings. Finish restores the saved configuration. Start a fresh coding session and run the same task and acceptance checks in every arm.';
      } else if (mode === 'finish') {
        const quality = data['quality'],
          attempts = data['attempts'],
          failed = data['failedAttempts'];
        if (
          typeof quality !== 'string' ||
          !['passed', 'failed', 'unknown'].includes(quality) ||
          typeof attempts !== 'number' ||
          !Number.isInteger(attempts) ||
          attempts < 1 ||
          attempts > 1000 ||
          typeof failed !== 'number' ||
          !Number.isInteger(failed) ||
          failed < 0 ||
          failed > attempts
        )
          throw new GuideError(400, 'Record the actual quality result and attempt counts.');
        args = [
          'benchmark-finish',
          '--benchmark-id',
          id,
          '--variant',
          variant,
          '--quality',
          String(quality),
          '--attempts',
          String(attempts),
          '--failed-attempts',
          String(failed),
        ];
        summary =
          'Record the actual ' +
          String(quality) +
          ' outcome for ' +
          variant +
          ' and restore its saved configuration. This does not run checks or a coding task.';
      } else throw new GuideError(400, 'Choose prepare, finish or report.');
      const idTicket = random();
      ticket = { id: idTicket, expires: now() + 10 * 60_000, args, plan, summary };
      return {
        ticket: idTicket,
        ok: true,
        summary,
        files,
        verificationTier: 'config-only',
        messages: [
          'Only supported already-installed integrations can be prepared. Provider execution and savings require real runtime evidence. The app never resets your source tree, runs check executables or launches a model.',
        ],
      };
    } finally {
      busy = false;
    }
  };
}
