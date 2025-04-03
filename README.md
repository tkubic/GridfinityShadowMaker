# Gridfinity-ShadowBoards

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

## Instructions

### Prerequisites
- **Python**: Make sure you have Python installed on your PC. If not, download and install the latest version from [python.org](https://www.python.org/). Ensure to add Python to your system PATH during installation, then install the dependencies shown at the bottom of this page.
- **OpenSCAD**: Download and install the latest nightly version of OpenSCAD from [OpenSCAD Nightly Builds](https://openscad.org/downloads.html#snapshots).
- **OrcaSlicer or Bambu Studio**: Download and install either OrcaSlicer from [OrcaSlicer releases](https://github.com/SoftFever/OrcaSlicer/releases) or Bambu Studio from [Bambu Studio](https://bambulab.com/en/download/studio).

### Preparing Your Photos
1. **Take Photos**: Use a lightboard to take photos of your tools or components. Ensure to include a 2" disc in the photo for scale reference (the STL file for the disc can be found in the `STL` folder). For the lightbox, I used a 2 ft x 2 ft LED panel ceiling light fixture. An example from Menards is model number GT-FP-22BLP. I also wired a switch to this and an extension cord to plug it into an outlet. Based on your ambient lighting conditions, you will need to fine-tune your Threshold Input value.
2. **Example Images**: An example image taken on a lightbox is located in the `Pictures/examples` folder. 
   These settings will yield an image like the one shown above.
3. **Crop Photos**: Ensure the borders of the photos are all white.
4. **Touch-Up Photos**: Edit the photos as needed to create the shape you want to outline.

### Step-by-Step Guide

#### Step 1: Create DXF Files
Run the provided Python script to create your DXF files. This script will also copy the file path of the generated DXF to your clipboard.
General description of settings:
   - **Threshold Input**: This helps with edge detection. Images should have high contrast of edges to background
   - **Offset**: offset in inches from traced image
   - **Token Size**: used for a scale reference
#### Step 2: Generate STL Files with OpenSCAD
1. The OpenSCAD file can be opened direclty from the Step 1 python file. this will prepopulate DXF path and estimated size for the board
2. In the customizer you can modify many things. Most common are in general settings, finger slot, and cut depth
3. **General Settings**:
   - Adjust `gridx`, `gridy`, and `gridz` to match the size of your desired shadow board.
4. **Finger Slot Options**:
   - Customize the size, angle, and position of the finger slots.
5. **Cut Depth**:
   - Set the depth for the cuts.
6. **Render and Export**:
   - Click the "Render" button (F6) to render the model.
   - Once rendered, click "Export" to save the STL file.

#### Step 3: Slice the File
1. Open **OrcaSlicer** or **Bambu Studio** to add any text and slice the STL file.
2. Use the color painting feature to fill the outline with a color that pops, like red. Add a nice trim to the top using the layer height. Standard colors used are:
   - **Black** for the main print
   - **Red** for the tool outline
   - **White** for the text/trim
3. A template is available in the repository for this step.

## Setting Up for the First Time
1. **Setup Python**:
   - Download and install the latest version of Python from [python.org](https://www.python.org/). Ensure to add Python to your system PATH.
2. **Install Dependencies**:
   - You can either run the `install_extensions.bat` file or use the following command to install the required dependencies:
     ```sh
     pip install PyQt5 opencv_python pillow colorama ezdxf fonttools iniconfig numpy opencv-python packaging pillow pip pluggy pyparsing pyperclip pytest typing_extensions
     ```

## Credits
This project uses code from [kennetek's gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) project for creating the Gridfinity base bins.

---

Feel free to modify or expand upon these instructions based on your specific needs. Happy creating!
