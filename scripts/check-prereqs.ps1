<#
scripts/check-prereqs.ps1

Quick prereqs checker for Windows developers. Detects:
 - Python or py launcher and version
 - repo .venv and packages (ezdxf, cv2, Pillow, pyperclip, numpy)
 - Node and npm
 - OpenSCAD CLI
 - Visual C++ build tools (cl.exe on PATH)

Run from the repository root:
  .\scripts\check-prereqs.ps1
#>

param()

function Write-Status {
    param(
        [string]$Name,
        [bool]$Ok,
        [string]$Msg = ''
    )
    if ($Ok) {
        Write-Host "[OK]    $Name" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $Name - $Msg" -ForegroundColor Yellow
    }
}

# Change directory to repo root (one level above this script)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
try { Push-Location -ErrorAction Stop $scriptDir | Out-Null } catch { }
try { Set-Location (Resolve-Path (Join-Path $scriptDir '..')) } catch { }

$repoRoot = (Get-Location).Path
Write-Host "Checking prerequisites in repository: $repoRoot`n"

## Determine Python interpreter to use. Prefer repo venv when available.
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonCmd = $null
if (Test-Path $venvPython) {
    $pythonCmd = $venvPython
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCmd = (Get-Command python).Source
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    # prefer 'py -3' launcher when explicit path not available
    $pythonCmd = 'py -3'
}

if (-not $pythonCmd) {
    Write-Status 'Python (python/py on PATH)' $false 'Install Python 3.10+ from https://python.org and enable "Add Python to PATH".'
} else {
    try {
        function Invoke-Python {
            param([string[]]$Args)
            if ($pythonCmd -eq 'py -3') { & py -3 @Args } else { & $pythonCmd @Args }
        }
        $verOut = Invoke-Python -Args @('-c', "import sys; v=sys.version_info; print(f'{v[0]}.{v[1]}.{v[2]}')") 2>$null
        $ver = $verOut -join "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | Select-Object -First 1
        if (-not $ver) { throw 'no-version' }
        $parts = $ver.Split('.') | ForEach-Object { [int]$_ }
        $ok = ($parts[0] -gt 3) -or (($parts[0] -eq 3) -and ($parts[1] -ge 10))
        Write-Status "Python (interpreter: $pythonCmd) version $ver" $ok (if ($ok) { '' } else { 'Requires Python 3.10+' })
    } catch {
        Write-Status "Python (interpreter: $pythonCmd)" $false 'Could not run python to check version.'
    }
}

## Which python to use for import checks
$checkerPython = $pythonCmd
if (Test-Path $venvPython) { $checkerPython = $venvPython }

if ($checkerPython) {
    $pkgs = @('ezdxf','cv2','PIL','pyperclip','numpy')
    $installed = @()
    $missing = $pkgs.Clone()
    try {
        $pyCode = @'
import importlib.util
pkgs = ['ezdxf','cv2','PIL','pyperclip','numpy']
ok = []
for p in pkgs:
    try:
        spec = importlib.util.find_spec(p)
        if spec is not None:
            ok.append(p)
    except Exception:
        pass
print(','.join(ok))
'@
        function Invoke-CheckerPython {
            param([string[]]$Args)
            if ($checkerPython -eq 'py -3' -or $pythonCmd -eq 'py -3') { & py -3 @Args } else { & $checkerPython @Args }
        }
        $out = Invoke-CheckerPython -Args @('-c', $pyCode) 2>$null
        $out = ($out -join "`n").Trim()
        if ($out) { $installed = $out -split ',' } else { $installed = @() }
        foreach ($i in $installed) { $missing = $missing | Where-Object { $_ -ne $i } }
        foreach ($i in $installed) { Write-Status "Python package: $i" $true }
        foreach ($m in $missing) { Write-Status "Python package: $m" $false 'Not importable in chosen interpreter' }
    } catch {
        Write-Host "Could not probe Python packages with $checkerPython: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host 'Skipping Python package checks because no Python interpreter found.' -ForegroundColor Yellow
}

## Node & npm
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
Write-Status 'Node.js (node on PATH)' ($node -ne $null) (if ($node) { $node.Source } else { 'Install Node.js (https://nodejs.org/) or nvm-windows' })
Write-Status 'npm (npm on PATH)' ($npm -ne $null) (if ($npm) { $npm.Source } else { 'Install Node.js to get npm, or ensure npm is on PATH' })

## OpenSCAD
$openScadEnv = $env:OPENSCAD_BIN
$openscadCmd = $null
if ($openScadEnv -and (Test-Path $openScadEnv)) { $openscadCmd = $openScadEnv }
else {
    $maybe = @('openscad.com','openscad.exe')
    foreach ($m in $maybe) { if (Get-Command $m -ErrorAction SilentlyContinue) { $openscadCmd = (Get-Command $m).Source; break } }
}
Write-Status 'OpenSCAD CLI' ($openscadCmd -ne $null) (if ($openscadCmd) { $openscadCmd } else { 'Install OpenSCAD and ensure openscad.com is on PATH, or set OPENSCAD_BIN env var' })

## MSVC toolchain
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
Write-Status 'MSVC toolchain (cl.exe on PATH)' ($cl -ne $null) (if ($cl) { $cl.Source } else { 'If pip builds fail, install "Build Tools for Visual Studio" (C++ build tools)' })

$summary = @"
Summary & suggestions:
 - If Python packages are missing in the venv, run:  .\scripts\setup.ps1  and check pip-install.log
 - If OpenSCAD missing, install from https://openscad.org and add openscad.com to PATH
 - If Node/npm missing or failing, install Node.js from https://nodejs.org or use nvm-windows
 - If pip builds fail (compiling extensions), install Visual C++ Build Tools
"@
Write-Host $summary -ForegroundColor Cyan

Pop-Location -ErrorAction SilentlyContinue | Out-Null

exit 0
