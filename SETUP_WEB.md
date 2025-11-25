# Gridfinity Shadow Maker — Web + Python Setup (Quick Start)

This project now includes a web front-end (React + TypeScript) and a lightweight Node.js backend (Express) that runs the existing Python image-processing code. This document explains how to set up and run the project locally on Windows for the first time. OpenSCAD instructions are intentionally omitted here.

Prerequisites
- Windows (instructions use PowerShell). Adjust for macOS/Linux as needed.
- Node.js (v16+ recommended) and npm
- Python 3.10+ (or your preferred 3.x), with pip

High-level components
- `frontend/` — React + TypeScript app (dev server with Vite)
- `backend/` — Node.js Express server (`server.js`) that accepts image uploads and calls the Python runner
- `src/processing.py` — existing image-processing / DXF export code (Python)

Quick checklist (copy/paste)
1. Open a PowerShell and install Node/npm if you don't have it: https://nodejs.org/
2. Create and activate a Python virtual environment (recommended):

```powershell
python -m venv .venv
# activate the venv
.\.venv\Scripts\Activate.ps1
```

3. Install Python dependencies (in the activated venv)

```powershell
pip install --upgrade pip
pip install opencv_python pillow ezdxf pyperclip numpy pyqt5
# other utilities used by the desktop code (optional but recommended):
pip install colorama fonttools iniconfig packaging pytest typing_extensions
```

Notes:
- `pyqt5` is required only if you run the original desktop UI; the server-side Python runner uses `src.processing` and monkeypatches display functions, but PyQt may still be imported by `src.processing` in some flows.
- Installing OpenCV (`opencv_python`) can be heavy; if it causes issues, consult the package docs or install a matching wheel for your Python version.

4. Install frontend dependencies

```powershell
cd frontend
npm install
```

5. Start the backend server

Open a PowerShell in `backend/` and run (this kills any process using port 5000, then starts the server):

```powershell
$line=(netstat -ano | findstr :5000 | Select-Object -First 1); if ($line) { $found=($line -split '\s+')[-1]; Write-Host "Killing PID $found"; taskkill /PID $found /F } else { Write-Host "No process using port 5000" }; node server.js
```

The server listens on `http://localhost:5000` by default and exposes endpoints used by the frontend:
- `POST /process-image` — accepts an `image` file and optional `project`, `threshold`, `offset`, `token`, `resolution` form fields.
- `POST /save-project` — saves a `.gsm` project file into the per-project folder (sent as JSON).

6. Start the frontend dev server

Open a SECOND PowerShell in the project root (or `frontend`) and run:

```powershell
cd frontend
npm run dev
```

Vite will show the local dev address (usually `http://localhost:5173`). Open that in your browser.

Basic first-run flow (sanity checks)
- In the app header set a `Project Name` (default is provided); this becomes the per-project folder under the repository root.
- Trace tab → `Load Image`: choose a photo. The backend will save the uploaded original into `../<projectName>/` and create processing output under `../<projectName>/processing_output`.
  - Look for `original.png`, `traced.png`, `offset.png`, and `meta.json` in that folder.
  - The server response includes `used_input` and `dxf` info (from `meta.json`). If you get errors, check the backend console for diagnostics.
- Canvas tab → `+ Import DXF`: multi-select one or more DXF files to import. Imported shapes keep the DXF coordinates and are added to the board.

Where files are stored
- Project folders are created in the repository root as `../<projectName>` (i.e., `GridfinityShadowMaker/<projectName>`).
- Processing outputs are under `../<projectName>/processing_output`.

Troubleshooting
- Backend fails to start: ensure Node is installed and port 5000 is free. Use the PowerShell `netstat`/`taskkill` snippet above to clear the port.
- Python errors during processing: ensure the activated Python environment has the required packages. Re-run `pip install` inside your venv.
- DXF appears off-canvas: DXF coordinates are preserved exactly. If coordinates are outside your board bounds, either pan/zoom (not implemented) or import a DXF exported with coordinates relative to the desired board origin.

Developer notes
- The backend intentionally passes `--projectdir` (repo root) and `--workfolder` (per-project folder) to the Python runner so the existing desktop `src.processing` module can be reused without copying.
- `project.json` (written into the per-project folder on upload) stores the canonical original filename for deterministic reprocessing.

Omitted (for now)
- OpenSCAD instructions and STL generation are intentionally omitted here — they will be reintroduced once we wire the rendering/export path.

Next steps / recommendations
- Add a short `requirements.txt` or `pyproject.toml` to lock Python deps.
- Add a short `README-DEV.md` with a checklist for building the Windows environment: matching Python version, GPU/CPU OpenCV advice, and PyQt notes.
- Consider a small script to create and activate the Python venv and install dependencies automatically.

If you want, I can:
- Add this content into `README.md` (replacing or appending the current setup section), or
- Commit this as a new `SETUP_WEB.md` file (already prepared). Which do you prefer?
