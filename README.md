# Gridfinity Shadow Maker

**Gridfinity Shadow Maker (GSM)** is an easy-to-use, open-source tool that turns **photos of your tools** into clean, printable **Gridfinity shadow boards**.

No CAD experience is required. Take a photo, let the program automatically trace the outline, arrange your layout, export an STL, apply color in your slicer, and print.  
The entire workflow is designed so you can go from **tool in hand to printing in under five minutes**.

GSM was created to support **industrial 5S / Standardize programs** and high-reliability tool control, while remaining approachable for home makers and hobbyists who value organized tool storage.

---

## ⭐ Highlights

- Automatically trace objects from photos with adjustable thresholding and offsets  
- Import DXF files, draw rectangles and circles, and add text on a 2D canvas  
- Arrange, rotate, resize, and set cut depths per object  
- Generate STL and DXF outputs for 3D printing or CAD workflows  
- Built-in 3D viewer for previewing the final model  
- Save and share entire projects as a single `.gsm` file  

---

## 📸 Screenshots & Demo

Below is a demo video — click the thumbnail to open the YouTube demo.

[![Watch the Gridfinity Shadow Maker demo](https://img.youtube.com/vi/Aso7XpVL_yk/maxresdefault.jpg)](https://youtu.be/Aso7XpVL_yk)

<!-- Screenshot thumbnail grid -->
<table align="center">
  <tr>
    <td align="center">
      <img src="assets/images/1%20GSM%20Server%20Dashboard.png" width="220" alt="GSM Server Dashboard">
    </td>
    <td align="center">
      <img src="assets/images/2%20Trace%20Object.png" width="220" alt="Trace Object">
    </td>
  </tr>

  <tr>
    <td align="center" colspan="2">
      <img src="assets/images/3%202D%20Canvas.png" width="460" alt="2D Canvas">
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="assets/images/4%203D%20Viewer.png" width="220" alt="3D Viewer">
    </td>
    <td align="center">
      <img src="assets/images/5%20orcastudio%20example.png" width="220" alt="OrcaSlicer example">
    </td>
  </tr>
</table>


---

## 🟢 Installation (Windows Only)

GSM is designed so **non-technical users can install it easily**.

### ✔ You only need to install:
1. **Python 3.13** (64-bit, Add to PATH)  
   - Python 3.14+ is currently not recommended  
2. **OpenSCAD Nightly Build**  
3. Run the provided **setup.ps1** script  

---

## 1) Install Python 3.13

Download Python 3.13 from https://www.python.org/downloads/ and ensure **Add to PATH** is selected.

Verify the installation:

```powershell
python --version
pip --version
```

---

## 2) Install OpenSCAD Nightly

Download the latest nightly build from:  
https://openscad.org/downloads.html#snapshots

The nightly build is **required**.  
The older stable release relies on CGAL-only rendering, which is significantly slower and not suitable for GSM’s fast manifold-based workflow.

---

## 3) Run the Setup Script

Inside the `scripts` folder, right-click **setup.ps1** and select **Run with PowerShell**.

The setup script will:
- Install Python dependencies  
- Automatically install Node.js if missing  
- Install all frontend dependencies  

---

## 4) Launch Gridfinity Shadow Maker

Double-click **Launch GSM Server.py** in the root folder  
(or right-click → Open with Python).

Click **Launch App** to open GSM in your web browser.

---

## 🚀 Using Gridfinity Shadow Maker

Gridfinity Shadow Maker is designed to follow a simple, linear workflow:
capture → trace → layout → generate → print.

---

### Step 1 — Capture a Photo

1. Open the **Trace Object** tab  
2. Select your camera from the drop-down menu  
3. Place your tool on a light box or high-contrast background  
4. Include the scaling token in the frame (used for accurate sizing)  
5. Name your file and click **Capture Photo**

Captured photos are saved to your project and are ready for editing.

---

### Step 2 — Edit the Photo

After capturing the image:

1. Click **Edit** next to the photo  
2. Crop the image so all four borders are white  
3. Use the brush tool to clean up unwanted areas  
4. Optional: use rectangle or ellipse tools for quick masking  
5. Save the edited image

Clean, high-contrast images produce the best tracing results.

---

### Step 3 — Trace the Object

1. Load the edited photo into the tracer  
2. Adjust the **threshold** and trace settings as needed  
3. Reprocess until the outline looks correct  
4. Click **Transfer to Canvas**

The traced shape is added to the 2D canvas and scaled automatically.

---

### Step 4 — Build the Shadow Board Layout

On the canvas, you can:

- Add **text**  
- Add **basic shapes**  
- Import **DXF files**  
- Move, rotate, and scale items  
- Add **finger slots** or cutouts  
- Adjust **cut depth** for each shape  

This is where the final layout of your shadow board is defined.

---

### Step 5 — Generate the 3D Model

1. Adjust cut depths as needed  
2. Click **Generate STL**  
3. Review the result in the built-in 3D viewer  
4. Download the STL when satisfied

---

### Step 6 — Slice and Print

1. Open the STL in your preferred slicer  
2. Apply color to text and shadow cutouts  
3. Slice and print

Your custom Gridfinity shadow board is complete.


## 👨‍💻 Developer Notes

- Frontend: React + TypeScript + Vite  
- Backend: Node.js + Express  
- Image processing: Python + OpenCV  
- STL export uses OpenSCAD Manifold Mode  

Contributions welcome.

For agent-focused and automation guidance (endpoints, SSE, setup for programmatic access), see [AGENTS.md](AGENTS.md).
