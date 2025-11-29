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
    [switch]$SkipFrontendInstall,
    [switch]$NoPause
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

# Install Python dependencies using the venv python executable so activation
# is not required in this script. This avoids depending on the Activate.ps1
# script being present in interactive shells.
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Warning "Virtualenv python not found at $VenvPython. Falling back to system 'python'."
    $VenvPython = 'python'
}

Write-Host "Installing Python dependencies using: $VenvPython"

# Ensure build/install tooling is up-to-date so binary wheels are preferred when available
& $VenvPython -m pip install --upgrade pip setuptools wheel

$pipLog = Join-Path $RepoRoot "pip-install.log"
if (-not (Test-Path "requirements.txt")) {
    Write-Warning "requirements.txt not found at repo root. Skipping pip install."
} else {
    Write-Host "Installing Python packages from requirements.txt (see $pipLog for details)..."
    $installSucceeded = $true
    try {
        & $VenvPython -m pip install --prefer-binary -r requirements.txt *>&1 | Tee-Object -FilePath $pipLog
    } catch {
        $installSucceeded = $false
    }

    if (-not $installSucceeded) {
        Write-Warning "Initial pip install failed. I'll attempt a best-effort retry for common binary packages (Pillow/opencv)."
        try {
            # Try installing commonly problematic packages with binary wheels explicitly
            & $VenvPython -m pip install --prefer-binary Pillow opencv_python numpy *>&1 | Tee-Object -FilePath $pipLog -Append
            # Retry full requirements using prefer-binary
            & $VenvPython -m pip install --prefer-binary -r requirements.txt *>&1 | Tee-Object -FilePath $pipLog -Append
            $installSucceeded = $true
        } catch {
            $installSucceeded = $false
        }
    }

    if (-not $installSucceeded) {
        Write-Warning "Python dependency installation encountered errors. See $pipLog for details."
        Write-Host "Common fixes:"
        Write-Host " - Make sure you have a recent pip/setuptools/wheel (we attempted to upgrade them)."
        Write-Host " - Install Microsoft Build Tools / Visual C++ Redistributable if pip needs to compile wheels."
        Write-Host " - Try installing Pillow/opencv_python via binaries, or install from the official Python installer (use same Python version as the venv)."
        Write-Host "You can retry manually: `& $VenvPython -m pip install -r requirements.txt`"
    } else {
        Write-Host "Python packages installed successfully."
    }
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

# Install backend npm packages if present. This makes the setup idempotent
# and ensures required server-side modules (e.g. express) are available.
if (Test-Path "backend\package.json") {
    Write-Host "Installing backend npm packages (backend/)..."
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Warning "npm not found on PATH; backend dependencies were not installed. Please install Node.js/npm and run 'npm install' in backend/."
    } else {
        Push-Location backend
        # npm install is idempotent; safe to run multiple times
        npm install
        Pop-Location
    }
} else {
    Write-Host "No backend/package.json; skipping backend npm install."
}

Write-Host "Setup complete. You can now launch the dashboard/launcher to start the servers."
Write-Host "To run the graphical launcher (Windows):"
Write-Host "  - Double-click 'Launch GSM Server.py' in File Explorer, or"
Write-Host "  - Run: python .\"Launch GSM Server.py\""
Write-Host "If you prefer to run servers manually, activate the venv in your shell:\n  . .\.venv\Scripts\Activate.ps1"

# By default, pause at the end so users running the script by double-click
# or in a new terminal can read the output. Set -NoPause to skip this behavior
# (useful for CI or scripted runs).
if (-not $NoPause) {
    Write-Host ""
    Write-Host "Press Enter to close this window or Ctrl+C to cancel..."
    try {
        Read-Host | Out-Null
    } catch {
        # In non-interactive hosts Read-Host may fail; ignore and continue.
    }
}