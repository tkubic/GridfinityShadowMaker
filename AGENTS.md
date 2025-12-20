# AGENTS — Agent & Automation Guide

## Purpose & Scope
- Provide concise, focused context for programmatic agents and automation to interact with the project.
- Intended audience: automated assistants, CI jobs, operator scripts, and maintainers who configure agent behavior.

## Quick Project Snapshot
- Project name: Gridfinity Shadow Maker
- Goal: Convert photos of tools/components into Gridfinity shadow boards and export assets usable for CNC/laser/CAD/3D printing workflows.
- Stack: React + TypeScript frontend (Vite), Node.js backend (Express), Python image-processing pipeline, OpenSCAD for SCAD/STL rendering.
- Primary outputs: DXF (vector), STL (3D), PNG traces, and a single-file project `.gsm` that stores project state and assets.

## Architecture & Data Flow
- Frontend (`frontend/`) is a Vite dev app that provides: image upload UI, 2D SVG canvas for editing, and a 3D viewer (STL) tab that subscribes to SSE events (`/api/render/events`).
- Backend (`backend/server.js`) exposes REST endpoints for uploads, project save/load, and an SSE stream for render completion events. It spawns the Python processing script and resolves OpenSCAD for headless rendering.
- Python pipeline (`src/processing.py`) consumes uploaded images and produces traced DXF output, intermediate images, and optional SCAD for OpenSCAD. Processing writes outputs into per-project folders under the repo root.
- OpenSCAD: invoked headless via CLI (prefer `openscad.com` on Windows). Backend emits `stl` SSE events after OpenSCAD completes.

## API / Agent Integration Points (Endpoints + SSE)
- Default servers and ports:
  - Frontend dev server: `http://localhost:5173/` (Vite may pick a different port if 5173 is busy).
  - Backend API base: `http://localhost:5000/` (configurable by editing backend env or server).
- Notable endpoints (agent-facing):
  - `POST /process-image` — multipart `image` upload and processing params (project, threshold, offset, token, resolution).
  - `POST /save-project` — save `.gsm` project JSON
  - `GET /api/render/events` — SSE for `stl` events when render completes
  - `GET /api/render/output-stl?project=<name>` — fetch rendered STL

### Minimal examples

Subscribe to SSE (keep connection open):

```bash
curl -N http://localhost:5000/api/render/events
```

POST an image for processing (multipart form):

```bash
curl -F "image=@photo.jpg" -F "project=example" \
  -F "threshold=128" -F "offset=0" \
  http://localhost:5000/process-image
```

Fetch rendered STL for a project:

```bash
curl "http://localhost:5000/api/render/output-stl?project=example" -o example.stl
```

## Key Directories & Files
- `frontend/src/` — React UI, notable files:
  - `App.tsx` — top-level app state (project, shapes, selection)
  - `components/Canvas.tsx` — SVG-based 2D canvas (selection, multi-drag, transforms)
  - `components/StlViewer.tsx` — Three.js STL viewer, subscribes to SSE for reloads
  - `main.tsx`, `index.html` — app entry
- `backend/server.js` — Express server, endpoints, spawns Python, resolves OpenSCAD CLI, serves generated files and SSE.
- `src/processing.py` — image processing, tracing, DXF export, writing assets to per-project folders and `assets/`.
- `Launch GSM Server.py` — single-file GUI launcher (Tk) to start/stop frontend + backend and show logs; has logic to hide console (relaunch under `pythonw.exe`), kill processes on ports, and capture stdout/stderr.
- `tools/dev_dashboard.py` — alternate dashboard implementation (Tk) used for development.
- `scripts/setup.ps1` — PowerShell setup helper: creates `.venv`, installs Python packages from `requirements.txt` (when present) using the venv Python, and runs `npm install` in `frontend/`.
- `README.md` — human-facing quickstart and details.

## Setup / Run Commands (Windows + manual)

### Full setup (Windows PowerShell)

```powershell
\.\tools\setup.ps1
# (or .\tests\scripts\setup.ps1 depending on location)
```

- The setup script creates `.venv`, installs packages, and runs `npm install`.
- Double-click `Launch GSM Server.py` or run `python "Launch GSM Server.py"` to start servers with GUI logs.

### Manual start

- Backend: `node backend/server.js`
- Frontend: `npm --prefix frontend run dev`

## Conventions & Constraints
- Prefer headless OpenSCAD CLI (`openscad.com`) to avoid opening a GUI and blocking the process. `OPENSCAD_BIN` environment variable is honored for explicit override.
- Project state is saved to per-project folders; `.gsm` single-file project format contains all assets and geometry to reload a project.
- The frontend uses functional state updates for shape edits to reduce clobbering during multi-shape operations.
- Windows environment specifics: PowerShell-based `setup.ps1` and `openscad-cli.bat` exist; the launcher manages console visibility with `pythonw.exe` relaunch and uses `CREATE_NO_WINDOW` to avoid showing child consoles.

## Testing & Debugging
- If Vite chooses a different port, check launcher logs for the actual `Local` URL printed by Vite (e.g., 5173 → 5181).
- If OpenSCAD returns Exit Code 1, confirm `OPENSCAD_BIN` points to `openscad.com` (or check CLI output).
- For process port conflicts, the launcher contains heuristics to find and kill PIDs on ports 5173 (frontend) and 5000 (backend) but may require elevated permissions.
- When debugging canvas multi-select drag behavior, inspect `selectedItems`, `groupOffsetsRef`, and ensure `updateShape` uses functional `setProject(prev => ...)` updates.

## High-Value Next Tasks
- Stabilize multi-selection drag: add debug logs when drag starts and when updates are applied; add integration test that simulates multi-drag.
- Add robust health checks in the launcher: probe HTTP endpoints after start and wait/retry until both services are responsive before marking status green.
- Add automated unit/integration tests for the backend endpoints and Python processing runner (mock OpenSCAD to speed tests).
- Add `requirements.txt` pinning if missing and include a reproducible setup example for non-Windows platforms.
- Add CI step that runs lints, builds the frontend, and executes a smoke test against the backend in a containerized environment. (CI snippets not included here per request.)

## Onboarding: “Start Here”
- Files to inspect first when joining the project:
  - `frontend/src/components/Canvas.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/components/StlViewer.tsx`
  - `backend/server.js`
  - `src/processing.py`
  - `Launch GSM Server.py`
  - `scripts/setup.ps1`

- Contacts / context notes:
  - Author: repository owner (repository owner)
  - Development preference: Windows + PowerShell, but the stack runs on Linux/macOS with small adjustments.
