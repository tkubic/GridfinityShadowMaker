@echo off
REM openscad-cli.bat - shim to run OpenSCAD CLI on Windows without launching GUI
REM Usage: openscad-cli.bat [args]



@echo off
REM openscad-cli.bat - shim to run OpenSCAD CLI on Windows without launching GUI
REM Usage: openscad-cli.bat [args]

:: If OPENSCAD_BIN is set, prefer it
if defined OPENSCAD_BIN (
	"%OPENSCAD_BIN%" %*
	exit /b %ERRORLEVEL%
)

:: Try common install locations (prefer openscad.com)
if exist "%ProgramFiles%\OpenSCAD\openscad.com" (
	"%ProgramFiles%\OpenSCAD\openscad.com" %*
	exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\OpenSCAD\openscad.exe" (
	"%ProgramFiles%\OpenSCAD\openscad.exe" %*
	exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\OpenSCAD (Nightly)\openscad.com" (
	"%ProgramFiles%\OpenSCAD (Nightly)\openscad.com" %*
	exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\OpenSCAD (Nightly)\openscad.exe" (
	"%ProgramFiles%\OpenSCAD (Nightly)\openscad.exe" %*
	exit /b %ERRORLEVEL%
)

:: As a last resort try PATH for openscad.com then openscad.exe
where openscad.com >nul 2>&1
if %ERRORLEVEL% EQU 0 (
	openscad.com %*
	exit /b %ERRORLEVEL%
)
where openscad.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
	openscad.exe %*
	exit /b %ERRORLEVEL%
)

echo OpenSCAD CLI not found. Set the OPENSCAD_BIN environment variable to the full path to openscad.com, or install OpenSCAD.
exit /b 2