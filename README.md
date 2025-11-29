# Gridfinity Shadow Maker

A web-first toolchain (React frontend + Node.js backend) that uses
Python processing pipeline and OpenSCAD to generate Gridfinity
shadow boards and STL/DXF assets.

## Highlights

- Accurately traces objects from photos with adjustable preprocessing and threshold controls.
- Outputs standard design formats for downstream tooling: `DXF` for vector/CAD workflows and `STL` for 3D printing.
- Preserves all project assets and design files (images, OpenSCAD sources, DXF files, and canvas geometry stored as JSON).
- Save and share projects as a single `.gsm` file that contains everything required to reload the project.

<table>
   <tr>
      <td><img src="assets/images/1%20GSM%20Server%20Dashboard.png" alt="GSM Server Dashboard" width="400"></td>
      <td><img src="assets/images/2%20Trace%20Object.png" alt="Trace Object" width="400"></td>
   </tr>
   <tr>
      <td colspan="2"><img src="assets/images/3%202D%20Canvas.png" alt="2D Canvas (hero)" width="800"></td>
   </tr>
   <tr>
      <td><img src="assets/images/4%203D%20Viewer.png" alt="3D Viewer" width="400"></td>
      <td><img src="assets/images/5%20orcastudio%20example.png" alt="Orca Studio example" width="400"></td>
   </tr>
</table>



## Step-by-Step Guide

### Step 1: Take and Edit Pictures
1. **Take Photos**: Use a lightboard to take photos of your tools or components. Best images can be taken in an enclosure or dark room. Ensure to include a 3" token in the photo for scale reference (you can 3d print the token found in the main folder folder). Based on your ambient lighting conditions, you will need to fine-tune your Threshold Input value.
2. **Example Images**: An example image taken on a lightbox is located in the `examples` folder. You can use these to learn the workflow or debug problems.
3. **Crop Photos**: Ensure the borders of the photos are all white.
4. **Touch-Up Photos**: Edit the photos as needed to create the shape you want to outline. The basic Paint application is most popular. Black filled shapes do well to ensure crisp, high contrasting edges are found

### Step 2: Trace Object
1. **Launch the Server** and then run the app at http://localhost:5173/
2. Change your **Project Name** at the top
3. Click the **Trace Object** tab at the top then "Load Image"
4. Adjust **Threshold, offset, Token Size, and resolution** to meet your needs and press **Process Image** Again if needed.

### Step 3: 2D Canvas
1. Draw shapes, import DXF's, and add text how you like
2. Items can be extruded, cut, or blockers can be added to make islands on cut areas
3. Adjust Cut Depths, scale, and rotate objects as needed

### Step 3: Generate STL
1. Press "Generate STL" to output the STL and view it in the "3D Render" tab
2. Iterate as needed
3. All design files will be saved within a folder with the same name as the project name

### Step 4: Color and Slice
1. Bring into your favorite slicer
2. Color, slice, print

Python 3.10+ and pip
- Official downloads & docs: https://www.python.org/downloads/
- Recommended install: use the official python.org Windows installer
   ```powershell
   # Download and run the official Windows installer from:
   # https://www.python.org/downloads/windows/
   # During the installer, CHECK the "Add Python to PATH" checkbox before installing.
   ```

- Verify installation (open a new PowerShell window after installing):
   ```powershell
   python --version
   python -m pip --version
   ```

Important: If you ran the installer from Command Prompt, close and re-open that Command Prompt (or PowerShell) before running the verification commands so PATH changes take effect.

Notes:
- We recommend the python.org installer so you get an explicit "Add Python to PATH" option and predictable behavior.
- If you installed Python from the Microsoft Store or another source and `python` is not found in PowerShell, open a new PowerShell window and retry the verification commands above.
- If `python` is still not found, you can add Python to the current session or permanently to your User PATH (replace the path with your actual install folder):

   Temporary (current session only):
   ```powershell
   $env:Path += ';C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39;C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39\Scripts'
   python --version
   ```

   Permanent (applies after you close and reopen PowerShell):
   ```powershell
   $pythonFolder = 'C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39'
   $scriptsFolder = "$pythonFolder\Scripts"
   $existing = [Environment]::GetEnvironmentVariable('Path','User')
   if (-not ($existing -like "*$pythonFolder*")) {
      [Environment]::SetEnvironmentVariable('Path', $existing + ';' + $pythonFolder + ';' + $scriptsFolder, 'User')
      Write-Host "Appended $pythonFolder and Scripts to User PATH. Close and reopen PowerShell."
   } else {
      Write-Host "Python path already present in User PATH."
   }
   ```
project locally.

# Quick Start (web + python)
---
These steps assume you're on Windows (PowerShell).

Prerequisites

Node.js (v16+ recommended) and npm
- Official downloads & docs: https://nodejs.org/
- Windows quick install (winget):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
- Verify installation (run these in PowerShell — if you installed Node from Command Prompt, open a new PowerShell window before running):
   ```powershell
   node --version
   npm --version
   ```

Python 3.10+ and pip
- Official downloads & docs: https://www.python.org/downloads/
- Windows quick install (winget):
   ```powershell
   # First, list available Python packages and note the exact Id shown
   winget search python

   # Use the exact Id from the search results when installing. Examples you may see:
   winget install --id=Python.Python.3.11 -e
   winget install --id=Python.Python.3.12 -e
   winget install --id=Python.Python.3.13 -e

   # If the search shows a generic Id such as 'Python.Python.3' you can install that too:
   winget install --id=Python.Python.3 -e
   ```
- During installation, ensure "Add Python to PATH" is selected. If you installed via the Microsoft Store or an installer, open a new PowerShell window before verifying the install. Verify:
   ```powershell
   python --version
   python -m pip --version
   ```

Notes:
- `winget` manifests vary by system and region; `winget search python` shows the exact `Id` you should pass to `winget install` on your machine.
- If `winget` fails or you prefer a GUI installer, download the official installer from python.org and enable "Add Python to PATH" during setup.
- Some installers (including certain Microsoft Store or winget manifests) do not prompt to add Python to your PATH. If after installing Python you get a "python is not recognized" error in PowerShell, do one of the following:

   1) Open a new PowerShell window (PATH changes apply only to new shells) and verify if `python` is now available:
   ```powershell
   python --version
   python -m pip --version
   ```

   2) Temporarily add Python to the current PowerShell session (replace the path below with the folder that contains your `python.exe`):
   ```powershell
   # Example common locations; pick the one that exists on your machine
   Test-Path "$env:LOCALAPPDATA\Programs\Python\Python39\python.exe"
   Test-Path 'C:\Program Files\Python39\python.exe'

   # If python.exe is at C:\Users\<You>\AppData\Local\Programs\Python\Python39, add it to this session's PATH:
   $env:Path += ';C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39;C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39\Scripts'
   python --version
   ```

   3) Permanently add Python to your User PATH (replace the path with the one that matches your install). Run this in PowerShell and then close/reopen PowerShell:
   ```powershell
   $pythonFolder = 'C:\Users\<YourUser>\AppData\Local\Programs\Python\Python39'
   $scriptsFolder = "$pythonFolder\Scripts"
   $existing = [Environment]::GetEnvironmentVariable('Path','User')
   if (-not ($existing -like "*$pythonFolder*")) {
      [Environment]::SetEnvironmentVariable('Path', $existing + ';' + $pythonFolder + ';' + $scriptsFolder, 'User')
      Write-Host "Appended $pythonFolder and Scripts to User PATH. Close and reopen PowerShell."
   } else {
      Write-Host "Python path already present in User PATH."
   }
   ```

   4) If you prefer a simpler developer workflow, consider installing `nvm-windows` and managing Node/Python versions via nvm or use the python.org installer which exposes an explicit "Add to PATH" option.

Notes
- This repository's helper scripts are designed for Windows PowerShell. Use `.
   scripts\setup.ps1` from the repository root to install dependencies and set up the environment.

1) Run the setup script (installs Python and frontend dependencies)
```powershell
# from repo root
.\scripts\setup.ps1
```
This script creates a virtual environment (if missing), installs Python
dependencies from `requirements.txt` using the virtual environment's Python,
and runs `npm install` in `frontend/`.

2) Launch the app (starts frontend and backend)
- Double-click `Launch GSM Server.py` in File Explorer (Windows), or
- Run from the repo root:
```powershell
python "Launch GSM Server.py"
```
The launcher/dashboard starts both backend and frontend servers and shows
their logs. Default server URLs are `http://localhost:5000` (backend) and
`http://localhost:5173` (frontend), though the frontend dev server may select
an alternate port if 5173 is occupied.

Important endpoints:
- `POST /process-image` — accepts `image` file upload and optional form fields: `project`, `threshold`, `offset`, `token`, `resolution`.
- `POST /save-project` — accepts project JSON to persist `.gsm` into the chosen project folder.

Basic developer flow (sanity checks)
- Set a `Project Name` in the header — the server will create a per-project
   folder at the repository root (`<repoRoot>/<ProjectName>`).
- Trace tab → `Load Image` → upload a photo. Check `<repoRoot>/<ProjectName>/processing_output`
   for `original.png`, `traced.png`, `offset.png`, and `meta.json`.
- Canvas tab → `+ Import DXF`: you can multi-select DXF files; imported shapes
   preserve DXF coordinates and rotate about their bounding-box centroid.
- Select a shape and press `Delete` or `Backspace` on the 2D Canvas to remove it.
- Header `Save` will attempt to save `.gsm` into the project folder via the
   backend; if the backend is unreachable it falls back to a local file download.

Where files live
- Per-project folder: `GridfinityShadowMaker/<ProjectName>/`
- Processing outputs: `GridfinityShadowMaker/<ProjectName>/processing_output`
- DXF files created by proc

Contributing
- Please follow the project code style. Frontend changes live under
   `frontend/src` (TypeScript + React); backend is in `backend` (Node/Express);
   image-processing logic is in `src/processing.py` (Python).

AI-assisted contributions:
- If you use an AI assistant to help with development, load `AI_README.md` into your tool of choice; it contains an agent-focused summary of the architecture, key files, runtime commands, and high-value tasks to speed onboarding and productive contributions.

License
- See `LICENSE` at the repository root.