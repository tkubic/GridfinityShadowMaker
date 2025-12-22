# Gridfinity Shadow Maker

**Gridfinity Shadow Maker (GSM)** is an easy-to-use, open-source tool that turns **photos of your tools** into clean, printable **Gridfinity shadow boards** using only a camera, a 3D printer, and an inexpensive light trace board.

No CAD experience is required. Take a photo, let GSM automatically trace the outline, arrange your layout, export an STL, apply color in your slicer, and print.  
The workflow is designed so you can go from **tool in hand to printing in under five minutes**.

GSM was created to support **industrial 5S / Standardize programs** and high‑reliability tool control, while remaining approachable for home makers and hobbyists who value organized tool storage.

---

## ⭐ Highlights

- Automatically trace objects from photos with adjustable thresholding and offsets  
- Arrange tools, text, and cutouts on a 2D canvas  
- Import DXF files and export STL or DXF outputs  
- Built‑in 3D viewer for previewing the final model  
- Save and share complete projects as a single `.gsm` file  

---

## 📸 Screenshots & Demo

Below is a short demo video showing the full workflow:

[![Watch the Gridfinity Shadow Maker demo](https://img.youtube.com/vi/Aso7XpVL_yk/maxresdefault.jpg)](https://youtu.be/Aso7XpVL_yk)

<!-- Screenshot thumbnail grid -->
<table align="center">
  <tr>
    <td align="center">
      <img src="assets/images/1%20GSM%20Server%20Dashboard.png" width="500" alt="GSM Server Dashboard">
    </td>
    <td align="center">
      <img src="assets/images/2%20Trace%20Object.png" width="500" alt="Trace Object">
    </td>
  </tr>

  <tr>
    <td align="center" colspan="2">
      <img src="assets/images/3%202D%20Canvas.png" width="1020" alt="2D Canvas">
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="assets/images/4%203D%20Viewer.png" width="500" alt="3D Viewer">
    </td>
    <td align="center">
      <img src="assets/images/5%20orcastudio%20example.png" width="500" alt="OrcaSlicer example">
    </td>
  </tr>
</table>
---

## 🟢 Installation (Windows Only)

GSM is designed so **non‑technical users can install it easily**.

### ✔ You only need to install:
1. **Python 3.13** (64‑bit, *Add to PATH*)  
   - Python 3.14+ is currently not recommended  
2. **OpenSCAD Nightly Build**  
3. Run the provided **setup.ps1** script  

---

## 1) Install Python 3.13

Download Python 3.13 from:  
https://www.python.org/downloads/

Ensure **Add to PATH** is selected during installation.

Verify:

```powershell
python --version
pip --version
```

---

## 2) Install OpenSCAD Nightly

Download the latest nightly build from:  
https://openscad.org/downloads.html#snapshots

⚠️ The nightly build is **required**.  
The stable release relies on CGAL‑only rendering, which is significantly slower and not suitable for GSM’s manifold‑based workflow.

---

## 3) Run the Setup Script

Inside the `scripts` folder, right‑click **setup.ps1** and select **Run with PowerShell**.

The setup script will:
- Install Python dependencies  
- Automatically install Node.js if missing  
- Install all frontend dependencies  

---

## 4) Launch Gridfinity Shadow Maker

Double‑click **Launch GSM Server.py** in the root folder  
(or right‑click → *Open with Python*).

Click **Launch App** to open GSM in your web browser.

---

## 🚀 High‑Level Workflow (Read First)

Gridfinity Shadow Maker follows a simple, linear workflow:

**Capture → Edit → Trace → Layout → Generate → Print**

At a high level:
1. Capture a photo of the tool with a scaling token  
2. Cleanup trace 
3. The program will trace the image and send vectors to the canvas
4. Arrange tools and labels on the canvas  
5. The tool will generate the STL
6. Slice and print

> ⚠️ If a tool doesn’t fit, the image is almost always the reason.

Detailed, production‑ready guidance is intentionally kept out of the README.

---

## 📘 Documentation (Required Reading)

All detailed instructions, best practices, and troubleshooting live in the **GitHub Wiki**.

👉 **Wiki Home**  
https://github.com/tkubic/GridfinityShadowMaker/wiki/Home

👉 **Taking an Image (Critical Deep Dive)**  
https://github.com/tkubic/GridfinityShadowMaker/wiki/Taking-an-Image:-Critical-Deep-Dive

The image guide alone prevents the majority of first‑time failures.

---

## 👨‍💻 Developer Notes

- Frontend: React + TypeScript + Vite  
- Backend: Node.js + Express  
- Image processing: Python + OpenCV  
- STL export uses OpenSCAD Manifold Mode  

Contributions are welcome.
