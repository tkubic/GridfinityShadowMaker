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

# Detect available Python launcher: prefer 'python', fall back to the 'py' launcher
$PythonLauncher = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $PythonLauncher = 'python'
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    # Use 'py -3' to ensure Python 3 is selected
    $PythonLauncher = 'py'
    
} else {
    Write-Error "Python is not found on PATH. Install Python 3.10+ from python.org and re-run this script."
    exit 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment .venv..."
    if ($PythonLauncher -eq 'py') {
        & py -3 -m venv .venv
    } else {
        & python -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment using $PythonLauncher. Aborting."
        exit 1
    }
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

function Invoke-LoggedCommand {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [string]$LogFile
    )
    $cmd = "$Exe $($Arguments -join ' ')"
    Write-Host "Running: $cmd"
    # Ensure log file exists
    if (-not (Test-Path $LogFile)) { New-Item -Path $LogFile -ItemType File -Force | Out-Null }
    & $Exe @Arguments *>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Command failed (exit code $LASTEXITCODE): $cmd"
        return $false
    }
    return $true
}

# Upgrade pip/setuptools/wheel to prefer binary wheels
$pipLog = Join-Path $RepoRoot "pip-install.log"
Write-Host "Upgrading pip/setuptools/wheel (log: $pipLog)"
if (-not (Invoke-LoggedCommand -Exe $VenvPython -Arguments @('-m','pip','install','--upgrade','pip','setuptools','wheel') -LogFile $pipLog)) {
    Write-Warning "Failed to upgrade pip/setuptools/wheel; continuing but installs may fail. See $pipLog"
}

if (-not (Test-Path "requirements.txt")) {
    Write-Warning "requirements.txt not found at repo root. Skipping pip install."
} else {
    Write-Host "Installing Python packages from requirements.txt (see $pipLog for details)..."
    if (-not (Invoke-LoggedCommand -Exe $VenvPython -Arguments @('-m','pip','install','--prefer-binary','-r','requirements.txt') -LogFile $pipLog)) {
        Write-Warning "Initial pip install failed. Attempting targeted retries for common binary packages."
        # Try targeted install attempts
        $retryPkgs = @('Pillow','opencv_python','numpy')
        if (-not (Invoke-LoggedCommand -Exe $VenvPython -Arguments ( @('-m','pip','install','--prefer-binary') + $retryPkgs ) -LogFile $pipLog)) {
            Write-Warning "Targeted package install also failed. See $pipLog for details."
        }
        # Retry full requirements once more
        if (-not (Invoke-LoggedCommand -Exe $VenvPython -Arguments @('-m','pip','install','--prefer-binary','-r','requirements.txt') -LogFile $pipLog)) {
            Write-Warning "Retry of full requirements failed. See $pipLog for details."
            Write-Host "Common fixes:"
            Write-Host " - Ensure Visual C++ Build Tools / Redistributable are installed for building wheels where needed."
            Write-Host " - Try running pip manually in an elevated shell and inspect $pipLog."
            Write-Host "Manual retry: & $VenvPython -m pip install -r requirements.txt"
        } else {
            Write-Host "Python packages installed successfully on retry."
        }
    } else {
        Write-Host "Python packages installed successfully."
    }
}

if (-not $SkipFrontendInstall) {
    if (Test-Path "frontend\package.json") {
        Write-Host "Installing frontend npm packages (frontend/)..."
        Push-Location frontend
        $frontendLog = Join-Path $RepoRoot "frontend-npm.log"
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Warning "npm not found on PATH; please install Node.js/npm and run 'npm install' in frontend/."
        } else {
            if (Test-Path "package-lock.json") {
                Invoke-LoggedCommand -Exe 'npm' -Arguments @('ci') -LogFile $frontendLog | Out-Null
            } else {
                Invoke-LoggedCommand -Exe 'npm' -Arguments @('install') -LogFile $frontendLog | Out-Null
            }
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
        $backendLog = Join-Path $RepoRoot "backend-npm.log"
        Push-Location backend
        if (Test-Path "package-lock.json") {
            Invoke-LoggedCommand -Exe 'npm' -Arguments @('ci') -LogFile $backendLog | Out-Null
        } else {
            Invoke-LoggedCommand -Exe 'npm' -Arguments @('install') -LogFile $backendLog | Out-Null
        }
        Pop-Location
    }
} else {
    Write-Host "No backend/package.json; skipping backend npm install."
}

Write-Host "Setup complete. You can now launch the dashboard/launcher to start the servers."
Write-Host "To run the graphical launcher (Windows):"
Write-Host "  - Double-click 'Launch GSM Server.py' in File Explorer, or"
Write-Host "  - Run: python \"Launch GSM Server.py\" from the repository root"
Write-Host "If you prefer to run servers manually, activate the venv in your shell and then run the backend/frontend commands as needed."
Write-Host "Activate venv (PowerShell):"
Write-Host "  . .\.venv\Scripts\Activate.ps1"

# Report log files if they exist
$logs = @('pip-install.log','frontend-npm.log','backend-npm.log') | ForEach-Object { Join-Path $RepoRoot $_ }
foreach ($log in $logs) {
    if (Test-Path $log) { Write-Host "Log available: $log" }
}

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