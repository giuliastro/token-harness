param(
  [ValidateSet('before', 'after')]
  [string]$Phase = 'before',

  [string]$OutputRoot = 'artifacts/windows-production-stack-evidence',

  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'windows-production-stack-evidence.ps1 must run on native Windows.'
}

function Protect-LocalPath {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return $null
  }

  $protected = $Value
  foreach ($candidate in @($env:USERPROFILE, [Environment]::GetFolderPath('UserProfile'))) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $protected = [regex]::Replace(
        $protected,
        [regex]::Escape($candidate),
        '<USERPROFILE>',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )
    }
  }
  return $protected
}

function Resolve-EvidenceExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$LogicalName,
    [Parameter(Mandatory = $true)][string]$DefaultExecutable,
    [hashtable]$ExecutableOverrides = @{}
  )

  if ($null -ne $ExecutableOverrides -and $ExecutableOverrides.ContainsKey($LogicalName)) {
    return [string]$ExecutableOverrides[$LogicalName]
  }
  return $DefaultExecutable
}

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$DestinationDirectory,
    [bool]$Required = $true
  )

  $outputFile = "$Name.txt"
  $outputPath = Join-Path $DestinationDirectory $outputFile
  $command = Get-Command $Executable -ErrorAction SilentlyContinue
  $sanitizedArguments = @($Arguments | ForEach-Object { Protect-LocalPath ([string]$_) })

  if ($null -eq $command) {
    "Command not found: $Executable" | Set-Content -Encoding utf8 $outputPath
    return [pscustomobject]@{
      name = $Name
      executable = Protect-LocalPath $Executable
      executablePath = $null
      arguments = $sanitizedArguments
      required = $Required
      status = 'missing'
      exitCode = $null
      outputFile = $outputFile
    }
  }

  $lines = @()
  $exitCode = 0
  try {
    $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    if ($null -ne $LASTEXITCODE) {
      $exitCode = [int]$LASTEXITCODE
    }
  }
  catch {
    $lines = @($_.Exception.Message)
    $exitCode = 1
  }

  $text = ($lines -join [Environment]::NewLine)
  $text = Protect-LocalPath $text
  $text | Set-Content -Encoding utf8 $outputPath

  return [pscustomobject]@{
    name = $Name
    executable = Protect-LocalPath $Executable
    executablePath = Protect-LocalPath $command.Source
    arguments = $sanitizedArguments
    required = $Required
    status = if ($exitCode -eq 0) { 'success' } else { 'failed' }
    exitCode = $exitCode
    outputFile = $outputFile
  }
}

function Invoke-EvidenceCollection {
  param(
    [Parameter(Mandatory = $true)][string]$CollectionPhase,
    [Parameter(Mandatory = $true)][string]$CollectionRoot,
    [bool]$UseFakePathTokenHarness = $false,
    [hashtable]$ExecutableOverrides = @{}
  )

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $destination = Join-Path $CollectionRoot "$timestamp-$CollectionPhase"
  New-Item -ItemType Directory -Path $destination -Force | Out-Null

  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $localBundle = Join-Path $repoRoot 'dist\bundle\token-harness.mjs'
  if (-not $UseFakePathTokenHarness -and (Test-Path $localBundle)) {
    $tokenHarnessExecutable = 'node'
    $tokenHarnessPrefix = @($localBundle)
    $tokenHarnessSource = 'local-bundle'
  }
  else {
    $tokenHarnessExecutable = Resolve-EvidenceExecutable -LogicalName 'token-harness' -DefaultExecutable 'token-harness' -ExecutableOverrides $ExecutableOverrides
    $tokenHarnessPrefix = @()
    $tokenHarnessSource = 'path'
  }

  $rtkExecutable = Resolve-EvidenceExecutable -LogicalName 'rtk' -DefaultExecutable 'rtk' -ExecutableOverrides $ExecutableOverrides
  $harnessTrimExecutable = Resolve-EvidenceExecutable -LogicalName 'harnesstrim' -DefaultExecutable 'harnesstrim' -ExecutableOverrides $ExecutableOverrides
  $claudeExecutable = Resolve-EvidenceExecutable -LogicalName 'claude' -DefaultExecutable 'claude' -ExecutableOverrides $ExecutableOverrides
  $codexExecutable = Resolve-EvidenceExecutable -LogicalName 'codex' -DefaultExecutable 'codex' -ExecutableOverrides $ExecutableOverrides

  $results = @()
  $results += Invoke-CapturedCommand -Name 'rtk-version' -Executable $rtkExecutable -Arguments @('--version') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'harnesstrim-version' -Executable $harnessTrimExecutable -Arguments @('--version') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'harnesstrim-capabilities' -Executable $harnessTrimExecutable -Arguments @('capabilities') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'claude-version' -Executable $claudeExecutable -Arguments @('--version') -DestinationDirectory $destination -Required $false
  $results += Invoke-CapturedCommand -Name 'codex-version' -Executable $codexExecutable -Arguments @('--version') -DestinationDirectory $destination -Required $false
  $results += Invoke-CapturedCommand -Name 'token-harness-doctor' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('doctor', '--verbose')) -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'token-harness-verify' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('verify', '--verbose')) -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'token-harness-stack-review' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('stack-review', '--json')) -DestinationDirectory $destination

  $requiredFailures = @($results | Where-Object { $_.required -and $_.status -ne 'success' })
  $availableHarnesses = @($results | Where-Object { $_.name -in @('claude-version', 'codex-version') -and $_.status -eq 'success' })
  $blockingFailures = @($requiredFailures | ForEach-Object {
      [ordered]@{
        name = $_.name
        status = $_.status
        exitCode = $_.exitCode
      }
    })
  $availableHarnessNames = @($availableHarnesses | ForEach-Object { $_.name -replace '-version$', '' })
  $complete = $blockingFailures.Count -eq 0 -and $availableHarnessNames.Count -gt 0

  $manifest = [ordered]@{
    schemaVersion = 2
    phase = $CollectionPhase
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    nativeWindows = $true
    tokenHarnessSource = $tokenHarnessSource
    complete = $complete
    blockingFailures = $blockingFailures
    availableHarnesses = $availableHarnessNames
    commands = $results
    interpretationBoundary = 'This collector is read-only evidence capture. It does not install or update providers, exercise RTK/HarnessTrim, create receipts, or admit a compatibility row. Run before and after real qualifying operations and review the resulting evidence separately.'
  }

  $manifestPath = Join-Path $destination 'manifest.json'
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $manifestPath
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Evidence manifest was not created at: $manifestPath"
  }
  $resolvedManifestPath = (Resolve-Path -LiteralPath $manifestPath).Path
  $resolvedDestination = (Resolve-Path -LiteralPath $destination).Path

  [pscustomobject]@{
    destination = $resolvedDestination
    manifestPath = $resolvedManifestPath
    complete = $complete
    manifest = $manifest
  }
}

function Write-CollectionSummary {
  param([Parameter(Mandatory = $true)]$Capture)

  Write-Host "Evidence directory: $($Capture.destination)"
  Write-Host "Manifest: $($Capture.manifestPath)"

  if ($Capture.complete) {
    Write-Host 'Evidence capture: COMPLETE'
    return
  }

  Write-Warning 'Evidence capture: INCOMPLETE'
  $blockingFailures = @($Capture.manifest.blockingFailures)
  if ($blockingFailures.Count -gt 0) {
    Write-Host 'Blocking required commands:'
    foreach ($failure in $blockingFailures) {
      $exitSuffix = if ($null -eq $failure.exitCode) { '' } else { " (exit $($failure.exitCode))" }
      Write-Host "  - $($failure.name): $($failure.status)$exitSuffix"
    }
  }

  $availableHarnesses = @($Capture.manifest.availableHarnesses)
  if ($availableHarnesses.Count -eq 0) {
    Write-Host '  - coding-harness: missing (Claude Code or Codex is required)'
  }
  else {
    Write-Host "Detected coding harnesses: $($availableHarnesses -join ', ')"
  }

  Write-Host 'No extra diagnostic command is required; the manifest already contains the full command results.'
}

function Invoke-SelfTest {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("token-harness-windows-evidence-" + [guid]::NewGuid().ToString('N'))
  $bin = Join-Path $tempRoot 'bin'
  $evidence = Join-Path $tempRoot 'evidence'
  New-Item -ItemType Directory -Path $bin -Force | Out-Null

  $originalPath = $env:PATH
  try {
    foreach ($tool in @('rtk', 'harnesstrim', 'claude', 'codex', 'token-harness')) {
      $body = @"
@echo off
echo $tool %* %USERPROFILE%
exit /b 0
"@
      Set-Content -Encoding ascii -Path (Join-Path $bin "$tool.cmd") -Value $body
    }
    $failingRtk = Join-Path $bin 'rtk-fail.cmd'
    @"
@echo off
echo intentional RTK failure
exit /b 7
"@ | Set-Content -Encoding ascii -Path $failingRtk

    $env:PATH = "$bin;$originalPath"

    $capture = Invoke-EvidenceCollection -CollectionPhase 'before' -CollectionRoot $evidence -UseFakePathTokenHarness $true
    if (-not $capture.complete) {
      throw 'self-test complete capture should be complete'
    }
    if (-not (Test-Path -LiteralPath $capture.manifestPath)) {
      throw 'self-test complete capture manifest should exist'
    }
    if ($capture.manifest.commands.Count -ne 8) {
      throw "self-test expected 8 command receipts, got $($capture.manifest.commands.Count)"
    }
    foreach ($receipt in $capture.manifest.commands) {
      if ($receipt.status -ne 'success') {
        throw "self-test command failed: $($receipt.name)"
      }
      $text = Get-Content -Raw (Join-Path $capture.destination $receipt.outputFile)
      if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE) -and $text.Contains($env:USERPROFILE)) {
        throw "self-test leaked USERPROFILE in $($receipt.outputFile)"
      }
      if (-not $text.Contains('<USERPROFILE>')) {
        throw "self-test did not sanitize USERPROFILE in $($receipt.outputFile)"
      }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
      $mixedCaseProfile = $env:USERPROFILE.ToUpperInvariant()
      $protectedMixedCase = Protect-LocalPath "$mixedCaseProfile\repo\bundle.mjs"
      if ($protectedMixedCase -ne '<USERPROFILE>\repo\bundle.mjs') {
        throw 'self-test case-insensitive USERPROFILE sanitization failed'
      }

      $argumentReceipt = Invoke-CapturedCommand -Name 'argument-sanitization' -Executable 'token-harness' -Arguments @("$env:USERPROFILE\repo\bundle.mjs") -DestinationDirectory $capture.destination
      if ($argumentReceipt.arguments.Count -ne 1 -or $argumentReceipt.arguments[0] -ne '<USERPROFILE>\repo\bundle.mjs') {
        throw 'self-test manifest argument sanitization failed'
      }
    }

    $missingExecutable = "token-harness-selftest-missing-$([guid]::NewGuid().ToString('N'))"
    $missingCapture = Invoke-EvidenceCollection -CollectionPhase 'before' -CollectionRoot $evidence -UseFakePathTokenHarness $true -ExecutableOverrides @{ harnesstrim = $missingExecutable }
    if ($missingCapture.complete) {
      throw 'self-test missing-required capture should be incomplete'
    }
    if (-not (Test-Path -LiteralPath $missingCapture.manifestPath)) {
      throw 'self-test missing-required capture must still write manifest.json'
    }
    $missingManifest = Get-Content -LiteralPath $missingCapture.manifestPath -Raw | ConvertFrom-Json
    if ($missingManifest.schemaVersion -ne 2 -or $missingManifest.complete) {
      throw 'self-test missing-required manifest state is invalid'
    }
    $missingNames = @($missingManifest.blockingFailures | ForEach-Object { $_.name })
    if ($missingNames.Count -ne 2 -or 'harnesstrim-version' -notin $missingNames -or 'harnesstrim-capabilities' -notin $missingNames) {
      throw 'self-test missing-required blockers were not recorded correctly'
    }

    $failedCapture = Invoke-EvidenceCollection -CollectionPhase 'after' -CollectionRoot $evidence -UseFakePathTokenHarness $true -ExecutableOverrides @{ rtk = $failingRtk }
    if ($failedCapture.complete) {
      throw 'self-test failed-required capture should be incomplete'
    }
    if (-not (Test-Path -LiteralPath $failedCapture.manifestPath)) {
      throw 'self-test failed-required capture must still write manifest.json'
    }
    $failedManifest = Get-Content -LiteralPath $failedCapture.manifestPath -Raw | ConvertFrom-Json
    $rtkFailure = @($failedManifest.blockingFailures | Where-Object { $_.name -eq 'rtk-version' })
    if ($rtkFailure.Count -ne 1 -or $rtkFailure[0].status -ne 'failed' -or $rtkFailure[0].exitCode -ne 7) {
      throw 'self-test failed-required blocker was not recorded with exit code 7'
    }

    Write-Host 'windows production-stack evidence collector self-test: PASS'
  }
  finally {
    $env:PATH = $originalPath
    Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
  }
}

if ($SelfTest) {
  Invoke-SelfTest
  exit 0
}

$capture = Invoke-EvidenceCollection -CollectionPhase $Phase -CollectionRoot $OutputRoot
Write-CollectionSummary -Capture $capture
if (-not $capture.complete) {
  exit 2
}
