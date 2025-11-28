<#
scripts/restart-dev.ps1

Runs the backend and frontend restart scripts from the repo root to bring up
the full development stack. This simply invokes the two restart scripts, each
of which opens a new PowerShell window.

Run:
  .\scripts\restart-dev.ps1
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir

Set-Location $RepoRoot

Write-Host "Restarting backend and frontend dev servers..."

# Run restart-backend and restart-frontend; both scripts are GUI-friendly and will auto-detect OpenSCAD
& "${RepoRoot}\scripts\restart-backend.ps1"
Start-Sleep -Seconds 1
& "${RepoRoot}\scripts\restart-frontend.ps1"

Write-Host "Done. Check the new PowerShell windows for logs."