<#
scripts/setup.ps1

Usage: run from repository root in PowerShell (preferably as Administrator if
you need to modify system PATHs).

This script:
- creates a `.venv` Python virtual environment if missing
- activates the venv for the duration of the script
- upgrades pip and installs `requirements.txt`
- runs `npm install` in `frontend/` if a `package.json` exists

Run:
  .\scripts\setup.ps1
#>

Param(
    [switch]$SkipFrontendInstall
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "Setting up Python venv in: $RepoRoot"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python is not found on PATH. Install Python 3.10+ and re-run this script."
    exit 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment .venv..."
    python -m venv .venv
} else {
    Write-Host "Virtual environment already exists: .venv"
}

Write-Host "Activating .venv and installing Python dependencies..."
& ".\.venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip

if (-not (Test-Path "requirements.txt")) {
    Write-Warning "requirements.txt not found at repo root. Skipping pip install."
} else {
    pip install -r requirements.txt
}

if (-not $SkipFrontendInstall) {
    if (Test-Path "frontend\package.json") {
        Write-Host "Installing frontend npm packages (frontend/)..."
        Push-Location frontend
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Warning "npm not found on PATH; please install Node.js/npm and run 'npm install' in frontend/."
        } else {
            npm install
        }
        Pop-Location
    } else {
        Write-Host "No frontend/package.json; skipping frontend npm install."
    }
}

Write-Host "Setup complete. To activate the venv in your interactive shell run:`n. .\\.venv\\Scripts\\Activate.ps1`"