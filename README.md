# Gridfinity Shadow Maker

A web-first toolchain (React frontend + Node.js backend) that uses
Python processing pipeline and OpenSCAD to generate Gridfinity
shadow boards and STL/DXF assets.

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

### Step 2: Trace Object
1. Launch the Server and then run the app at http://localhost:5173/
2. Change your project Name at the top
3. Click the Trace Object tab at the top then "Load Image"
4. Adjust Threshold, offset, Token Size, and resolution to meet your needs and press Process Image Again if needed.

### Step 3: 2D Canvas
1. Draw shapes, import DXF's, and add text how you like
2. Items can be extruded, cut, or blockers can be added to make islands on cut areas
3. Adjust Cut Depths, scale, and rotate objects as needed

### Step 3: Generate STL
1. Press "Generate STL" to output the STL and view it in the "3D Render" tab
2. Iterate as needed
3. All design files will be saved within a folder with the same name as the project name

# Gridfinity Shadow Maker
A toolchain for generating Gridfinity shadow boards from photos — now rearchitected
as a web-first app with a lightweight Node.js backend that runs the existing
Python image-processing code.

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

Next recommended items
- Create `requirements.txt` or `pyproject.toml` to pin Python dependencies.
- Consider adding a `scripts/setup.ps1` to automate venv + pip install steps.

Convenience scripts
- Location: the `scripts/` folder contains a small `setup.ps1` helper that
  creates a `.venv`, upgrades `pip`, installs `requirements.txt`, and
  optionally runs `npm install` in `frontend/`.
- `openscad-cli.bat` is a Windows helper that prefers `openscad.com` (the
  CLI wrapper) when running OpenSCAD so renders run headless where possible.
- The GUI restart helpers (`restart-backend.ps1`, `restart-frontend.ps1`, and
  `restart-dev.ps1`) were removed in favor of the single-file launcher
  `Launch GSM Server.py` and the `tools/dev_dashboard.py` Tkinter dashboard.

  Usage (from the repo root):
  ```powershell
  .\scripts\setup.ps1
  # To launch the dashboard/launcher use one of:
  python tools/dev_dashboard.py
  # or double-click Launch GSM Server.py (Windows)
  ```

  These helpers are optional; they aim to simplify first-time setup. For
  CI or production automation prefer explicit commands that match your
  environment's tooling.

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

Developer quickstart & Windows notes
-----------------------------------
The following is a compact checklist for setting up and running this project
on Windows (PowerShell). It replaces separate "-dev" docs so the repository
remains production-focused while providing the necessary installation steps.

Prerequisites
- Node.js (v16+) and `npm` on PATH
- Python 3.10+ (recommend 3.10–3.12) and `pip`
- OpenSCAD installed (prefer `openscad.com` CLI on Windows)

1) Create and activate a Python virtual environment
```powershell
# from repository root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2) Install Python dependencies
```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

3) Install frontend dependencies
```powershell
cd frontend
npm install
cd ..
```

4) Set OpenSCAD binary (recommended on Windows)
- On many Windows installs, `openscad.com` is a CLI wrapper that does not open
   the GUI. If available prefer that. You can force the backend to use a specific
   OpenSCAD binary by setting the `OPENSCAD_BIN` environment variable in PowerShell:

```powershell
$env:OPENSCAD_BIN = 'C:\Program Files\OpenSCAD\openscad.com'
# Or use the full path to the CLI wrapper you prefer
```

If `openscad.com` is not available and you only have `openscad.exe`, be aware
that `openscad.exe` may open the GUI and block; prefer `openscad.com` where
possible to run headless renders.

5) Start the backend server
```powershell
# from repo root
node backend/server.js
```

6) Start the frontend dev server
```powershell
npm --prefix frontend run dev
```

7) Optional: Developer dashboard (starts/stops servers, shows logs)
```powershell
python tools/dev_dashboard.py
# Or double-click `Launch GSM Server.py` (Windows) for a single-file launcher
```

Useful server endpoints
- `POST /process-image` — upload an image for processing
- `POST /save-project` — save `.gsm` project JSON into per-project folder
- `GET /api/render/events` — SSE endpoint that emits `stl` events when a render completes
- `GET /api/render/output-stl?project=<name>` — download rendered STL

Troubleshooting
- If the backend fails with Exit Code 1 when invoking OpenSCAD, confirm
   `OPENSCAD_BIN` points to `openscad.com` (not `openscad.exe`) if available.
- If `npm` is not found when launching from the dashboard, run `where.exe npm`
   in PowerShell. If it's missing, add Node's installation `bin`/`npm` folder to your PATH
   or set `GSM_FRONTEND_CMD` in the dashboard settings to the full path to `npm.cmd`.

Notes
- `assets/offset_pos_xy.pkl` is used by the processing pipeline and now lives
   under `assets/` (not repository root).
- The frontend subscribes to `/api/render/events` to automatically reload an
   STL viewer when rendering completes; the backend emits `stl` SSE events.
