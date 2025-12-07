# Gridfinity Shadow Maker

**Gridfinity Shadow Maker (GSM)** is an easy-to-use, open-source tool that turns **photos of your tools** into clean, printable **Gridfinity shadow boards**.  
You don’t need CAD experience — just take a picture, let the program automatically trace the outline, arrange your layout, export the STL, color it in your slicer, and print. The entire workflow is designed so you can go from **tool in hand to printing in under five minutes.**

Created to support **industrial 5S/Standardize programs** and high-reliability tool control, while still being accessible and helpful for home makers and hobbyists who appreciate organized tool storage.

---

## ⭐ Highlights

- **Automatically trace objects** from photos with adjustable thresholding and filters  
- **Import DXF files**, draw rectangles/circles, and add text on a 2D canvas  
- **Arrange, rotate, resize, and set cut depths** per object  
- **Generate STL and DXF** outputs for 3D printing or CAD  
- Built-in **3D viewer** for previewing your layout  
- Save & share whole projects as a single **`.gsm` file**   

---

# 🟢 Installation (Windows Only)

GSM is designed so **non-technical users can install it easily**.

### ✔ You only need to install:
1. **Python 3.13** (official python.org installer recommended; choose 64‑bit and select *Add to PATH*)
    - version 3.14 has been giving issues and not currently recommended  
3. **OpenSCAD Nightly**  
4. Then run the **setup.ps1** script in PowerShell

---

## 1) Install Python 3.13

Download version 3.13 from python.org and make sure to select **Add to PATH**.

Verify the install in a command prompt or PowerShell:

```powershell
python --version
pip --version
```

> If "python not recognized" appears, close PowerShell and reopen — PATH updates only apply to new shells.  

---

## 2) Install OpenSCAD Nightly

Download the latest **nightly build**:  
https://openscad.org/downloads.html#snapshots

You **must** install the nightly version.  
The 2021 “stable” build only supports extremely slow CGAL rendering and will not work well with GSM's fast manifold pipeline.


---

## 3) Run the Setup Script

Inside the `scripts` folder, right‑click **setup.ps1** → *Run with PowerShell*.  
If Windows SmartScreen blocks it, click **More info → Run anyway**.

The script will:

- Install Python dependencies  
- Install Node.js automatically (if missing)  
- Install all frontend dependencies (`npm install` inside `frontend/`)  

> If a black window opens and closes you may have an execution policy issue. Open a new powershell by right-clicking on PowerShell and select Run as Administrator.
> Then run the following command:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope LocalMachine
```

> This changes the execution policy for all users on the machine, but be aware that it requires admin rights and could have wider implications.

---

## 4) Launch Gridfinity Shadow Maker

Double-click **Launch GSM Server.py** from the root folder.  
If needed, right-click → *Open with Python*.

The two dashboard windows display frontend and backend server logs and status.

Click **Launch App** to open GSM in your browser.

---

# 🚀 Using Gridfinity Shadow Maker

## Step 1 — Take & Prepare Photos

- Place tools on a **lightboard or bright contrasting background**  
- Use the included **3-inch scaling token** (printable STL in repo root)  
- Crop images so **all four borders are white** — this helps the tracer detect edges cleanly  
- Optional but helpful: fill tool shapes with black in MS Paint to enhance contrast  

Example photos are included in `/examples`.

---

## Step 2 — Trace the Object

1. Go to the **Trace Object** tab  
2. Click **Load Image** and select your photo  
3. Adjust:
   - Threshold  
   - Offset  
   - Token size  
   - Resolution  
4. Click **Process Image Again**, if needed, to regenerate the outline
   - Repeat adjustments as needed.
5. Once ready, click **Transfer to Canvas** to move the traces onto your canvas.


---

## Step 3 — Build Your Layout on the 2D Canvas

- Import **DXF** files  
- Draw **Rectangles**, **Circles**, and **Text**  
- **Move, rotate, scale** any item  
- Set **cut depth** per object  
- Add **blockers** to create islands and stepped pockets  
- Use the **Properties Panel** to fine‑tune rotation, scale, extrusion, and depth  

Your project saves when you click **Save** or when you **Generate STL**, default save location is the projects folder.

---

## Step 4 — Generate the Final STL

1. Click **Generate STL**  
2. Inspect the 3D preview  
3. Export the STL  
4. Open in your slicer → color → slice → print  

---

# 🛠 Troubleshooting

### Python not found
Close PowerShell → reopen → run:

```powershell
python --version
```

If still missing, reinstall from python.org and ensure **Add to PATH** is selected.

### OpenSCAD not found
Add the nightly installation folder to PATH or reopen PowerShell.

### Setup script errors
Re-run:

.\scripts\setup.ps1

---

# 👨‍💻 Developer Notes

- **Frontend:** `frontend/` (React + TypeScript + Vite)  
- **Backend:** `backend/` (Node + Express)  
- **Image Processing:** `src/processing.py` (Python, OpenCV, Pillow)  
- **SCAD Generation:** `src/scadgen/`  
- Backend STL export uses **OpenSCAD Manifold Mode** (requires nightly build)

Contributions welcome!  
See `LICENSE` for details.

---
