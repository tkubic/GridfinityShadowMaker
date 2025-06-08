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
3. General description of settings:
   - **Threshold Input**: This helps with edge detection. Images should have high contrast of edges to background
   - **Offset**: offset in inches from traced image
   - **Token Size**: used for a scale reference
     
### Step 3: Create the 3D Model
1. The OpenSCAD file can be opened directly from the Step 1 Python user interface.
2. In the customizer, you can modify various settings:
   - **General Settings**: Adjust `gridx`, `gridy`, and `gridz` to match the size of your desired shadow board.
   - **Finger Slot Options**: Customize the size, angle, and position of the finger slots.
   - **Cut Depth**: Set the depth for the cuts.
3. **Render and Export**:
   - Click the "Render" button (F6) to render the model.
   - Once rendered, click "Export" to save the STL file.

### Step 4: Color, add Text, and Print
1. Open **OrcaSlicer** or **Bambu Studio** to generate the gcode for the printer. A .3mf template is available in the repository with preferred printer settings.
2. Add text (hotkey "t"). Preferred Font = "Arial Rounded MT Bold", Height = 12mm. Smaller text height must use smaller nozzles on the printer.
3. Use the color painting feature (hotkey "n") to fill the outline with a color that pops, like red. Standard colors used are:
   - **Black** for the main print
   - **Red** for the tool outline
   - **White** for the text/trim
4. If large shadow boards are being created you may need to cut (hotkey "c") the board into smaller pieces. Preferred method is to use dovetails 

## Video Tutorial 🎥
Want a walkthrough of the process? Check out the YouTube tutorial for a step-by-step guide!
[![Watch the tutorial](https://img.youtube.com/vi/K45Y8rKlYDY/0.jpg)](https://www.youtube.com/watch?v=K45Y8rKlYDY)

## Setting Up for the First Time

### Prerequisites
#### **This repository**:
Clone or download a copy of this repository. You can click the green "Code" button above and select "Download ZIP"
#### **OpenSCAD**: 
Download and install the latest nightly version of OpenSCAD from [OpenSCAD Nightly Builds](https://openscad.org/downloads.html#snapshots).
#### **OrcaSlicer or Bambu Studio**: 
Download and install either OrcaSlicer from [OrcaSlicer releases](https://github.com/SoftFever/OrcaSlicer/releases) or Bambu Studio from [Bambu Studio](https://bambulab.com/en/download/studio).

#### **Python**: 
1. **Setup Python**:
   - Download and install the latest version of Python from [python.org](https://www.python.org/). Ensure to add Python to your system PATH.
2. **Install Dependencies**:
   - Use the following command from a terminal or command prompt to install the required dependencies:
     ```sh
     pip install PyQt5 opencv_python pillow colorama ezdxf fonttools iniconfig numpy opencv-python packaging pillow pip pluggy pyparsing pyperclip pytest typing_extensions
     ```


## Credits
This project uses code from [ostat's gridfinity-extended-openscad](https://github.com/ostat/gridfinity_extended_openscad) project for creating the Gridfinity base bins.
