@echo off
setlocal enableextensions

rem Change directory to the location of the Python script
cd /d %~dp0

rem install the requirements
pip install -r requirements.txt

rem Pause the batch file so you can see the output before it closes
pause