param(
  [string]$OpenScadPath
)

<#
  start-server.ps1

  Usage:
    .\start-server.ps1                    # run server, uses existing OPENSCAD_BIN if set
    .\start-server.ps1 -OpenScadPath "C:\Program Files\OpenSCAD\openscad.exe"

  This script sets the `OPENSCAD_BIN` environment variable for the session
  and then starts the Node server. It is intended for Windows/PowerShell users.
#>

if ($OpenScadPath) {
  if (-not (Test-Path $OpenScadPath)) {
    Write-Error "Specified OpenSCAD path not found: $OpenScadPath"
    exit 2
  }
  $env:OPENSCAD_BIN = $OpenScadPath
  Write-Host "Using OPENSCAD_BIN=$env:OPENSCAD_BIN"
} else {
  if ($env:OPENSCAD_BIN) {
    Write-Host "OPENSCAD_BIN already set: $env:OPENSCAD_BIN"
  } else {
    Write-Host "OPENSCAD_BIN not set. You can pass -OpenScadPath to set it for this run."
  }
}

Push-Location -LiteralPath $PSScriptRoot
try {
  Write-Host "Starting backend server..."
  node server.js
} finally {
  Pop-Location
}
