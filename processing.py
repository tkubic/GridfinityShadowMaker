import cv2
import numpy as np
import math
import ezdxf
import pyperclip
import os
import tempfile
import subprocess
import traceback
from PIL import Image
from PyQt5 import QtWidgets, QtGui  # Import QtGui
from ui import Ui_MainWindow  # Import Ui_MainWindow

scad_file_path = None  # Declare scad_file_path as a global variable

def get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry):
    global offset, token, resolution
    threshold_input = validate_input(threshold_entry.text(), 145, 0, 255)
    offset = validate_input(offset_entry.text(), 0.1)
    token = validate_input(token_entry.text(), 2.000)
    resolution = validate_input(resolution_entry.text(), 10)
    return threshold_input

def validate_input(value, default, min_val=None, max_val=None):
    try:
        value = float(value)
        if min_val is not None and value < min_val:
            value = min_val
        if max_val is not None and value > max_val:
            value = max_val
    except ValueError:
        value = default
    return value

def clear_canvas(canvas, keep_original=False):
    try:
        canvas.scene().clear()
        if keep_original and hasattr(canvas, 'image1'):
            canvas.scene().addPixmap(canvas.image1).setPos(0, 0)
            canvas.scene().addText("Original", QtGui.QFont("Helvetica", 16)).setPos(canvas.width() // 6, 5)
        canvas.update()
    except Exception as e:
        print(f"Error clearing canvas: {str(e)}")
        print(traceback.format_exc())

def find_diameter(image, canvas, threshold_entry, offset_entry, token_entry, resolution_entry, console_text):
    try:
        threshold_input = get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry)
        image, thresh = preprocess_image(image, threshold_input)
        display_image_on_canvas(thresh, canvas, 2, "Traced")
        
        contours = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]

        max_circularity_contour, max_circularity = find_max_circularity_contour(contours)
        if max_circularity_contour is not None:
            diameter = calculate_diameter(max_circularity_contour)
            console_text.setText(f"Circle with Greatest Circularity - Diameter: {diameter}, Circularity: {max_circularity}")
            filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_circularity_contour)]
            display_contours(image, filtered_contours, canvas, 2, "Traced", (0, 255, 0))  # Green color for traced image
        else:
            console_text.setText("No circle with sufficient circularity found.")
        return diameter, threshold_input
    except Exception as e:
        console_text.setText(f"Error finding diameter: {str(e)}")
        print(traceback.format_exc())
        return None, None

def preprocess_image(image, threshold_input):
    if isinstance(image, str):
        image = cv2.imread(image)
    imgray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ret, thresh = cv2.threshold(imgray, threshold_input, 255, cv2.THRESH_BINARY)
    thresh = cv2.bitwise_not(thresh)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    return image, thresh

def display_contours(image, contours, canvas, region, caption, color):
    contours_img = image.copy()
    # Determine the thickness based on the image size
    thickness = max(1, min(image.shape[0], image.shape[1]) // 200)
    cv2.drawContours(contours_img, contours, -1, color, thickness)
    display_image_on_canvas(contours_img, canvas, region, caption)

def find_max_circularity_contour(contours):
    max_circularity = 0
    max_circularity_contour = None
    for contour in contours:
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue  # Skip this contour if perimeter is zero
        circularity = (4 * np.pi * area) / (perimeter * perimeter)
        if circularity > max_circularity:
            max_circularity = circularity
            max_circularity_contour = contour
    return max_circularity_contour, max_circularity

def calculate_diameter(contour):
    (x, y), radius = cv2.minEnclosingCircle(contour)
    return 2 * radius

def find_contours(image, diameter, threshold_input, canvas, console_text):
    try:
        image, thresh = preprocess_image(image, threshold_input)
        kernel_size = math.ceil(diameter / (token / offset) * 2)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        thresh = cv2.dilate(thresh, kernel)
        epsilon = kernel_size / resolution

        contours_tuple = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
        contours = [cv2.approxPolyDP(contour, epsilon, True) for contour in contours_tuple]

        max_circularity_contour, max_circularity = find_max_circularity_contour(contours)
        filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_circularity_contour)]
        display_contours(image, filtered_contours, canvas, 3, "Filtered Contours", (255, 0, 0))  # Blue color for filtered contours

        if max_circularity_contour is not None:
            diameter = calculate_diameter(max_circularity_contour)
            console_text.setText(f"Circle with Greatest Circularity - Diameter: {diameter}, Circularity: {max_circularity}")
        else:
            console_text.setText("No circle with sufficient circularity found.")

        return contours, image
    except Exception as e:
        console_text.setText(f"Error finding contours: {str(e)}")
        print(traceback.format_exc())
        return None, None

def save_contours_as_dxf(contours, file_name, scale_factor, console_text):
    try:
        max_circularity_contour, max_circularity = find_max_circularity_contour(contours)
        if max_circularity_contour is None:
            console_text.setText("No valid contours found.")
            return None, None, None
        doc = ezdxf.new()
        msp = doc.modelspace()

        filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_circularity_contour)]
        
        if not filtered_contours:
            console_text.setText("No valid contours found after filtering.")
            return None, None, None

        # Calculate the bounding box for the remaining contours
        all_points = np.vstack([contour.reshape(-1, 2) for contour in filtered_contours])
        min_x, min_y = np.min(all_points, axis=0)
        max_x, max_y = np.max(all_points, axis=0)
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2

        for contour in filtered_contours:
            points = [(point[0][1] * scale_factor - center_y * scale_factor, point[0][0] * scale_factor - center_x * scale_factor) for point in contour]
            if points[0] != points[-1]:
                points.append((points[0][0], points[0][1]))
            polyline = msp.add_lwpolyline(points)
            
        output_path = save_dxf_file(doc, file_name)
        gridx_size, gridy_size = calculate_grid_size(filtered_contours, scale_factor)
        pyperclip.copy(output_path)
        console_text.setText(f"File saved successfully: {output_path}\nFile path '{output_path}' copied to clipboard.\nGrid X Size: {gridx_size}, Grid Y Size: {gridy_size}")
        return output_path, gridx_size, gridy_size
    except Exception as e:
        console_text.setText(f"Error saving DXF: {str(e)}")
        print(traceback.format_exc())
        return None, None, None

def calculate_grid_size(contours, scale_factor):
    all_points = np.vstack([contour.reshape(-1, 2) for contour in contours])
    min_x, min_y = np.min(all_points, axis=0)
    max_x, max_y = np.max(all_points, axis=0)
    x_size = max_x - min_x
    y_size = max_y - min_y
    gridy_size = math.ceil(x_size / 42 * scale_factor * 25.4)
    gridx_size = math.ceil(y_size / 42 * scale_factor * 25.4)
    return gridx_size, gridy_size

def save_dxf_file(doc, file_name):
    script_directory = os.path.dirname(os.path.abspath(__file__))
    dxf_directory = os.path.join(script_directory, "DXF")
    os.makedirs(dxf_directory, exist_ok=True)
    output_path = os.path.join(dxf_directory, file_name + ".dxf")
    doc.saveas(output_path)
    return output_path

def select_image(console_text):
    try:
        file_dialog = QtWidgets.QFileDialog()
        file_path, _ = file_dialog.getOpenFileName(
            None, "Select Image", "", "Image files (*.jpg;*.jpeg;*.png;*.bmp)"
        )
        if file_path:
            print(f"Selected file: {file_path}")
        else:
            print("No file selected.")
        file_name, file_extension = os.path.splitext(os.path.basename(file_path))
        return file_path, file_name
    except Exception as e:
        console_text.setText(f"Error selecting image: {str(e)}")
        print(traceback.format_exc())
        return None, None

def import_to_openscad(dxf_path, gridx_size, gridy_size, console_text, file_name):
    try:
        global scad_file_path  # Use the global variable to keep track of the SCAD file
        scad_template_path = "Step 2 DXF to STL.scad"
        with open(scad_template_path, 'r') as file:
            scad_content = file.read()
        
        # Use forward slashes for the file path
        dxf_path = dxf_path.replace("\\", "/")
        
        # Determine slot rotation and width based on gridx_size and gridy_size
        slot_rotation = 0 if gridx_size > gridy_size else 90
        slot_width = 80 if min(gridx_size, gridy_size) > 2 else 40
                
        updated_scad_content = scad_content.replace('dxf_file_path = "DXF/example.dxf";', f'dxf_file_path = "{dxf_path}";')
        updated_scad_content = updated_scad_content.replace('gridx = 5;', f'gridx = {gridx_size};')
        updated_scad_content = updated_scad_content.replace('gridy = 2;', f'gridy = {gridy_size};')
        updated_scad_content = updated_scad_content.replace('slot_rotation = 90;', f'slot_rotation = {slot_rotation};')
        updated_scad_content = updated_scad_content.replace('slot_width = 40;', f'slot_width = {slot_width};')
        updated_scad_content = updated_scad_content.replace('use <src/core/gridfinity-rebuilt-utility.scad>', 'use <../src/core/gridfinity-rebuilt-utility.scad>')
        updated_scad_content = updated_scad_content.replace('use <src/core/gridfinity-rebuilt-holes.scad>', 'use <../src/core/gridfinity-rebuilt-holes.scad>')
        
        # Save the SCAD file in the "Pictures" folder within the same directory as the script
        script_directory = os.path.dirname(os.path.abspath(__file__))
        pictures_directory = os.path.join(script_directory, "Pictures")
        os.makedirs(pictures_directory, exist_ok=True)
        scad_file_path = os.path.join(pictures_directory, f"{file_name}.scad")
        with open(scad_file_path, 'w') as scad_file:
            scad_file.write(updated_scad_content)
        
        # Path to the OpenSCAD executable
        openscad_executable = "C:/Program Files/OpenSCAD/openscad.exe"
        
        # Open the SCAD file with OpenSCAD
        subprocess.Popen([openscad_executable, scad_file_path])
    except Exception as e:
        console_text.setText(f"Error importing to OpenSCAD: {str(e)}")
        print(traceback.format_exc())

def exit_application(console_text):
    try:
        global scad_file_path  # Use the global variable to keep track of the SCAD file
        QtWidgets.QApplication.quit()
    except Exception as e:
        console_text.setText(f"Error exiting application: {str(e)}")
        print(traceback.format_exc())

def create_main_window():
    MainWindow = QtWidgets.QMainWindow()
    ui = Ui_MainWindow()
    ui.setupUi(MainWindow)
    
    canvas = ui.canvas
    canvas.setScene(QtWidgets.QGraphicsScene())
    
    return (MainWindow, canvas, ui.load_button, ui.process_button, ui.import_button, 
            ui.exit_button, ui.threshold_entry, ui.offset_entry, ui.token_entry, 
            ui.resolution_entry, ui.console_text)

def display_image_on_canvas(image, canvas, region, caption):
    try:
        img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(img)
        
        # Resize the image to fit 1/3 of the horizontal screen while maintaining aspect ratio
        canvas_width = canvas.width() // 3
        canvas_height = canvas.height() - 50
        
        # Calculate the scaling factor to maintain aspect ratio
        scale_factor = min(canvas_width / img.width, canvas_height / img.height)
        new_width = int(img.width * scale_factor)
        new_height = int(img.height * scale_factor)
        
        img = img.resize((new_width, new_height), Image.LANCZOS)
        
        # Convert the image to QImage
        img_data = img.tobytes()
        bytes_per_line = new_width * 3
        qimage = QtGui.QImage(img_data, new_width, new_height, bytes_per_line, QtGui.QImage.Format_RGB888)
        pixmap = QtGui.QPixmap.fromImage(qimage)
        
        if region == 1:
            x_offset = canvas.width() // 6
            canvas.image1 = pixmap
        elif region == 2:
            x_offset = canvas_width
            canvas.image2 = pixmap
        elif region == 3:
            x_offset = 2 * canvas_width
            canvas.image3 = pixmap
        canvas.scene().addPixmap(pixmap).setPos(x_offset, 0)
        canvas.scene().addText(caption, QtGui.QFont("Helvetica", 16)).setPos(x_offset + canvas_width // 2, 5)
        
        # Update the canvas
        canvas.update()
    except Exception as e:
        print(f"Error displaying image on canvas: {str(e)}")
        print(traceback.format_exc())
