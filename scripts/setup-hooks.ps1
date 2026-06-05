#Requires -Version 5.1
<#
.SYNOPSIS
  setup-hooks.ps1 -- point git at the repo-managed hooks in .githooks/.

.DESCRIPTION
  Run once per clone. Idempotent: re-running just re-asserts the config.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
  Write-Error "setup-hooks: not inside a git work tree"
  exit 1
}
Set-Location -LiteralPath $root

& git config core.hooksPath .githooks

$active = (& git config --get core.hooksPath)
Write-Host "core.hooksPath set to: $active"
Write-Host "pre-commit hook active -> scripts/gauntlet.sh"
Write-Host ""
Write-Host "REMINDER: project policy FORBIDS 'git commit --no-verify' / '-n'."
Write-Host "          Fix the issue or lower a floor via an ADR in docs/decisions/."
