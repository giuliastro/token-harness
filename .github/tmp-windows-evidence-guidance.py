from pathlib import Path


def replace_once(path: Path, old: str, new: str):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, got {count}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1))


script = Path('scripts/evaluation/windows-production-stack-evidence.ps1')

replace_once(
    script,
    "function Invoke-EvidenceCollection {\n",
    """function Get-EvidenceProblems {
  param([Parameter(Mandatory = $true)][object[]]$Results)

  $problems = @()
  foreach ($receipt in @($Results | Where-Object { $_.required -and $_.status -ne 'success' })) {
    $reason = if ($receipt.status -eq 'missing') {
      "Required command '$($receipt.executable)' was not found on PATH."
    }
    else {
      "Required command failed with exit code $($receipt.exitCode). See $($receipt.outputFile)."
    }
    $problems += [pscustomobject]@{
      name = $receipt.name
      status = $receipt.status
      exitCode = $receipt.exitCode
      outputFile = $receipt.outputFile
      reason = $reason
    }
  }

  $availableHarnesses = @(
    $Results | Where-Object {
      $_.name -in @('claude-version', 'codex-version') -and $_.status -eq 'success'
    }
  )
  if ($availableHarnesses.Count -eq 0) {
    $problems += [pscustomobject]@{
      name = 'supported-coding-harness'
      status = 'missing'
      exitCode = $null
      outputFile = $null
      reason = 'Neither Claude Code nor Codex could be executed from PATH. At least one is required.'
    }
  }

  return @($problems)
}

function Invoke-EvidenceCollection {
""",
)

replace_once(
    script,
    """  $requiredFailures = @($results | Where-Object { $_.required -and $_.status -ne 'success' })
  $availableHarnesses = @($results | Where-Object { $_.name -in @('claude-version', 'codex-version') -and $_.status -eq 'success' })
  $complete = $requiredFailures.Count -eq 0 -and $availableHarnesses.Count -gt 0
""",
    """  $problems = @(Get-EvidenceProblems -Results $results)
  $complete = $problems.Count -eq 0
""",
)

replace_once(
    script,
    """    complete = $complete
    commands = $results
""",
    """    complete = $complete
    problems = $problems
    commands = $results
""",
)

selftest_anchor = """    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
      $mixedCaseProfile = $env:USERPROFILE.ToUpperInvariant()
      $protectedMixedCase = Protect-LocalPath "$mixedCaseProfile\\repo\\bundle.mjs"
      if ($protectedMixedCase -ne '<USERPROFILE>\\repo\\bundle.mjs') {
        throw 'self-test case-insensitive USERPROFILE sanitization failed'
      }

      $argumentReceipt = Invoke-CapturedCommand -Name 'argument-sanitization' -Executable 'token-harness' -Arguments @("$env:USERPROFILE\\repo\\bundle.mjs") -DestinationDirectory $capture.destination
      if ($argumentReceipt.arguments.Count -ne 1 -or $argumentReceipt.arguments[0] -ne '<USERPROFILE>\\repo\\bundle.mjs') {
        throw 'self-test manifest argument sanitization failed'
      }
    }

    Write-Host 'windows production-stack evidence collector self-test: PASS'
"""
selftest_new = """    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
      $mixedCaseProfile = $env:USERPROFILE.ToUpperInvariant()
      $protectedMixedCase = Protect-LocalPath "$mixedCaseProfile\\repo\\bundle.mjs"
      if ($protectedMixedCase -ne '<USERPROFILE>\\repo\\bundle.mjs') {
        throw 'self-test case-insensitive USERPROFILE sanitization failed'
      }

      $argumentReceipt = Invoke-CapturedCommand -Name 'argument-sanitization' -Executable 'token-harness' -Arguments @("$env:USERPROFILE\\repo\\bundle.mjs") -DestinationDirectory $capture.destination
      if ($argumentReceipt.arguments.Count -ne 1 -or $argumentReceipt.arguments[0] -ne '<USERPROFILE>\\repo\\bundle.mjs') {
        throw 'self-test manifest argument sanitization failed'
      }
    }

    $problemFixture = @($capture.manifest.commands | ForEach-Object { $_ | Select-Object * })
    $rtkFixture = $problemFixture | Where-Object { $_.name -eq 'rtk-version' }
    $rtkFixture.status = 'missing'
    $rtkFixture.exitCode = $null
    $capFixture = $problemFixture | Where-Object { $_.name -eq 'harnesstrim-capabilities' }
    $capFixture.status = 'failed'
    $capFixture.exitCode = 3
    foreach ($harnessName in @('claude-version', 'codex-version')) {
      $harnessFixture = $problemFixture | Where-Object { $_.name -eq $harnessName }
      $harnessFixture.status = 'missing'
      $harnessFixture.exitCode = $null
    }
    $problems = @(Get-EvidenceProblems -Results $problemFixture)
    if ($problems.Count -ne 3) {
      throw "self-test expected 3 actionable problems, got $($problems.Count)"
    }
    if (-not ($problems | Where-Object { $_.name -eq 'rtk-version' -and $_.reason -match 'not found on PATH' })) {
      throw 'self-test missing-command guidance failed'
    }
    if (-not ($problems | Where-Object { $_.name -eq 'harnesstrim-capabilities' -and $_.reason -match 'exit code 3' })) {
      throw 'self-test failed-command guidance failed'
    }
    if (-not ($problems | Where-Object { $_.name -eq 'supported-coding-harness' -and $_.reason -match 'Claude Code nor Codex' })) {
      throw 'self-test coding-harness guidance failed'
    }

    Write-Host 'windows production-stack evidence collector self-test: PASS'
"""
replace_once(script, selftest_anchor, selftest_new)

replace_once(
    script,
    """if (-not $capture.complete) {
  Write-Warning 'Evidence is incomplete. Review manifest.json for missing/failed required commands and ensure at least one supported coding harness is installed.'
  exit 2
}
""",
    """if (-not $capture.complete) {
  Write-Warning 'Evidence is incomplete. Fix the item(s) below and collect this phase again:'
  foreach ($problem in $capture.manifest.problems) {
    Write-Host " - $($problem.name): $($problem.reason)"
  }
  if ($Phase -eq 'before') {
    Write-Host 'Next: fix the listed prerequisite(s), then rerun -Phase before. Do not run -Phase after yet.'
  }
  else {
    Write-Host 'Next: fix the listed prerequisite(s), then rerun -Phase after. Keep the complete before evidence.'
  }
  exit 2
}
""",
)

runbook = Path('docs/evaluation/windows-production-stack-evidence.md')
replace_once(
    runbook,
    """A non-zero exit after the files are written means the evidence is incomplete: inspect
`manifest.json`. RTK, HarnessTrim and the three Token Harness checks are required; at least one of
Claude Code or Codex must be present.
""",
    """A non-zero exit after the files are written means the evidence is incomplete. The collector now
prints each missing/failed prerequisite directly (and stores the same bounded list in
`manifest.json` under `problems`). RTK, HarnessTrim and the three Token Harness checks are required;
at least one of Claude Code or Codex must be present. For an incomplete `before` capture, fix the
listed item(s) and rerun `-Phase before`; do not proceed to `after` yet.
""",
)

status = Path('docs/development-status.md')
text = status.read_text()
marker = '# Development status\n\n'
if text.count(marker) != 1:
    raise SystemExit('development-status heading not unique')
note = (
    '- 2026-09-16: Windows #255 evidence collection now reports bounded actionable problems directly '
    'when a capture is incomplete (missing required command, failed required command, or no Claude/Codex '
    'harness), persists the same list in `manifest.json`, and tells users to repeat the current phase '
    'instead of advancing. The collector remains read-only and does not weaken evidence admission.\n'
)
status.write_text(text.replace(marker, marker + note, 1))
