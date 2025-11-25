# Gridfinity Shadow Maker

This template is used to create Gridfinity shadow boards using Python scripts and OpenSCAD.

## Highlights

<table>
  <tr>
    <td colspan="2"><img src="assets/images/Image%20to%20DXF.png" alt="Image to DXF" width="800"></td>
  </tr>
  <tr>
    <td><img src="assets/images/openscad%20example.png" alt="Openscad example" width="400"></td>
    <td><img src="assets/images/orcastudio%20example.png" alt="Orca Studio example" width="400"></td>
  </tr>
</table>



## Step-by-Step Guide

### Step 1: Take and Edit Pictures
1. **Take Photos**: Use a lightboard to take photos of your tools or components. Best images can be taken in an enclosure or dark room. Ensure to include a 3" token in the photo for scale reference (you can 3d print the token found in the main folder folder). Based on your ambient lighting conditions, you will need to fine-tune your Threshold Input value.
2. **Example Images**: An example image taken on a lightbox is located in the `examples` folder. You can use these to learn the workflow or debug problems.
3. **Crop Photos**: Ensure the borders of the photos are all white.
4. **Touch-Up Photos**: Edit the photos as needed to create the shape you want to outline. The basic Paint application is most popular. Black filled shapes do well to ensure crisp, high contrasting edges are found

### Step 2: Trace the Objects
1. Run the provided Python script to create your OpenSCAD files.
2. Enter a project name. This will save all design files to a folder of that name to aide in documenting your work.
# Gridfinity Shadow Maker

A toolchain for generating Gridfinity shadow boards from photos — now rearchitected
as a web-first app with a lightweight Node.js backend that runs the existing
Python image-processing code.

This repository historically shipped a PyQt-based desktop UI. This version
(major refactor) adopts a React + TypeScript frontend and an Express (Node.js)
backend that invokes the original Python processing code. The desktop PyQt UI
is deprecated and will be retired in a future release; the core Python
processing remains the single source of truth and is reused by the server.

This README documents the new web+python developer setup and how to run the
project locally. OpenSCAD/STL export is intentionally omitted here — it's a
follow-up task.

Highlights
- Web front-end: React + TypeScript (Vite)
- Backend: Node.js + Express (`backend/server.js`) to accept image uploads and
   spawn the Python runner
- Reuses the existing Python processing code in `src/processing.py`
- Preserves DXF coordinates and supports multi-file DXF import
- Save project (.gsm) into per-project folders; deterministic reprocessing

Important: Desktop UI retirement
- The old PyQt desktop frontend is deprecated. The Python processing code in
   `src/processing.py` is still used, but the PyQt UI will be retired and
   removed in a future release. New development and documentation should target
   the web frontend in `frontend/` and the Node.js backend in `backend/`.

Quick Start (web + python)
---
These steps assume you're on Windows (PowerShell) — adjust shell commands for
macOS/Linux where appropriate.

Prerequisites
- Node.js (v16+ recommended) and npm or yarn
- Python 3.10+ and pip

1) Create and activate a Python virtual environment (recommended)
```powershell
# from repo root
python -m venv .venv
# activate the venv (PowerShell)
.\\.venv\\Scripts\\Activate.ps1
```

2) Install Python dependencies
- Minimal processing dependencies (used by `src.processing`):
```powershell
pip install --upgrade pip
pip install opencv_python pillow ezdxf pyperclip numpy
```
- Optional / development extras (tests, utilities):
```powershell
pip install colorama fonttools iniconfig packaging pytest typing_extensions
```
Notes:
- `pyqt5` is no longer required for the web workflow and will be removed
   in upcoming releases. If you still use the legacy desktop UI, install
   `pyqt5` in your venv.
- OpenCV (`opencv_python`) can be large; follow OS-specific wheel advice if
   installation fails.

3) Install frontend dependencies
```powershell
cd frontend
npm install
```

4) Start the backend server
Open a PowerShell in `backend/` and run (this snippet kills any process using
port 5000 and starts the server):
```powershell
$line=(netstat -ano | findstr :5000 | Select-Object -First 1);
if ($line) {
   $found=($line -split '\\\s+')[-1]; Write-Host "Killing PID $found"; taskkill /PID $found /F
} else { Write-Host "No process using port 5000" };
node server.js
```
- Server base URL: `http://localhost:5000`
- Important endpoints:
   - `POST /process-image` — accepts `image` file upload and optional
      form fields: `project`, `threshold`, `offset`, `token`, `resolution`.
   - `POST /save-project` — accepts project JSON to persist `.gsm` into the
      chosen project folder.

5) Start frontend dev server
Open another terminal, then:
```powershell
cd frontend
npm run dev
```
Open the Vite URL (usually `http://localhost:5173`) in your browser.

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
- DXF files created by processing are placed in the per-project folder.

Developer notes / rationale
- The server invokes the Python runner with `--projectdir` (repo root) and
   `--workfolder` (per-project folder) so `src.processing` can be reused
   without copying code.
- On image upload the server writes `project.json` containing the canonical
   original filename to make "Process Image Again" deterministic.
- `src/processing.py` was updated to write DXF files using absolute coordinates
   and to save `meta.json` describing DXF outputs.

Testing & troubleshooting
- If `/process-image` fails, check backend logs — the server prints the full
   python spawn args and `Final workInputPath` used.
- If DXFs appear misplaced, confirm the DXF coordinates (they are preserved
   by design) or re-export DXFs with coordinates relative to your desired
   board origin.

Migration / Retirement plan for PyQt desktop UI
- The desktop PyQt UI is deprecated. The processing code (`src/processing.py`)
   will be kept as the canonical pipeline for image analysis and DXF export,
   but UI interaction should move to the React frontend.
- If you still need the old UI, install `pyqt5` in your Python environment.
- Future releases will remove PyQt UI files or move them into an `archive/`
   folder once documented migration is complete.

Next recommended items
- Create `requirements.txt` or `pyproject.toml` to pin Python dependencies.
- Add a short `README-DEV.md` with troubleshooting steps for common Windows
   installation problems, or
- Consider adding a `scripts/setup.ps1` to automate venv + pip install steps.

Convenience scripts
- Location: the `scripts/` folder contains small PowerShell helpers to make
   local development easier on Windows.
   - `scripts/setup.ps1` — creates a `.venv`, upgrades `pip`, installs
      `requirements.txt`, and optionally runs `npm install` in `frontend/`.
   - `scripts/restart-backend.ps1` — stops any process listening on port
      `5000` and launches the backend server (`backend/server.js`) in a new
      PowerShell window.
   - `scripts/restart-frontend.ps1` — stops any process listening on port
      `5173` and launches the frontend (`npm run dev`) in a new PowerShell
      window.
   - `scripts/restart-dev.ps1` — runs both restart scripts to bring up the
      full dev stack.

   Usage (from the repo root):
   ```powershell
   .\scripts\setup.ps1
   .\scripts\restart-dev.ps1
   ```

   These scripts are convenience helpers; they use `Stop-Process` / `taskkill`
   to free ports and open new windows so logs stay visible. If you prefer a
   different workflow (single terminal, background services, or `pm2`), feel
   free to modify them.

Contributing
- Please follow the existing code style. Frontend changes live under
   `frontend/src` (TypeScript + React); backend is in `backend` (Node/Express);
   image-processing logic is in `src/processing.py` (Python).

License
- See `LICENSE` at the repository root.

---

If you'd like, I can also:
- Append this content to `README.md` and remove the legacy desktop sections
   entirely (done now), or additionally
- Add a short `README-DEV.md` with troubleshooting steps for common Windows
   installation problems, or
- Create `requirements.txt` and a `scripts/setup.ps1` installer to automate
   the venv + pip install steps.

Tell me which additional item you'd like next and I'll add it.
