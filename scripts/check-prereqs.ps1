<#
scripts/check-prereqs.ps1

Quick prereqs checker for Windows developers. Detects:
 - Python or py launcher and version
 - repo .venv and packages (ezdxf, cv2, Pillow, pyperclip)
 - Node and npm
 - OpenSCAD CLI
 - Visual C++ build tools (cl.exe on PATH)

Run from the repository root:
  .\scripts\check-prereqs.ps1
#>

param()

function Write-Status($name, $ok, $msg = '') {
    if ($ok) { Write-Host "[OK]    $name" -ForegroundColor Green }
    else { Write-Host "[MISSING] $name - $msg" -ForegroundColor Yellow }
}

Push-Location -ErrorAction SilentlyContinue (Split-Path -Parent $MyInvocation.MyCommand.Definition) | Out-Null
Set-Location (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) '..')

$repoRoot = Get-Location
Write-Host "Checking prerequisites in repository: $repoRoot`n"

# Find Python launcher
$pythonCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCmd = 'python' }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $pythonCmd = 'py' }

if (-not $pythonCmd) {
    Write-Status 'Python (python/py on PATH)' $false 'Install Python 3.10+ from https://python.org and enable "Add Python to PATH".'
} else {
    try {
        $ver = & $pythonCmd -c "import sys; v=sys.version_info; print(f'{v[0]}.{v[1]}.{v[2]}')" 2>$null
        $ver = $ver.Trim()
        $parts = $ver.Split('.') | ForEach-Object { [int]$_ }
        $ok = ($parts[0] -gt 3) -or (($parts[0] -eq 3) -and ($parts[1] -ge 10))
        Write-Status "Python ($pythonCmd) version $ver" $ok (if ($ok) { '' } else { 'Requires Python 3.10+' })
    } catch {
        Write-Status "Python ($pythonCmd)" $false 'Could not run python to check version.'
    }
}

# Check repository venv
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    Write-Status '.venv present' $true "Using $venvPython"
    $checkerPython = $venvPython
} else {
    Write-Status '.venv present' $false 'Run .\scripts\setup.ps1 to create .venv'
    $checkerPython = $pythonCmd
}

# Check common Python packages by attempting to import via the chosen python
if ($checkerPython) {
    $pkgs = @('ezdxf','cv2','PIL','pyperclip','numpy')
    $installed = @()
    $missing = @()
    foreach ($p in $pkgs) { $missing += $p }
    try {
        $code = @"
import importlib,sys
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
"@
        $out = & $checkerPython -c $code 2>$null
        $out = $out.Trim()
        if ($out) { $installed = $out.Split(',') } else { $installed = @() }
        foreach ($i in $installed) { $missing = $missing | Where-Object { $_ -ne $i } }
        foreach ($i in $installed) { Write-Status "Python package: $i" $true }
        foreach ($m in $missing) { Write-Status "Python package: $m" $false 'Not importable in chosen interpreter' }
    } catch {
        Write-Host "Could not probe Python packages with $checkerPython: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host 'Skipping Python package checks because no Python interpreter found.' -ForegroundColor Yellow
}

# Check Node & npm
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
Write-Status 'Node.js (node on PATH)' ($node -ne $null) (if ($node) { $node.Source } else { 'Install Node.js (https://nodejs.org/) or nvm-windows' })
Write-Status 'npm (npm on PATH)' ($npm -ne $null) (if ($npm) { $npm.Source } else { 'Install Node.js to get npm, or ensure npm is on PATH' })

# Check OpenSCAD
$openScadEnv = $env:OPENSCAD_BIN
$openscadCmd = $null
if ($openScadEnv -and (Test-Path $openScadEnv)) { $openscadCmd = $openScadEnv }
else {
    $maybe = @('openscad.com','openscad.exe')
    foreach ($m in $maybe) { if (Get-Command $m -ErrorAction SilentlyContinue) { $openscadCmd = (Get-Command $m).Source; break } }
}
Write-Status 'OpenSCAD CLI' ($openscadCmd -ne $null) (if ($openscadCmd) { $openscadCmd } else { 'Install OpenSCAD and ensure openscad.com is on PATH, or set OPENSCAD_BIN env var' })

# Check Visual C++ Build Tools (cl.exe) presence
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
Write-Status 'MSVC toolchain (cl.exe on PATH)' ($cl -ne $null) (if ($cl) { $cl.Source } else { 'If pip builds fail, install "Build Tools for Visual Studio" (C++ build tools)' })

Write-Host "`nSummary & suggestions:`
 - If Python packages are missing in the venv, run:  .\scripts\setup.ps1  and check pip-install.log
 - If OpenSCAD missing, install from https://openscad.org and add openscad.com to PATH
 - If Node/npm missing or failing, install Node.js from https://nodejs.org or use nvm-windows
 - If pip builds fail (compiling extensions), install Visual C++ Build Tools
" -ForegroundColor Cyan

Pop-Location -ErrorAction SilentlyContinue | Out-Null

exit 0
