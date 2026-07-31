/**
 * Human rendering dispatch.
 *
 * RFC 0006 §Streams rule 3 — "Diagnostics appear in the JSON envelope, not
 * duplicated on stderr" — plus rule 3 of §JSON envelope — "A field visible in
 * human output but absent from `data` is a defect" — together mean a renderer
 * must be able to say which diagnostics it already put in the report. A plan
 * conflict is the case that forces it: it is report content on stdout *and* a
 * diagnostic in the envelope, and printing it to stderr as well would put the
 * same text on both streams of one invocation.
 */

import type {
  ApplyReport,
  CommandResult,
  Diagnostic,
  DoctorReport,
  MetricsReport,
  PlanReport,
  StatusReport,
  VerifyReport,
} from '@token-harness/core';

import { renderApplyReport } from './apply.js';
import { renderDoctorReport } from './doctor.js';
import { renderMetricsReport } from './metrics.js';
import { renderPlanReport } from './plan.js';
import { renderStatusReport } from './status.js';
import { renderVerifyReport } from './verify.js';
import type { RenderContext } from './layout.js';

export interface HumanRendering {
  /** The report, for stdout. Empty when the command produces none. */
  report: string;
  /** Diagnostics that were not folded into the report. For stderr. */
  stderrDiagnostics: Diagnostic[];
}

function planRendering(
  report: PlanReport,
  result: CommandResult<unknown>,
  context: RenderContext,
): HumanRendering {
  const conflictCodes = new Set(report.conflicts.map((conflict) => conflict.code));
  return {
    report: renderPlanReport(report, context),
    stderrDiagnostics: result.diagnostics.filter((entry) => !conflictCodes.has(entry.code)),
  };
}

export function renderHuman(
  result: CommandResult<unknown>,
  context: RenderContext,
): HumanRendering {
  const data = result.data;
  if (data === null) return { report: '', stderrDiagnostics: result.diagnostics };
  const plain = (report: string): HumanRendering => ({
    report,
    stderrDiagnostics: result.diagnostics,
  });

  switch (result.command) {
    case 'apply':
      return plain(renderApplyReport(data as ApplyReport, context));
    case 'doctor':
      return plain(renderDoctorReport(data as DoctorReport, context));
    case 'plan':
      return planRendering(data as PlanReport, result, context);
    case 'status':
      return plain(renderStatusReport(data as StatusReport, context));
    case 'verify':
      return plain(renderVerifyReport(data as VerifyReport, context));
    case 'metrics':
      return plain(renderMetricsReport(data as MetricsReport, context));
    default:
      return { report: '', stderrDiagnostics: result.diagnostics };
  }
}

export {
  renderApplyReport,
  renderDoctorReport,
  renderMetricsReport,
  renderPlanReport,
  renderStatusReport,
  renderVerifyReport,
};
export * from './layout.js';
