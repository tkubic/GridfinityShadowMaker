# Gridfinity Shadow Maker — Web + Python Setup (Quick Start)

This project now includes a web front-end (React + TypeScript) and a lightweight Node.js backend (Express) that runs the existing Python image-processing code. This document explains how to set up and run the project locally. OpenSCAD instructions are intentionally omitted here.

Prerequisites
- Node.js (v16+ recommended) and npm
- Python 3.10+ (or your preferred 3.x), with pip

High-level components
- `frontend/` — React + TypeScript app (dev server with Vite)
- `backend/` — Node.js Express server (`server.js`) that accepts image uploads and calls the Python runner
- `src/processing.py` — existing image-processing / DXF export code (Python)

Quick checklist (copy/paste)
1. Install Node/npm if you don't have it: https://nodejs.org/
2. Run the cross-platform setup script from the repo root:

```bash
python scripts/setup.py
```

3. Start the backend server

```bash
node backend/server.js
```

The server listens on `http://localhost:5000` by default and exposes endpoints used by the frontend:
- `POST /process-image` — accepts an `image` file and optional `project`, `threshold`, `offset`, `token`, `resolution` form fields.
- `POST /save-project` — saves a `.gsm` project file into the per-project folder (sent as JSON).

4. Start the frontend dev server

```bash
npm --prefix frontend run dev
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
- Backend fails to start: ensure Node is installed and port 5000 is free.
- Python errors during processing: run `python scripts/setup.py` to recreate `.venv` and install requirements.
- DXF appears off-canvas: DXF coordinates are preserved exactly. If coordinates are outside your board bounds, either pan/zoom (not implemented) or import a DXF exported with coordinates relative to the desired board origin.

Developer notes
- The backend intentionally passes `--projectdir` (repo root) and `--workfolder` (per-project folder) to the Python runner so the existing desktop `src.processing` module can be reused without copying.
- `project.json` (written into the per-project folder on upload) stores the canonical original filename for deterministic reprocessing.

Omitted (for now)
- OpenSCAD instructions and STL generation are intentionally omitted here — they will be reintroduced once we wire the rendering/export path.

Next steps / recommendations
- Add a short `requirements.txt` or `pyproject.toml` to lock Python deps.
- Consider a small script to create and activate the Python venv and install dependencies automatically.

If you want, I can:
- Add this content into `README.md` (replacing or appending the current setup section), or
- Commit this as a new `SETUP_WEB.md` file (already prepared). Which do you prefer?

Additional notes
----------------
- OpenSCAD CLI: when running headless renders the project prefers a CLI
  binary such as `openscad.com` on Windows or `OpenSCAD` on macOS. If the
  backend returns an error or opens the OpenSCAD GUI, set `OPENSCAD_BIN`
  to the full path for your platform.

- Developer dashboard: `tools/dev_dashboard.py` provides a small Tk UI to
  start/stop the frontend and backend, view logs, and launch the browser.
  On Windows you can also use the single-file launcher `Launch GSM Server.py`
  in the repo root to open the same dashboard.

See the **Developer quickstart & Windows notes** section in `README.md` for a compact Windows quickstart and troubleshooting tips.
