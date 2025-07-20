import cv2
import numpy as np
import math
import ezdxf
import pyperclip
import os
import tempfile
import subprocess
import traceback
import time
import concurrent.futures
from PIL import Image
from PyQt5 import QtWidgets, QtGui  # Import QtGui
from src.ui import Ui_MainWindow  # type: ignore # Import Ui_MainWindow

scad_file_path = None  # Declare scad_file_path as a global variable

def get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry):
    global offset, token, resolution
    threshold_input = validate_input(threshold_entry.text(), 110, 0, 255)
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
        diameter = None  # Initialize diameter
        threshold_input = get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry)
        image, thresh = preprocess_image(image, threshold_input)
        display_image_on_canvas(thresh, canvas, 2, "Traced")
        
        contours = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]

        max_p2d_contour, max_p2d_ratio = find_max_p2d_ratio_contour(contours)
        if max_p2d_contour is not None:
            diameter = calculate_diameter(max_p2d_contour)
            console_text.setText(f"Circle with Greatest Perimeter to Diameter Ratio - Diameter: {diameter}, Ratio: {max_p2d_ratio}")
            filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_p2d_contour)]
            display_contours(image, filtered_contours, canvas, 2, "Traced", (0, 255, 0))  # Green color for traced image
        else:
            console_text.setText("No circle with sufficient perimeter to diameter ratio found.")
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

def find_max_p2d_ratio_contour(contours):
    max_p2d_ratio = 0
    max_p2d_contour = None
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        diameter = calculate_diameter(contour)
        if diameter == 0:
            continue  # Skip this contour if diameter is zero
        p2d_ratio = perimeter / diameter
        #print(f"Contour Perimeter: {perimeter}, Diameter: {diameter}, Ratio: {p2d_ratio}")
        if p2d_ratio > max_p2d_ratio:
            max_p2d_ratio = p2d_ratio
            max_p2d_contour = contour
    return max_p2d_contour, max_p2d_ratio

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

        max_p2d_contour, max_p2d_ratio = find_max_p2d_ratio_contour(contours)
        filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_p2d_contour)]
        display_contours(image, filtered_contours, canvas, 3, "Offset", (255, 0, 0))  # Blue color for filtered contours

        if max_p2d_contour is not None:
            diameter = calculate_diameter(max_p2d_contour)
            console_text.setText(f"Circle with Greatest Perimeter to Diameter Ratio - Diameter: {diameter}, Ratio: {max_p2d_ratio}")
        else:
            console_text.setText("No circle with sufficient perimeter to diameter ratio found.")

        return contours, image
    except Exception as e:
        console_text.setText(f"Error finding contours: {str(e)}")
        print(traceback.format_exc())
        return None, None

def save_dxf_file(doc, file_name, folder_name):
    script_directory = os.path.dirname(os.path.abspath(__file__))
    design_files_directory = os.path.join(script_directory, "..", folder_name)
    os.makedirs(design_files_directory, exist_ok=True)
    output_path = os.path.join(design_files_directory, file_name + ".dxf")
    doc.saveas(output_path)
    return file_name + ".dxf"

def save_contours_as_dxf(contours, file_name, scale_factor, console_text, folder_name, splitDXF=False):
    try:
        max_p2d_contour, max_p2d_ratio = find_max_p2d_ratio_contour(contours)
        if max_p2d_contour is None:
            console_text.setText("No valid contours found.")
            return None, None, None

        filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_p2d_contour)]
        # Filter out small contours (area < 1000)
        filtered_contours = [contour for contour in filtered_contours if cv2.contourArea(contour) >= 1000]
        if not filtered_contours:
            console_text.setText("No valid contours found after filtering.")
            return None, None, None
        pos_xy = []
        for contour in filtered_contours:
            all_points = np.vstack(contour.reshape(-1, 2))
            min_x, min_y = np.min(all_points, axis=0)
            max_x, max_y = np.max(all_points, axis=0)
            center_y = round((min_x + max_x) / 2 ,1)
            center_x = round((min_y + max_y) / 2 ,1)
            pos_xy.append([center_x, center_y])

        # Calculate the bounding box for the remaining contours (for consistent origin)
        all_points = np.vstack([contour.reshape(-1, 2) for contour in filtered_contours])
        min_x, min_y = np.min(all_points, axis=0)
        max_x, max_y = np.max(all_points, axis=0)
        abs_center_x = (min_x + max_x) / 2
        abs_center_y = (min_y + max_y) / 2
        offset_pos_xy = []
        for contour in filtered_contours:
            all_points = np.vstack(contour.reshape(-1, 2))
            min_x, min_y = np.min(all_points, axis=0)
            max_x, max_y = np.max(all_points, axis=0)
            center_y = round(((min_x + max_x) / 2 - abs_center_x) * scale_factor * 25.4,1)
            center_x = round(((min_y + max_y) / 2 - abs_center_y) * scale_factor * 25.4,1)
            offset_pos_xy.append([center_x, center_y])
        # Save offset_pos_xy to a temp file for use in import_to_openscad
        try:
            import pickle
            temp_centers_path = os.path.join(os.path.dirname(__file__), '..', 'offset_pos_xy.pkl')
            with open(temp_centers_path, 'wb') as f:
                pickle.dump(offset_pos_xy, f)
        except Exception as e:
            print(f"Warning: Could not save offset_pos_xy for OpenSCAD import: {e}")
        if splitDXF:
            output_paths = []
            with concurrent.futures.ThreadPoolExecutor() as executor:
                futures = [
                    executor.submit(save_single_dxf, contour, scale_factor, pos_xy[idx], file_name, idx, folder_name)
                    for idx, contour in enumerate(filtered_contours)
                ]
                for future in concurrent.futures.as_completed(futures):
                    output_paths.append(future.result())
            gridx_size, gridy_size = calculate_grid_size(filtered_contours, scale_factor)
            console_text.setText(f"Saved {len(output_paths)} DXF files: {output_paths}")
            return output_paths, gridx_size, gridy_size
        else:
            doc = ezdxf.new()
            msp = doc.modelspace()
            for contour in filtered_contours:
                points = [(point[0][1] * scale_factor - center_y * scale_factor, point[0][0] * scale_factor - center_x * scale_factor) for point in contour]
                if points[0] != points[-1]:
                    points.append((points[0][0], points[0][1]))
                msp.add_lwpolyline(points)
            output_path = save_dxf_file(doc, file_name, folder_name)
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

def select_image(console_text, default_dir=None):
    try:
        file_dialog = QtWidgets.QFileDialog()
        # Use default_dir if provided, otherwise use ""
        start_dir = default_dir if default_dir is not None else ""
        file_path, _ = file_dialog.getOpenFileName(
            None, "Select Image", start_dir, "Image files (*.jpg;*.jpeg;*.png;*.bmp)"
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

def import_to_openscad(dxf_path, gridx_size, gridy_size, console_text, file_name, folder_name, splitDXF=False):
    try:
        global scad_file_path  # Use the global variable to keep track of the SCAD file
        scad_template_path = os.path.join(os.path.dirname(__file__), "..", "Step 2 DXF to STL.scad")
        with open(scad_template_path, 'r') as file:
            scad_content = file.read()
        
        # Use forward slashes for the file path(s)
        if splitDXF and isinstance(dxf_path, list):
            dxf_file_paths = [p.replace("\\", "/") for p in dxf_path]
            # Sort dxf_file_paths by contour index in filename (e.g., *_contour_1.dxf, *_contour_2.dxf, ...)
            import re
            def contour_index(path):
                # Match _contour_N.dxf at the end of the filename, regardless of path separator
                m = re.search(r'_contour_(\d+)\.dxf$', os.path.basename(path))
                return int(m.group(1)) if m else 0
            dxf_file_paths.sort(key=contour_index)
            dxf_paths_scad = 'dxf_file_paths = [\n' + ',\n'.join([f'"{p}"' for p in dxf_file_paths]) + '\n];\n'
            # Split dxf_cut_depths into arrays of max size 4
            cut_depths = ["10"] * len(dxf_file_paths)
            cut_depth_arrays = [cut_depths[i:i+4] for i in range(0, len(cut_depths), 4)]
            dxf_cut_depths_scad = ""
            concat_line = ""
            if len(cut_depth_arrays) == 1:
                dxf_cut_depths_scad = f'dxf_cut_depths = [{", ".join(cut_depth_arrays[0])}];\n'
            else:
                array_names = []
                for idx, arr in enumerate(cut_depth_arrays):
                    name = f'dxf_cut_depths_{idx+1}'
                    array_names.append(name)
                    dxf_cut_depths_scad += f'{name} = [{", ".join(arr)}];\n'
                concat_line = f'dxf_cut_depths = concat({", ".join(array_names)});\n'

            # Generate section_cut_depth_N and section_parameters_N arrays, then concatenate
            section_cut_depth_names = []
            section_param_names = []
            section_blocks = []
            for idx in range(len(dxf_file_paths)):
                cut_name = f'section_cut_depth_{idx+1}'
                param_name = f'section_parameters_{idx+1}'
                section_cut_depth_names.append(cut_name)
                section_param_names.append(param_name)
                section_blocks.append(f'{cut_name} = [20, 15, 10];\n{param_name} = [40, 0, 0];')
            section_cut_depth_concat = f'section_cut_depth = [{', '.join(section_cut_depth_names)}];\n'
            section_parameters_concat = f'section_parameters = [{', '.join(section_param_names)}];\n'

            # Generate position_1, position_2, ... and position array using pos_xy from temp file
            pos_xy = None
            try:
                import pickle
                temp_centers_path = os.path.join(os.path.dirname(__file__), '..', 'offset_pos_xy.pkl')
                if os.path.exists(temp_centers_path):
                    with open(temp_centers_path, 'rb') as f:
                        pos_xy = pickle.load(f)
            except Exception:
                pass
            if not pos_xy or len(pos_xy) != len(dxf_file_paths):
                # fallback: zeros
                pos_xy = [[0,0] for _ in range(len(dxf_file_paths))]
            position_lines = []
            for idx in range(len(dxf_file_paths)):
                position_lines.append(f'position_{idx+1} = [{pos_xy[idx][0]:.6f},{pos_xy[idx][1]:.6f},0]; // .1')
            position_array = f'position = [{', '.join([f"position_{i+1}" for i in range(len(dxf_file_paths))])}];\n'
            # Replace the position = [[0, 0, 0]]; // .1 line
            updated_scad_content = scad_content.replace('position = [[0, 0, 0]]; // .1', '\n'.join(position_lines) + '\n' + position_array)

            # Insert all blocks inside /* [Section Adjustments] */ in the requested order
            scad_block = dxf_paths_scad + dxf_cut_depths_scad + concat_line + '// dxf_file_path replaced by dxf_file_paths'
            updated_scad_content = updated_scad_content.replace(
                'dxf_file_path = "examples/example.dxf";',
                scad_block
            )

            section_marker = '/* [Section Adjustments] */'
            if section_marker in updated_scad_content:
                parts = updated_scad_content.split(section_marker, 1)
                # Always keep use_section_cut as the first line after the marker
                after_marker = parts[1]
                # Remove any old section_cut_depth/section_parameters lines (optional, for cleanliness)
                # Compose the new block
                new_block = '\nuse_section_cut = false; // true or false\n'
                for block in section_blocks:
                    new_block += block + '\n'
                new_block += section_cut_depth_concat + section_parameters_concat
                updated_scad_content = parts[0] + section_marker + new_block + after_marker
        else:
            dxf_path = dxf_path.replace("\\", "/")
            updated_scad_content = scad_content.replace('dxf_file_path = "examples/example.dxf";', f'dxf_file_path = "{dxf_path}";')
        
        # Determine slot rotation and width based on gridx_size and gridy_size
        slot_rotation = 0 if gridx_size > gridy_size else 90
        slot_width = 80 if min(gridx_size, gridy_size) > 2 else 40
        updated_scad_content = updated_scad_content.replace('size = [5, 2, 6];', f'size = [{gridx_size}, {gridy_size}, 6];')
        updated_scad_content = updated_scad_content.replace('slot_rotation = 90;', f'slot_rotation = {slot_rotation};')
        updated_scad_content = updated_scad_content.replace('slot_width = 40;', f'slot_width = {slot_width};')
        updated_scad_content = updated_scad_content.replace('multiple_dxf = false;', f'multiple_dxf = {str(splitDXF).lower()};')

        # Save the SCAD file in the folder specified by folder_name
        script_directory = os.path.dirname(os.path.abspath(__file__))
        design_files_directory = os.path.join(script_directory, "..", folder_name)
        os.makedirs(design_files_directory, exist_ok=True)
        scad_file_path = os.path.join(design_files_directory, f"{file_name}.scad")
        with open(scad_file_path, 'w') as scad_file:
            scad_file.write(updated_scad_content)
        
        # Paths to possible OpenSCAD executables
        openscad_paths = [
            "C:/Program Files/OpenSCAD/openscad.exe",
            "C:/Program Files/OpenSCAD (Nightly)/openscad.exe"
        ]
        
        # Find the first valid OpenSCAD executable
        openscad_executable = next((path for path in openscad_paths if os.path.exists(path)), None)
        if not openscad_executable:
            console_text.setText("Error: OpenSCAD executable not found in expected directories.")
            return
        
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

def save_single_dxf(contour, scale_factor, pos_xy, file_name, idx, folder_name):
    center_y, center_x = pos_xy
    doc = ezdxf.new()
    msp = doc.modelspace()
    points = [
        (point[0][1] * scale_factor - center_y * scale_factor
         , point[0][0] * scale_factor - center_x * scale_factor
         ) for point in contour]
    if points[0] != points[-1]:
        points.append((points[0][0], points[0][1]))
    msp.add_lwpolyline(points)
    single_name = f"{file_name}_contour_{idx+1}"
    output_path = save_dxf_file(doc, single_name, folder_name)
    return output_path
