#Requires -Version 5.1
<#
.SYNOPSIS
  gauntlet.ps1 -- deterministic anti-rot enforcement substrate (PowerShell).

.DESCRIPTION
  PowerShell-native twin of scripts/gauntlet.sh. Runs the full pre-commit / CI
  quality gauntlet for the Chat-to-Markdown Manifest V3 extension. This script
  is SCAFFOLDING: there is no product code yet (no package.json, no src/).
  Every step is gated on the existence of its tooling + npm script, so each
  step gracefully SKIPs when not yet scaffolded and the overall gauntlet exits
  0. As real code and npm scripts land, the matching steps light up
  automatically with zero edits to this file.

  Step order (each gated on existence):
    (a) lint
    (b) typecheck
    (c) unit tests
    (d) integration / DOM tests
    (e) golden-snapshot check
    (f) web-ext / manifest lint
    (g) secret / PII scan
    (h) duplication & dead-selector scan

  Exit semantics:
    - A step that EXECUTES and fails -> recorded FAIL, gauntlet exits 1.
    - A step whose tooling/script is absent -> SKIP (never fails the gauntlet).
    - If nothing executed (pure scaffolding state) -> exit 0.

  Idempotent and side-effect-free except for writing its own output. Paths with
  spaces (Windows + OneDrive) are quoted throughout.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Locate repo root as the parent of this script's directory ---------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location -LiteralPath $RepoRoot

$PkgJson = Join-Path $RepoRoot 'package.json'

# --- Result tracking ---------------------------------------------------------
$Summary   = New-Object System.Collections.Generic.List[object]
$FailCount = 0
$ExecCount = 0

function Record {
  param([string]$Status, [string]$Label)
  $Summary.Add([pscustomobject]@{ Status = $Status; Label = $Label })
}

# Test-NpmScript <name>: $true if package.json exists AND defines the npm script.
# Parses package.json as JSON (PowerShell ships ConvertFrom-Json). Falls back to
# $false on any parse error -- scaffolding-grade tolerance; `npm run` is the
# authoritative validator if the script name is malformed.
function Test-NpmScript {
  param([string]$Name)
  if (-not (Test-Path -LiteralPath $PkgJson)) { return $false }
  try {
    $pkg = Get-Content -LiteralPath $PkgJson -Raw | ConvertFrom-Json
  } catch {
    return $false
  }
  if ($null -eq $pkg.scripts) { return $false }
  # PSCustomObject from JSON: check for a property matching the script name.
  $names = $pkg.scripts.PSObject.Properties.Name
  return ($names -contains $Name)
}

# Invoke-NpmStep <label> <script>: run `npm run <script>` if defined; record
# PASS/FAIL on exit code; otherwise record SKIP.
function Invoke-NpmStep {
  param([string]$Label, [string]$Script)
  if (Test-NpmScript -Name $Script) {
    Write-Host ">>> RUN  $Label  (npm run $Script)"
    $script:ExecCount++
    # Invoke npm without letting a non-zero exit throw (we inspect $LASTEXITCODE).
    & npm run $Script --silent
    $code = $LASTEXITCODE
    if ($code -eq 0) {
      Write-Host "<<< PASS $Label"
      Record -Status 'PASS' -Label $Label
    } else {
      Write-Host "<<< FAIL $Label (exit $code)"
      Record -Status 'FAIL' -Label $Label
      $script:FailCount++
    }
  } else {
    Write-Host "--- SKIP $Label (not scaffolded yet)"
    Record -Status 'SKIP' -Label $Label
  }
}

# Skip-WithTodo <label> <future>: SKIP a step with a clearly-marked TODO naming
# the future standalone implementation.
function Skip-WithTodo {
  param([string]$Label, [string]$Future)
  Write-Host "--- SKIP $Label (not scaffolded yet) -- TODO: implement $Future"
  Record -Status 'SKIP' -Label "$Label (TODO: $Future)"
}

Write-Host "============================================================"
Write-Host " Chat-to-Markdown gauntlet"
Write-Host " repo root: $RepoRoot"
if (Test-Path -LiteralPath $PkgJson) {
  Write-Host " package.json: present"
} else {
  Write-Host " package.json: ABSENT (pure scaffolding state)"
}
Write-Host "============================================================"

# --- (a) lint ----------------------------------------------------------------
Invoke-NpmStep -Label '(a) lint' -Script 'lint'

# --- (b) typecheck -----------------------------------------------------------
Invoke-NpmStep -Label '(b) typecheck' -Script 'typecheck'

# --- (c) unit tests ----------------------------------------------------------
Invoke-NpmStep -Label '(c) unit tests' -Script 'test:unit'

# --- (d) integration / DOM tests ---------------------------------------------
Invoke-NpmStep -Label '(d) integration/DOM tests' -Script 'test:integration'

# --- (e) golden-snapshot check -----------------------------------------------
Invoke-NpmStep -Label '(e) golden-snapshot check' -Script 'test:golden'

# --- (f) web-ext / manifest lint ---------------------------------------------
Invoke-NpmStep -Label '(f) web-ext/manifest lint' -Script 'lint:ext'

# --- (g) secret / PII scan ---------------------------------------------------
if (Test-NpmScript -Name 'scan:secrets') {
  Invoke-NpmStep -Label '(g) secret/PII scan' -Script 'scan:secrets'
} else {
  Skip-WithTodo -Label '(g) secret/PII scan' -Future 'scripts/scan-secrets.mjs'
}

# --- (h) duplication & dead-selector scan ------------------------------------
if (Test-NpmScript -Name 'scan:dupes') {
  Invoke-NpmStep -Label '(h) duplication & dead-selector scan' -Script 'scan:dupes'
} else {
  Skip-WithTodo -Label '(h) duplication & dead-selector scan' -Future 'scripts/scan-dupes.mjs'
}

# --- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host "============================================================"
Write-Host " GAUNTLET SUMMARY"
Write-Host "------------------------------------------------------------"
foreach ($row in $Summary) {
  Write-Host ("  {0,-4} {1}" -f $row.Status, $row.Label)
}
Write-Host "------------------------------------------------------------"
Write-Host " executed steps: $ExecCount   failures: $FailCount"
Write-Host "============================================================"

if ($FailCount -gt 0) {
  Write-Host "GAUNTLET: FAIL ($FailCount executed step(s) failed)"
  exit 1
}

if ($ExecCount -eq 0) {
  Write-Host "GAUNTLET: PASS (nothing scaffolded yet -- all steps skipped)"
} else {
  Write-Host "GAUNTLET: PASS (all $ExecCount executed step(s) passed)"
}
exit 0
