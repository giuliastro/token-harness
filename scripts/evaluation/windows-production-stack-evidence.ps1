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
      $protected = $protected.Replace($candidate, '<USERPROFILE>')
    }
  }
  return $protected
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

  if ($null -eq $command) {
    "Command not found: $Executable" | Set-Content -Encoding utf8 $outputPath
    return [pscustomobject]@{
      name = $Name
      executable = $Executable
      executablePath = $null
      arguments = $Arguments
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
    executable = $Executable
    executablePath = Protect-LocalPath $command.Source
    arguments = $Arguments
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
    [bool]$UseFakePathTokenHarness = $false
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
    $tokenHarnessExecutable = 'token-harness'
    $tokenHarnessPrefix = @()
    $tokenHarnessSource = 'path'
  }

  $results = @()
  $results += Invoke-CapturedCommand -Name 'rtk-version' -Executable 'rtk' -Arguments @('--version') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'harnesstrim-version' -Executable 'harnesstrim' -Arguments @('--version') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'harnesstrim-capabilities' -Executable 'harnesstrim' -Arguments @('capabilities') -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'claude-version' -Executable 'claude' -Arguments @('--version') -DestinationDirectory $destination -Required $false
  $results += Invoke-CapturedCommand -Name 'codex-version' -Executable 'codex' -Arguments @('--version') -DestinationDirectory $destination -Required $false
  $results += Invoke-CapturedCommand -Name 'token-harness-doctor' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('doctor', '--verbose')) -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'token-harness-verify' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('verify', '--verbose')) -DestinationDirectory $destination
  $results += Invoke-CapturedCommand -Name 'token-harness-stack-review' -Executable $tokenHarnessExecutable -Arguments @($tokenHarnessPrefix + @('stack-review', '--json')) -DestinationDirectory $destination

  $requiredFailures = @($results | Where-Object { $_.required -and $_.status -ne 'success' })
  $availableHarnesses = @($results | Where-Object { $_.name -in @('claude-version', 'codex-version') -and $_.status -eq 'success' })
  $complete = $requiredFailures.Count -eq 0 -and $availableHarnesses.Count -gt 0

  $manifest = [ordered]@{
    schemaVersion = 1
    phase = $CollectionPhase
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    nativeWindows = $true
    tokenHarnessSource = $tokenHarnessSource
    complete = $complete
    commands = $results
    interpretationBoundary = 'This collector is read-only evidence capture. It does not install or update providers, exercise RTK/HarnessTrim, create receipts, or admit a compatibility row. Run before and after real qualifying operations and review the resulting evidence separately.'
  }

  $manifestPath = Join-Path $destination 'manifest.json'
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $manifestPath

  [pscustomobject]@{
    destination = $destination
    complete = $complete
    manifest = $manifest
  }
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
    $env:PATH = "$bin;$originalPath"

    $capture = Invoke-EvidenceCollection -CollectionPhase 'before' -CollectionRoot $evidence -UseFakePathTokenHarness $true
    if (-not $capture.complete) {
      throw 'self-test capture should be complete'
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
Write-Host "Evidence written to: $($capture.destination)"
if (-not $capture.complete) {
  Write-Warning 'Evidence is incomplete. Review manifest.json for missing/failed required commands and ensure at least one supported coding harness is installed.'
  exit 2
}
