<#
scripts/restart-backend.ps1

Kills any process using port 5000 and launches `node server.js` from
the `backend/` folder in a new PowerShell window.

Run from repo root:
  .\scripts\restart-backend.ps1
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

# GUI-friendly OpenSCAD detection: prefer explicit env var, otherwise check common install locations
$OpenScadPath = $null
if ($env:OPENSCAD_BIN) { $OpenScadPath = $env:OPENSCAD_BIN }
else {
  $candidates = @(
    "$Env:ProgramFiles\OpenSCAD\openscad.exe",
    "$Env:ProgramFiles(x86)\OpenSCAD\openscad.exe",
    "$Env:ProgramFiles\OpenSCAD\openscad.exe"
  )
  foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { $OpenScadPath = $p; break } }
}

Write-Host "Restarting backend (port 5000)..."

Write-Host "Checking for process listening on port 5000..."
# Try Get-NetTCPConnection first (works on modern Windows PowerShell)
$foundPid = $null
try {
  $conn = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn -and $conn.OwningProcess) {
    $foundPid = $conn.OwningProcess
  }
} catch {
  # ignore, we'll fallback to netstat parsing
}

if (-not $foundPid) {
  $line = (netstat -ano | Select-String ":5000") | Select-Object -First 1
  if ($line) {
    $lineText = $line.ToString().Trim()
    # attempt to extract trailing digits (the PID)
    if ($lineText -match '(\d+)$') {
      $maybe = $Matches[1]
      try { $num = [int]$maybe } catch { $num = 0 }
      if ($num -gt 0) { $foundPid = $num } else { Write-Warning "Parsed PID is invalid (0): '$maybe'" }
    } else {
      Write-Warning "Could not parse PID from netstat output: '$lineText'"
    }
  }
}

if ($foundPid) {
  Write-Host "Stopping PID $foundPid which is using port 5000"
  try {
    # Prefer Stop-Process which accepts an integer Id
    Stop-Process -Id $foundPid -Force -ErrorAction Stop
  } catch {
    Write-Warning ("Stop-Process failed for PID {0}: {1}" -f $foundPid, $_)
    try {
      taskkill /PID $foundPid /F | Out-Null
    } catch {
      Write-Warning ("taskkill failed for PID {0}: {1}" -f $foundPid, $_)
    }
  }

  # wait up to 5 seconds for the port to free
  $waitUntil = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $waitUntil) {
    $occupied = $false
    try {
      $connCheck = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($connCheck) { $occupied = $true }
    } catch {
      $lineCheck = (netstat -ano | Select-String ":5000") | Select-Object -First 1
      if ($lineCheck) { $occupied = $true }
    }
    if (-not $occupied) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($occupied) { Write-Warning "Port 5000 still appears occupied after attempting to stop PID $foundPid." }
} else {
  Write-Host "No process found using port 5000"
}

# Launch backend in a new PowerShell window so it stays running
if ($OpenScadPath) {
  # Pass the environment variable into the new PowerShell session and start the server.
  # Use a scriptblock string with single-quoted paths to ensure spaces are preserved.
  $bv = $RepoRoot -replace "'", "''"
  $ob = $OpenScadPath -replace "'", "''"
  $cmd = "& { Set-Location -LiteralPath '$bv\backend'; `$env:OPENSCAD_BIN = '$ob'; node server.js }"
  Start-Process powershell -ArgumentList '-NoExit','-Command',$cmd -WindowStyle Normal
  Write-Host "Backend launched in a new PowerShell window using OPENSCAD_BIN=$OpenScadPath"
} else {
  $bv = $RepoRoot -replace "'", "''"
  $cmd = "& { Set-Location -LiteralPath '$bv\backend'; node server.js }"
  Start-Process powershell -ArgumentList '-NoExit','-Command',$cmd -WindowStyle Normal
  Write-Host "Backend launched in a new PowerShell window (OPENSCAD_BIN not detected)."
}