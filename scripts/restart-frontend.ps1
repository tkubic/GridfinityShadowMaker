<#
scripts/restart-frontend.ps1

Kills common frontend dev port (5173) if in use and launches `npm run dev`
from the `frontend/` folder in a new PowerShell window.

Run from repo root:
  .\scripts\restart-frontend.ps1
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "Restarting frontend dev server (Vite, typically port 5173)..."

# Find PID listening on 5173 using Get-NetTCPConnection when available
$foundPid = $null
try {
    $conn = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn -and $conn.OwningProcess) { $foundPid = $conn.OwningProcess }
} catch {
    # ignore and fallback
}

if (-not $foundPid) {
    $line = (netstat -ano | Select-String ":5173") | Select-Object -First 1
    if ($line) {
        $lineText = $line.ToString().Trim()
        if ($lineText -match '(\d+)$') { $foundPid = $Matches[1] } else { Write-Warning "Could not parse PID from netstat output: '$lineText'" }
    }
}

if ($foundPid) {
    Write-Host "Stopping PID $foundPid which is using port 5173"
    try {
        Stop-Process -Id $foundPid -Force -ErrorAction Stop
    } catch {
        Write-Warning ("Stop-Process failed for PID {0}: {1}" -f $foundPid, $_)
        try { taskkill /PID $foundPid /F | Out-Null } catch { Write-Warning ("taskkill failed for PID {0}: {1}" -f $foundPid, $_) }
    }

    # wait up to 5 seconds for the port to free
    $waitUntil = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $waitUntil) {
        $occupied = $false
        try {
            $connCheck = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($connCheck) { $occupied = $true }
        } catch {
            $lineCheck = (netstat -ano | Select-String ":5173") | Select-Object -First 1
            if ($lineCheck) { $occupied = $true }
        }
        if (-not $occupied) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($occupied) { Write-Warning "Port 5173 still appears occupied after attempting to stop PID $foundPid." }
} else {
    Write-Host "No process found using port 5173"
}

if (-not (Test-Path "frontend\package.json")) {
    Write-Error "frontend/package.json not found. Make sure you are in the project root and the frontend exists."
    exit 1
}

# Launch frontend dev server in a new PowerShell window so logs are visible
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$RepoRoot\frontend`"; npm run dev" -WindowStyle Normal
Write-Host "Frontend launched in a new PowerShell window."