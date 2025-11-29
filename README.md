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

# Gridfinity Shadow Maker
A toolchain for generating Gridfinity shadow boards from photos. The project
is a web-first app with a lightweight Node.js backend that runs the Python
image-processing pipeline.

This README documents the web + Python developer setup and how to run the
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
- Verify installation:
   ```powershell
   node --version
   npm --version
   ```

Python 3.10+ and pip
- Official downloads & docs: https://www.python.org/downloads/
- Windows quick install (winget):
   ```powershell
   winget install --id=Python.Python.3 -e
   ```
- During installation, ensure "Add Python to PATH" is selected. Verify:
   ```powershell
   python --version
   python -m pip --version
   ```

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