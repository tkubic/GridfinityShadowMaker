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
# Prefer package-style import, but allow running this module as a script
# by adjusting sys.path when the package root isn't on sys.path.
try:
    from src.ui import Ui_MainWindow  # type: ignore # Import Ui_MainWindow
except Exception:
    import sys
    import pathlib
    # Insert repo root (parent of this file's directory) so `src` package is importable
    repo_root = str(pathlib.Path(__file__).resolve().parent.parent)
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)
    from src.ui import Ui_MainWindow  # type: ignore # try again

scad_file_path = None  # Declare scad_file_path as a global variable

def get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry):
    global offset, token, resolution
    # Defaults: threshold 145, offset 0.1 (inches), token 3.0 (inches), resolution 20
    threshold_input = validate_input(threshold_entry.text(), 145, 0, 255)
    offset = validate_input(offset_entry.text(), 0.1)
    token = validate_input(token_entry.text(), 3.000)
    resolution = validate_input(resolution_entry.text(), 20)
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

def save_contours_as_dxf(contours, file_name, scale_factor, console_text, folder_name, splitDXF=True, write_dxfs=True):
    try:
        max_p2d_contour, max_p2d_ratio = find_max_p2d_ratio_contour(contours)
        if max_p2d_contour is None:
            console_text.setText("No valid contours found.")
            return None, None, None, [], []

        filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_p2d_contour)]
        # Filter out small contours (area < 1000)
        filtered_contours = [contour for contour in filtered_contours if cv2.contourArea(contour) >= 1000]
        if not filtered_contours:
            console_text.setText("No valid contours found after filtering.")
            return None, None, None, [], []
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
        # Historically this function wrote a pickle file used by import_to_openscad.
        # That stateful approach is fragile for server deployments. Instead,
        # return `offset_pos_xy` to the caller so it can be included in the
        # per-run `meta.json`. Keep a silent fallback rather than writing a file.
        # If caller requested not to write DXF files, skip writing and
        # just return grid sizes and filtered contours for in-memory use.
        if not write_dxfs:
            gridx_size, gridy_size = calculate_grid_size(filtered_contours, scale_factor)
            console_text.setText(f"Prepared {len(filtered_contours)} filtered contours (DXF write disabled)")
            return None, gridx_size, gridy_size, filtered_contours, offset_pos_xy

        if splitDXF:
            # Build pairs of (contour, pos) where pos corresponds to the
            # per-contour center computed earlier. Then sort left-to-right by
            # the contour centroid x coordinate (image column), and save in
            # that sorted order to ensure deterministic DXF file ordering.
            contour_pairs = []

            for idx, contour in enumerate(filtered_contours):
                try:
                    pts = contour.reshape(-1, 2)
                    # Use the second coordinate as Y (row) for centroid_y
                    centroid_y = float(np.mean(pts[:, 1]))
                except Exception:
                    # Fallback: use previously computed pos_xy y value
                    centroid_y = float(pos_xy[idx][1]) if idx < len(pos_xy) else float(idx)
                contour_pairs.append((contour, pos_xy[idx] if idx < len(pos_xy) else [0, 0], centroid_y))

            # Sort by centroid y (top to bottom)
            contour_pairs.sort(key=lambda t: t[2])

            output_paths = []
            for out_idx, (contour, pos, _) in enumerate(contour_pairs):
                # Use sequential numbering in the saved filename (1-based)
                try:
                    saved = save_single_dxf(contour, scale_factor, pos, file_name, out_idx, folder_name)
                    output_paths.append(saved)
                except Exception as e:
                    print('Warning: failed to save single DXF:', e)

            gridx_size, gridy_size = calculate_grid_size(filtered_contours, scale_factor)
            console_text.setText(f"Saved {len(output_paths)} DXF files: {output_paths}")
            return output_paths, gridx_size, gridy_size, filtered_contours, offset_pos_xy
        else:
            doc = ezdxf.new()
            msp = doc.modelspace()
            for contour in filtered_contours:
                # Preserve absolute coordinates from the contour. Do not recenter
                # by subtracting per-contour centers — write points as absolute
                # pixel positions scaled by `scale_factor` so the DXF reflects
                # their true positions in image space.
                points = [(point[0][1] * scale_factor, point[0][0] * scale_factor) for point in contour]
                if points[0] != points[-1]:
                    points.append((points[0][0], points[0][1]))
                msp.add_lwpolyline(points)
            output_path = save_dxf_file(doc, file_name, folder_name)
            gridx_size, gridy_size = calculate_grid_size(filtered_contours, scale_factor)
            pyperclip.copy(output_path)
            console_text.setText(f"File saved successfully: {output_path}\nFile path '{output_path}' copied to clipboard.\nGrid X Size: {gridx_size}, Grid Y Size: {gridy_size}")
            return output_path, gridx_size, gridy_size, filtered_contours, offset_pos_xy
    except Exception as e:
        console_text.setText(f"Error saving DXF: {str(e)}")
        print(traceback.format_exc())
        return None, None, None, [], []

def calculate_grid_size(contours, scale_factor):
    all_points = np.vstack([contour.reshape(-1, 2) for contour in contours])
    min_x, min_y = np.min(all_points, axis=0)
    max_x, max_y = np.max(all_points, axis=0)
    x_size = max_x - min_x
    y_size = max_y - min_y
    # x_size corresponds to image width (columns) -> gridX (width)
    # y_size corresponds to image height (rows)   -> gridY (depth)
    gridx_size = math.ceil(x_size / 42 * scale_factor)
    gridy_size = math.ceil(y_size / 42 * scale_factor)
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

def import_to_openscad(dxf_path, gridx_size, gridy_size, console_text, file_name, folder_name, splitDXF=False, gridz_size=None):
    try:
        global scad_file_path  # Use the global variable to keep track of the SCAD file
        scad_template_path = os.path.join(os.path.dirname(__file__), "..", "template.scad")
        with open(scad_template_path, 'r') as file:
            scad_content = file.read()
        # Work on a mutable copy so all replacements consistently update
        # the same variable regardless of the control flow below.
        updated_scad_content = scad_content
        
        # Determine project folder (design_files_directory) early so the GSM
        # lookup and other file operations can reference it.
        script_directory = os.path.dirname(os.path.abspath(__file__))
        design_files_directory = os.path.join(script_directory, "..", folder_name)

        # Normalize into a list so the replacement logic runs for single DXFs too
        # (callers historically passed a single string with splitDXF=False).
        if not (splitDXF and isinstance(dxf_path, list)):
            splitDXF = True
            dxf_path = [dxf_path]

        # Use forward slashes for the file path(s)
        if splitDXF and isinstance(dxf_path, list):
            # Convert absolute paths to project-relative paths (processing_output/...) when possible
            raw_paths = list(dxf_path)
            dxf_file_paths = []
            for p in raw_paths:
                if not p:
                    continue
                # normalize
                pp = os.path.normpath(p)
                # If path is inside project folder, make it relative to project folder so SCAD uses relative path
                try:
                    if os.path.isabs(pp) and pp.startswith(os.path.normpath(design_files_directory)):
                        rel = os.path.relpath(pp, design_files_directory).replace('\\', '/')
                        dxf_file_paths.append(rel)
                    else:
                        # keep basename under processing_output if it's just a filename
                        if os.path.isabs(pp):
                            dxf_file_paths.append(pp.replace('\\', '/'))
                        else:
                            dxf_file_paths.append(pp.replace('\\', '/'))
                except Exception:
                    dxf_file_paths.append(pp.replace('\\', '/'))
            # Preserve the incoming order from the caller (usually the GSM-derived ordering)
            # Do not reorder by contour index; the caller controls ordering.
            # (Previous behavior sorted by contour index which broke GSM ordering.)
            dxf_paths_scad = 'dxf_file_paths = [\n' + ',\n'.join([f'"{p}"' for p in dxf_file_paths]) + '\n];\n'
            # Deduplicate common autogenerated names: if both `shape_N` and
            # a more-descriptive `Trace-N` (or other explicit name) exist,
            # prefer the descriptive name and drop the `shape_N` entry so
            # downstream SCAD does not include duplicate shapes.
            try:
                import re as _re
                basemap = {os.path.splitext(os.path.basename(p))[0]: p for p in dxf_file_paths if p}
                to_remove = set()
                for base in list(basemap.keys()):
                    m = _re.match(r'^shape[_-]?(\d+)$', base, _re.IGNORECASE)
                    if m:
                        idx = m.group(1)
                        trace_name = f'Trace-{idx}'
                        if trace_name in basemap:
                            # remove the shape_N entry
                            to_remove.add(basemap[base])
                if to_remove:
                    dxf_file_paths = [p for p in dxf_file_paths if p not in to_remove]
            except Exception:
                pass
            # Split dxf_cut_depths into arrays of max size 4
            # Try to load per-DXF cut depths from a temp pickle saved by the server
            # or from the project's processing_output/export_manifest.json. Fall
            # back to the historical default of 10 if nothing is found.
            try:
                import json
                cut_depths = None
                # Look for an exported GSM project snapshot in the project folder.
                # `design_files_directory` resolves to the project's root folder
                # (repo root + folder_name), so prefer <project>/<projectName>.gsm
                gsm_candidates = []
                gsm_candidates.append(os.path.join(design_files_directory, f"{file_name}.gsm"))
                gsm_candidates.append(os.path.join(design_files_directory, f"{file_name}.json"))
                parent_dir = os.path.dirname(design_files_directory)
                gsm_candidates.append(os.path.join(parent_dir, f"{file_name}.gsm"))
                # also include any .gsm found in the project folder
                if os.path.exists(design_files_directory):
                    for fn in os.listdir(design_files_directory):
                        if fn.lower().endswith('.gsm'):
                            gsm_candidates.append(os.path.join(design_files_directory, fn))

                for gp in gsm_candidates:
                    if not gp or not os.path.exists(gp):
                        continue
                    try:
                        with open(gp, 'r', encoding='utf8') as gf:
                            gsm_obj = json.load(gf)

                        # gsm_obj may contain the project as { items: [...] } or as a list
                        items = None
                        if isinstance(gsm_obj, dict):
                            items = gsm_obj.get('items') or gsm_obj.get('shapes') or gsm_obj.get('project')
                        elif isinstance(gsm_obj, list):
                            items = gsm_obj

                        if not items or not isinstance(items, list):
                            # not usable
                            # but still allow reading board parameters below
                            items = None

                        # If lengths match, use direct ordering; otherwise try map by name
                        if items and len(items) == len(dxf_file_paths):
                            # When items align 1:1 with dxf_file_paths, use direct mapping
                            # but still respect per-item cutType to split cuts vs raised/blocker.
                            cut_depths = []
                            cut_paths = []
                            raised_paths = []
                            raised_heights = []
                            blocker_paths = []
                            # Track section cuts separately from regular cuts
                            section_paths = []
                            section_depths_list = []  # List of [d1, d2, d3] arrays
                            section_params_list = []  # List of [w1, w2, rotation] arrays
                            section_positions_list = []  # List of [x, y] positions (mm) for sectioned shapes
                            # Build a name->type/depth map to prefer robust name-based mapping
                            import re as _re
                            def _norm(s: str) -> str:
                                if not s:
                                    return ""
                                s2 = str(s).lower()
                                s2 = _re.sub(r'^dxf\s*-\s*', '', s2)
                                s2 = _re.sub(r'[^0-9a-z]', '', s2)
                                return s2

                            name_map = {}
                            type_map = {}
                            raise_height_map = {}
                            for itx in items:
                                if not isinstance(itx, dict):
                                    continue
                                try:
                                    depth_val = float(itx.get('depthMM') or itx.get('depth_mm') or itx.get('depth') or itx.get('depthMm') or 10.0)
                                except Exception:
                                    try:
                                        depth_val = float(str(itx.get('depthMM') or itx.get('depth_mm') or itx.get('depth') or itx.get('depthMm') or 10.0))
                                    except Exception:
                                        depth_val = 10.0
                                candidates = set()
                                if itx.get('dxfName'):
                                    candidates.add(_norm(os.path.splitext(os.path.basename(itx.get('dxfName')))[0]))
                                if itx.get('dxf_name'):
                                    candidates.add(_norm(os.path.splitext(os.path.basename(itx.get('dxf_name')))[0]))
                                if itx.get('name'):
                                    candidates.add(_norm(itx.get('name')))
                                if itx.get('title'):
                                    candidates.add(_norm(itx.get('title')))
                                if not candidates and itx.get('id'):
                                    candidates.add(_norm(str(itx.get('id'))))
                                for c in candidates:
                                    if c:
                                        name_map[c] = depth_val
                                        try:
                                            ct = str(itx.get('cutType') or itx.get('cut_type') or itx.get('cut') or itx.get('type') or "").strip()
                                        except Exception:
                                            ct = ""
                                        type_map[c] = ct
                                        # raised height
                                        rh = None
                                        for key in ('depthMM', 'depth_mm', 'depth', 'raisedHeight', 'raised_height', 'raised', 'height7Units', 'heightMM', 'height', 'z'):
                                            if key in itx and itx.get(key) is not None:
                                                try:
                                                    rh = float(itx.get(key))
                                                except Exception:
                                                    try:
                                                        rh = float(str(itx.get(key)))
                                                    except Exception:
                                                        rh = None
                                                break
                                        raise_height_map[c] = rh

                            for idx, it in enumerate(items):
                                # preserve depth values as floats (depthMM may be fractional)
                                d = 10.0
                                if isinstance(it, dict):
                                    try:
                                        d = float(it.get('depthMM') or it.get('depth_mm') or it.get('depth') or it.get('depthMm') or d)
                                    except Exception:
                                        try:
                                            d = float(str(it.get('depthMM') or it.get('depth_mm') or it.get('depth') or it.get('depthMm') or d))
                                        except Exception:
                                            d = 10.0
                                d_int = d

                                # determine cutType for this item
                                ct = ""
                                if isinstance(it, dict):
                                    try:
                                        ct = str(it.get('cutType') or it.get('cut_type') or it.get('cut') or it.get('type') or "").strip()
                                    except Exception:
                                        ct = ""
                                # match corresponding dxf path by index
                                try:
                                    pth = dxf_file_paths[idx]
                                except Exception:
                                    pth = None

                                if pth is None:
                                    # fallback to treating as cut
                                    cut_paths.append(pth)
                                    cut_depths.append(d_int)
                                    continue

                                ctl = ct.lower()
                                if ctl == 'raised':
                                    raised_paths.append(pth)
                                    # Prefer depthMM as the raised height when present, preserve floats
                                    rh = None
                                    if isinstance(it, dict):
                                        for key in ('depthMM', 'depth_mm', 'depth', 'raisedHeight', 'raised_height', 'raised', 'height7Units', 'heightMM', 'height', 'z'):
                                            if key in it and it.get(key) is not None:
                                                try:
                                                    rh = float(it.get(key))
                                                except Exception:
                                                    try:
                                                        rh = float(str(it.get(key)))
                                                    except Exception:
                                                        rh = None
                                                break
                                    if rh is None:
                                        rh = 1.0
                                    raised_heights.append(rh)
                                elif ctl == 'blocker':
                                    # Blockers are recorded separately; their height is computed in SCAD
                                    blocker_paths.append(pth)
                                else:
                                    # Check if this cut has splitToSections enabled
                                    split_enabled = False
                                    if isinstance(it, dict):
                                        split_enabled = it.get('splitToSections', False)
                                    
                                    if split_enabled:
                                        # Add to section cuts array
                                        section_paths.append(pth)
                                        # Capture section position (x,y) if available on the item
                                        pos_x = 0.0
                                        pos_y = 0.0
                                        if isinstance(it, dict):
                                            # common keys: 'x', 'y' or 'position' array
                                            try:
                                                if it.get('x') is not None:
                                                    pos_x = float(it.get('x'))
                                                elif it.get('pos_x') is not None:
                                                    pos_x = float(it.get('pos_x'))
                                                elif it.get('position') and isinstance(it.get('position'), (list, tuple)) and len(it.get('position')) >= 1:
                                                    pos_x = float(it.get('position')[0])
                                            except Exception:
                                                pos_x = 0.0
                                            try:
                                                if it.get('y') is not None:
                                                    pos_y = float(it.get('y'))
                                                elif it.get('pos_y') is not None:
                                                    pos_y = float(it.get('pos_y'))
                                                elif it.get('position') and isinstance(it.get('position'), (list, tuple)) and len(it.get('position')) >= 2:
                                                    pos_y = float(it.get('position')[1])
                                            except Exception:
                                                pos_y = 0.0
                                        # append position in mm
                                        try:
                                            section_positions_list.append([pos_x, pos_y])
                                        except Exception:
                                            section_positions_list.append([0.0, 0.0])
                                        # Get section depths
                                        sd = it.get('sectionDepths')
                                        if sd and isinstance(sd, (list, tuple)) and len(sd) >= 3:
                                            try:
                                                section_depths_list.append([float(sd[0]), float(sd[1]), float(sd[2])])
                                            except Exception:
                                                section_depths_list.append([d, d * 0.67, d * 0.33])
                                        else:
                                            section_depths_list.append([d, d * 0.67, d * 0.33])
                                        # Get section params (widths + rotation)
                                        sw = it.get('sectionWidths')
                                        sr = it.get('sectionRotation', 0)
                                        w1, w2 = 40, 20
                                        if sw and isinstance(sw, (list, tuple)) and len(sw) >= 2:
                                            try:
                                                w1, w2 = float(sw[0]), float(sw[1])
                                            except Exception:
                                                pass
                                        try:
                                            sr = float(sr)
                                        except Exception:
                                            sr = 0
                                        section_params_list.append([w1, w2, sr])
                                    else:
                                        # default to cut: record path and its depth
                                        cut_paths.append(pth)
                                        cut_depths.append(d_int)

                            # override dxf_file_paths to only include regular cuts for downstream blocks
                            dxf_file_paths = cut_paths
                            # Debugging: log classification so we can verify mapping
                            try:
                                print('import_to_openscad: classification (index-aligned items):')
                                print('  cut_paths:', cut_paths)
                                print('  section_paths:', section_paths)
                                print('  raised_paths:', raised_paths)
                                print('  blocker_paths:', blocker_paths)
                                print('  cut_depths:', cut_depths)
                            except Exception:
                                pass
                        elif items:
                            # build a robust name->depth map using multiple candidate keys
                            import re as _re
                            def _norm(s: str) -> str:
                                if not s:
                                    return ""
                                s2 = str(s).lower()
                                # strip common prefixes like 'dxf - '
                                s2 = _re.sub(r'^dxf\s*-\s*', '', s2)
                                # remove non-alphanumeric characters
                                s2 = _re.sub(r'[^0-9a-z]', '', s2)
                                return s2

                            name_map = {}
                            type_map = {}
                            raise_height_map = {}
                            for it in items:
                                if not isinstance(it, dict):
                                    continue
                                depth_val = 10
                                # preserve depth as float
                                try:
                                    depth_val = float(it.get('depthMM') or it.get('depth_mm') or it.get('depth') or it.get('depthMm') or 10.0)
                                except Exception:
                                    try:
                                        depth_val = float(str(it.get('depthMM') or it.get('depth_mm') or it.get('depth') or it.get('depthMm') or 10.0))
                                    except Exception:
                                        depth_val = 10.0
                                # gather candidate names
                                candidates = set()
                                if it.get('dxfName'):
                                    candidates.add(_norm(os.path.splitext(os.path.basename(it.get('dxfName')))[0]))
                                if it.get('dxf_name'):
                                    candidates.add(_norm(os.path.splitext(os.path.basename(it.get('dxf_name')))[0]))
                                if it.get('name'):
                                    candidates.add(_norm(it.get('name')))
                                if it.get('title'):
                                    candidates.add(_norm(it.get('title')))
                                # fallback: if no candidate names, try the id
                                if not candidates and it.get('id'):
                                    candidates.add(_norm(str(it.get('id'))))
                                for c in candidates:
                                    if c:
                                        name_map[c] = depth_val
                                        # Extract cut type (Cut, Blocker, Raised, etc.)
                                        try:
                                            ct = str(it.get('cutType') or it.get('cut_type') or it.get('cut') or it.get('type') or "").strip()
                                        except Exception:
                                            ct = ""
                                        type_map[c] = ct
                                        # Extract raised height if present (various possible keys)
                                        rh = None
                                        for key in ('depthMM', 'depth_mm', 'depth', 'raisedHeight', 'raised_height', 'raised', 'height7Units', 'heightMM', 'height', 'z'):
                                            if key in it and it.get(key) is not None:
                                                try:
                                                    rh = float(it.get(key))
                                                except Exception:
                                                    try:
                                                        rh = float(str(it.get(key)))
                                                    except Exception:
                                                        rh = None
                                                break
                                        # If no explicit raised height, leave None
                                        raise_height_map[c] = rh

                            # Before aligning depths, split DXF paths into cut vs raised/blocker
                            # based on the parsed GSM item types in type_map. If type_map is
                            # empty, fall back to treating all paths as cuts.
                            cut_paths = []
                            raised_paths = []
                            raised_heights = []
                            blocker_paths = []
                            if name_map:
                                for pth in dxf_file_paths:
                                    base = os.path.splitext(os.path.basename(pth))[0]
                                    nb = _norm(base)
                                    matched_key = None
                                    # exact normalized match first
                                    if nb in name_map:
                                        matched_key = nb
                                    else:
                                        for nm_key in name_map.keys():
                                            if not nm_key:
                                                continue
                                            if nm_key in nb or nb in nm_key:
                                                matched_key = nm_key
                                                break

                                    if matched_key and matched_key in type_map:
                                        ct = (type_map.get(matched_key) or "").strip().lower()
                                        if ct == 'raised':
                                            raised_paths.append(pth)
                                            rh = raise_height_map.get(matched_key)
                                            # default raised height fallback
                                            if rh is None:
                                                rh = 1.0
                                            raised_heights.append(rh)
                                        elif ct == 'blocker':
                                            blocker_paths.append(pth)
                                        else:
                                            cut_paths.append(pth)
                                    else:
                                        # unknown mapping; default to cut
                                        cut_paths.append(pth)
                            else:
                                # No GSM name map available; treat all as cuts
                                cut_paths = list(dxf_file_paths)

                            # replace original list with cuts-only for downstream processing
                            dxf_file_paths = cut_paths

                            # Now align depths to the final dxf_file_paths order by matching normalized basenames
                            cut_depths = []
                            for pth in dxf_file_paths:
                                base = os.path.splitext(os.path.basename(pth))[0]
                                nb = _norm(base)
                                matched = None
                                # exact normalized match first
                                if nb in name_map:
                                    matched = name_map[nb]
                                else:
                                    # try partial matches (name contained in base or vice versa)
                                    for nm_key, depth_val in name_map.items():
                                        if not nm_key:
                                            continue
                                        if nm_key in nb or nb in nm_key:
                                            matched = depth_val
                                            break
                                if matched is not None:
                                    try:
                                        cut_depths.append(float(matched))
                                    except Exception:
                                        try:
                                            cut_depths.append(float(str(matched)))
                                        except Exception:
                                            cut_depths.append(10.0)
                                else:
                                    cut_depths.append(10.0)

                        # Also attempt to read board parameters for size info if present
                        # (so when import_to_openscad is called without explicit grid sizes
                        # the GSM can still provide them)
                        try:
                            if isinstance(gsm_obj, dict):
                                # Prefer `board` (canonical) for size info
                                bp = gsm_obj.get('board')
                                if bp and isinstance(bp, dict):
                                    # Prefer explicit gridX/gridY first, then width/depth
                                    try:
                                        if 'gridX' in bp:
                                            gridx_size = int(bp.get('gridX'))
                                        elif 'width' in bp and (gridx_size is None or gridx_size == 5):
                                            gridx_size = int(bp.get('width'))
                                    except Exception:
                                        pass
                                    try:
                                        if 'gridY' in bp:
                                            gridy_size = int(bp.get('gridY'))
                                        elif 'depth' in bp and (gridy_size is None or gridy_size == 2):
                                            gridy_size = int(bp.get('depth'))
                                    except Exception:
                                        pass
                                    try:
                                        # handle gridZ or various height keys including height7Units
                                        if 'gridZ' in bp:
                                            gridz_size = int(bp.get('gridZ'))
                                        elif 'height7Units' in bp:
                                            gridz_size = int(bp.get('height7Units'))
                                        elif 'height' in bp:
                                            gridz_size = int(bp.get('height'))
                                        elif 'heightMM' in bp:
                                            gridz_size = int(bp.get('heightMM'))
                                        else:
                                            # fallback: scan for any key that contains 'height'
                                            for k, v in bp.items():
                                                if isinstance(k, str) and 'height' in k.lower():
                                                    try:
                                                        gridz_size = int(v)
                                                        break
                                                    except Exception:
                                                        continue
                                    except Exception:
                                        pass
                        except Exception:
                            pass

                        if cut_depths and len(cut_depths) == len(dxf_file_paths):
                            break
                    except Exception:
                        continue

                if not cut_depths or len(cut_depths) != len(dxf_file_paths):
                    cut_depths = [10.0] * len(dxf_file_paths)

                # Ensure strings for SCAD output (format floats minimally)
                def _fmt_num(n):
                    try:
                        fv = float(n)
                    except Exception:
                        return '10'
                    if abs(fv - round(fv)) < 1e-6:
                        return str(int(round(fv)))
                    else:
                        # trim unnecessary trailing zeros
                        s = ('%f' % fv).rstrip('0').rstrip('.')
                        return s

                cut_depths = [_fmt_num(x) for x in cut_depths]
            except Exception:
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

            # Prepare SCAD strings for any raised/blocker DXFs found earlier
            dxf_file_paths_raised = raised_paths if 'raised_paths' in locals() else []
            dxf_raised_heights = raised_heights if 'raised_heights' in locals() else []
            dxf_file_paths_blocker = blocker_paths if 'blocker_paths' in locals() else []
            # Prepare SCAD strings for section cut DXFs
            dxf_sections = section_paths if 'section_paths' in locals() else []
            section_depths_data = section_depths_list if 'section_depths_list' in locals() else []
            section_params_data = section_params_list if 'section_params_list' in locals() else []
            
            dxf_raised_paths_scad = 'dxf_file_paths_raised = [\n' + ',\n'.join([f'"{p}"' for p in dxf_file_paths_raised]) + '\n];\n'
            dxf_raised_heights_scad = 'dxf_raised_heights = [' + ', '.join([_fmt_num(h) for h in dxf_raised_heights]) + '];\n'
            dxf_blocker_paths_scad = 'dxf_file_paths_blocker = [\n' + ',\n'.join([f'"{p}"' for p in dxf_file_paths_blocker]) + '\n];\n'
            # Generate dxf_sections array and its associated depths/params
            dxf_sections_scad = 'dxf_sections = [\n' + ',\n'.join([f'"{p}"' for p in dxf_sections]) + '\n];\n'
            # Generate section_cut_depth and section_parameters arrays for section paths
            section_cut_depth_scad = ''
            section_params_scad = ''
            if section_depths_data:
                depth_arrays = []
                param_arrays = []
                for idx, (depths, params) in enumerate(zip(section_depths_data, section_params_data)):
                    depth_str = ', '.join([_fmt_num(d) for d in depths])
                    param_str = ', '.join([_fmt_num(p) for p in params])
                    depth_arrays.append(f'[{depth_str}]')
                    param_arrays.append(f'[{param_str}]')
                section_cut_depth_scad = 'section_cut_depth = [\n' + ',\n'.join(depth_arrays) + '\n];\n'
                section_params_scad = 'section_parameters = [\n' + ',\n'.join(param_arrays) + '\n];\n'
                # section_positions (x,y) for each section path
                pos_arrays = []
                for pos in section_positions_list:
                    try:
                        pos_arrays.append(f'[{_fmt_num(pos[0])}, {_fmt_num(pos[1])}]')
                    except Exception:
                        pos_arrays.append('[0, 0]')
                section_positions_scad = 'section_positions = [\n' + ',\n'.join(pos_arrays) + '\n];\n'
            else:
                section_cut_depth_scad = 'section_cut_depth = [];\n'
                section_params_scad = 'section_parameters = [];\n'
                section_positions_scad = 'section_positions = [];\n'
            
            # Generate position_1, position_2, ... and position array using per-contour
            # offsets. Prefer offsets embedded in a per-project `meta.json` (stateless
            # and per-run). For backwards compatibility try the legacy pickle as a
            # fallback; if neither is available use zeros.
            pos_xy = None
            try:
                import json
                meta_path = os.path.join(design_files_directory, 'meta.json')
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, 'r', encoding='utf8') as mf:
                            meta_obj = json.load(mf)
                        if isinstance(meta_obj, dict) and 'offset_pos_xy' in meta_obj:
                            pos_xy = meta_obj.get('offset_pos_xy')
                    except Exception:
                        pos_xy = None
            except Exception:
                pos_xy = None
            # Validate/normalize to expected length
            if not pos_xy or len(pos_xy) != len(dxf_file_paths):
                # No legacy fallback: default to zeros when offsets aren't provided
                pos_xy = [[0,0] for _ in range(len(dxf_file_paths))]
            # Force all positions to origin (0,0,0) to ensure OpenSCAD places
            # shapes at the project origin. The user requested hardcoded zeros.
            position_lines = []
            for idx in range(len(dxf_file_paths)):
                try:
                    x_val = pos_xy[idx][0]
                    y_val = pos_xy[idx][1]
                    position_lines.append(f'position_{idx+1} = [{_fmt_num(x_val)}, {_fmt_num(y_val)}, 0];')
                except Exception:
                    position_lines.append(f'position_{idx+1} = [0, 0, 0];')
            position_array = f'position = [{', '.join([f"position_{i+1}" for i in range(len(dxf_file_paths))])}];\n'
            # Replace the position = [[0, 0, 0]]; // .1 line
            updated_scad_content = updated_scad_content.replace('position = [[0, 0, 0]]; // .1', '\n'.join(position_lines) + '\n' + position_array)

            # --- FINGER SLOT OPTIONS ---
            # Generate per-slot variables and arrays for finger slots
            # Interleave slot_shape_N, slot_params_N, slot_pos_N for each slot
            slot_lines = []
            for idx in range(len(dxf_file_paths)):
                slot_lines.append(f'slot_shape_{idx+1} = "scoop"; // [none, rectangle, oval, scoop, triangle, keyhole, teardrop]')
                slot_lines.append(f'slot_params_{idx+1} = [80, 40, 9, 0]; // length (mm), width (mm), height (mm), rotation (deg)')
                # Keep slot positions at origin (0,0) when passing to OpenSCAD
                slot_lines.append(f'slot_pos_{idx+1} = [0, 0]; // Translation position [x, y] in mm')
            slot_shape_array = f'slot_shape = [{', '.join([f"slot_shape_{i+1}" for i in range(len(dxf_file_paths))])}];\n'
            slot_params_array = f'slot_params = [{', '.join([f"slot_params_{i+1}" for i in range(len(dxf_file_paths))])}];\n'
            slot_pos_array = f'slot_pos = [{', '.join([f"slot_pos_{i+1}" for i in range(len(dxf_file_paths))])}];\n'
            # Always start the block with use_finger_slots = false;
            finger_slot_block = 'use_finger_slots = false; // true or false\n' + '\n'.join(slot_lines + [slot_shape_array, slot_params_array, slot_pos_array])
            # Replace the finger slot options block
            import re
            updated_scad_content = re.sub(
                r'/\* \[Finger Slot Options\] \*/.*?slot_pos = \[.*?\];',
                '/* [Finger Slot Options] */\n' + finger_slot_block,
                updated_scad_content,
                flags=re.DOTALL
            )

            # Recompute dxf_paths_scad to reflect any split (cuts-only, non-sectioned) done above
            dxf_paths_scad = 'dxf_file_paths = [\n' + ',\n'.join([f'"{p}"' for p in dxf_file_paths]) + '\n];\n'
            # Insert all blocks including dxf_sections. The template may
            # contain either the old single-file placeholder or the newer
            # array placeholder; replace the first assignment to
            # dxf_file_path(s) unconditionally so the example path never
            # survives (covers one or many DXFs).
            scad_block = dxf_paths_scad + dxf_raised_paths_scad + dxf_raised_heights_scad + dxf_blocker_paths_scad + dxf_cut_depths_scad + concat_line + '// dxf_file_path replaced by dxf_file_paths'
            import re
            assign_pattern = re.compile(r'dxf_file_paths?\s*=\s*\[[^\]]*?\];', re.IGNORECASE)
            updated_scad_content, sub_count = assign_pattern.subn(scad_block, updated_scad_content, count=1)
            if not sub_count:
                # Fallback for templates using the single-path variable name (allow flexible spacing)
                single_pattern = re.compile(r'dxf_file_path\s*=\s*"[^"]*"\s*;', re.IGNORECASE)
                updated_scad_content, _ = single_pattern.subn(scad_block, updated_scad_content, count=1)

            # Replace the dxf_sections placeholder block. Support both the
            # older template (3-line placeholder) and the newer (4-line
            # placeholder including section_positions). Try the 4-line
            # replacement first, then fall back to replacing the 3-line
            # placeholder so older templates are still supported.
            updated_scad_content = updated_scad_content.replace(
                'dxf_sections = [];\nsection_cut_depth = [];\nsection_parameters = [];\nsection_positions = [];',
                dxf_sections_scad + section_cut_depth_scad + section_params_scad + section_positions_scad
            )
            # Fallback for templates that don't include section_positions
            updated_scad_content = updated_scad_content.replace(
                'dxf_sections = [];\nsection_cut_depth = [];\nsection_parameters = [];',
                dxf_sections_scad + section_cut_depth_scad + section_params_scad + section_positions_scad
            )

            # Ensure `size` is replaced with GSM board values (gridX, gridY, height).
            try:
                gx = int(gridx_size) if gridx_size is not None else 5
            except Exception:
                gx = 5
            try:
                gy = int(gridy_size) if gridy_size is not None else 2
            except Exception:
                gy = 2
            try:
                gz = int(gridz_size) if gridz_size is not None else 6
            except Exception:
                gz = 6
            # Replace size assignment even if the template includes trailing comments or spacing
            size_pattern = re.compile(r'size\s*=\s*\[[^\]]*\];[^\n]*')
            updated_scad_content, _ = size_pattern.subn(f'size = [{gx}, {gy}, {gz}]; // grid sizes', updated_scad_content, count=1)

            # Determine chamfer settings from GSM `board` if available. Default: enabled, 2mm
            chamfer_enabled = True
            chamfer_height_val = 2
            try:
                if 'gsm_obj' in locals() and isinstance(gsm_obj, dict):
                    bp = gsm_obj.get('board')
                    if bp and isinstance(bp, dict):
                        # support keys 'chamferEnabled' (bool) and 'chamferHeight' (number)
                        if 'chamferEnabled' in bp:
                            chamfer_enabled = bool(bp.get('chamferEnabled'))
                        if 'chamferHeight' in bp:
                            try:
                                chamfer_height_val = float(bp.get('chamferHeight'))
                            except Exception:
                                chamfer_height_val = chamfer_height_val
            except Exception:
                pass

            # Replace use_chamfered_extrude and chamfer_height lines in template
            try:
                updated_scad_content = updated_scad_content.replace('use_chamfered_extrude = true;', f'use_chamfered_extrude = {str(bool(chamfer_enabled)).lower()};')
            except Exception:
                pass
            try:
                # Template contains a comment; replace the canonical line if present
                updated_scad_content = updated_scad_content.replace('chamfer_height = 2;      // mm, height of chamfer', f'chamfer_height = {chamfer_height_val};      // mm, height of chamfer')
                updated_scad_content = updated_scad_content.replace('chamfer_height = 2;', f'chamfer_height = {chamfer_height_val};')
            except Exception:
                pass
            # Make single DXF path relative to project folder when possible
            # If we're not in split mode, compute a single relative DXF path
            # and emit it as a one-element `dxf_file_paths` array. When
            # `splitDXF` is True the earlier branch already inserted the
            # multiple-path `scad_block`, so skip this single-path logic.
            if not (splitDXF and isinstance(dxf_path, list)):
                try:
                    dp = os.path.normpath(dxf_path)
                    if os.path.isabs(dp) and dp.startswith(os.path.normpath(design_files_directory)):
                        rel = os.path.relpath(dp, design_files_directory).replace('\\', '/')
                        dxf_path_scad = rel
                    else:
                        dxf_path_scad = dp.replace('\\', '/')
                except Exception:
                    # Ensure we always have a string fallback
                    dxf_path_scad = str(dxf_path).replace('\\', '/')
                # Always emit an array `dxf_file_paths` even for a single entry so
                # the template can uniformly consume an array variable.
                updated_scad_content = updated_scad_content.replace('dxf_file_path = "examples/example.dxf";', f'dxf_file_paths = ["{dxf_path_scad}"];')
        
            # Determine slot rotation and width based on gridx_size and gridy_size
        #slot_rotation = 0 if gridx_size > gridy_size else 90
        #slot_width = 80 if min(gridx_size, gridy_size) > 2 else 40
            # Use provided gridz_size when available, otherwise fall back to 6
            try:
                zval = int(gridz_size) if gridz_size is not None else 6
            except Exception:
                zval = 6
            updated_scad_content = updated_scad_content.replace('size = [5, 2, 6];', f'size = [{gridx_size}, {gridy_size}, {zval}];')
        #updated_scad_content = updated_scad_content.replace('slot_rotation = 90;', f'slot_rotation = {slot_rotation};')
        #updated_scad_content = updated_scad_content.replace('slot_width = 40;', f'slot_width = {slot_width};')
        # `multiple_dxf` should reflect whether more than one DXF is present, not
        # the internal normalization flag used above.
        multi_flag = len(dxf_file_paths) > 1
        updated_scad_content = updated_scad_content.replace('multiple_dxf = false;', f'multiple_dxf = {str(multi_flag).lower()};')

        # Save the SCAD file in the folder specified by folder_name
        script_directory = os.path.dirname(os.path.abspath(__file__))
        design_files_directory = os.path.join(script_directory, "..", folder_name)
        os.makedirs(design_files_directory, exist_ok=True)
        scad_file_path = os.path.join(design_files_directory, f"{file_name}.scad")
        with open(scad_file_path, 'w') as scad_file:
            scad_file.write(updated_scad_content)
        
        # SCAD file has been written. Do not launch any OpenSCAD GUI from here.
        # The server or caller should invoke the OpenSCAD CLI (e.g. `openscad.com --backend=manifold -o <project>.stl <file>.scad`).
        console_text.setText(f"SCAD saved: {scad_file_path}")
        return scad_file_path
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
    # Preserve absolute coordinates when writing single-contour DXFs.
    # Do not subtract the contour center; use scaled image coordinates
    # directly so the resulting DXF keeps the original placement.
    points = [
        (point[0][1] * scale_factor, point[0][0] * scale_factor)
        for point in contour
    ]
    if points[0] != points[-1]:
        points.append((points[0][0], points[0][1]))
    msp.add_lwpolyline(points)
    single_name = f"{file_name}_contour_{idx+1}"
    output_path = save_dxf_file(doc, single_name, folder_name)
    return output_path


def cli_main(argv=None):
    """Command-line entry point for processing.

    Keeps behavior simple: parse args, run the existing pipeline functions,
    write DXFs via `save_contours_as_dxf`, and emit `traced.png`, `offset.png`,
    and `meta.json` into the provided output directory.
    """
    import argparse
    import json
    from PIL import Image, ImageFilter

    parser = argparse.ArgumentParser()
    parser.add_argument('input_path', nargs='?')
    parser.add_argument('out_dir', nargs='?', default='processing_output')
    parser.add_argument('--threshold', type=float, default=145)
    parser.add_argument('--offset', type=float, default=0.1)
    parser.add_argument('--token', type=float, default=3.0)
    parser.add_argument('--resolution', type=int, default=20)
    parser.add_argument('--projectdir', type=str, default=None)
    parser.add_argument('--workfolder', type=str, default=None, help='Path to the project working folder (used to derive folder name)')
    parser.add_argument('--split', action='store_true', help='Split contours into separate DXF files')
    args = parser.parse_args(argv)

    inp = args.input_path
    out = args.out_dir
    os.makedirs(out, exist_ok=True)

    # Small adapters that mimic the GUI entry widgets used by existing functions
    class DummyEntry:
        def __init__(self, v):
            self._v = v
        def text(self):
            return str(self._v)

    class DummyConsole:
        def setText(self, s):
            print(s)

    threshold_entry = DummyEntry(args.threshold)
    offset_entry = DummyEntry(args.offset)
    token_entry = DummyEntry(args.token)
    resolution_entry = DummyEntry(args.resolution)
    console = DummyConsole()

    # Determine threshold and globals via existing helper
    threshold_input = get_threshold_input(threshold_entry, offset_entry, token_entry, resolution_entry)

    # find diameter (function accepts either image path or image array)
    # Provide a headless display function for CLI mode so GUI functions that
    # call `display_image_on_canvas(image, canvas, region, caption)` won't
    # attempt to use a Qt canvas (canvas may be None in CLI). This mirrors the
    # previous wrapper behavior by saving image files for regions 1/2/3.
    def _cli_save_display(image_obj, canvas_obj, region, caption):
        try:
            from PIL import Image as PILImage
            import numpy as _np
            import cv2 as _cv2

            # Convert OpenCV BGR numpy arrays to PIL RGB
            pil = None
            if isinstance(image_obj, _np.ndarray):
                if image_obj.ndim == 2:
                    pil = PILImage.fromarray(image_obj).convert('L').convert('RGB')
                else:
                    pil = PILImage.fromarray(_cv2.cvtColor(image_obj, _cv2.COLOR_BGR2RGB))
            else:
                try:
                    pil = PILImage.fromarray(image_obj)
                except Exception:
                    try:
                        pil = image_obj.convert('RGB')
                    except Exception:
                        pil = None

            if pil is None:
                return

            # Map canvas region numbers to output filenames used by server/frontend
            # Region mapping in GUI: 1=Original, 2=Traced, 3=Offset
            try:
                if region == 1:
                    fname = os.path.join(out, 'original.png')
                elif region == 2:
                    fname = os.path.join(out, 'traced.png')
                elif region == 3:
                    fname = os.path.join(out, 'offset.png')
                else:
                    fname = os.path.join(out, f'region_{region}.png')
                pil.save(fname)
            except Exception as e:
                print('Failed to save CLI display image:', e)
                return
        except Exception as e:
            print('Error in _cli_save_display:', e)
            return

    # Monkey-patch the module-level display helper so other functions can call it
    try:
        globals()['display_image_on_canvas'] = _cli_save_display
    except Exception:
        pass

    # Load image with OpenCV and run image-processing functions on the array
    import cv2

    image = cv2.imread(inp)
    if image is None:
        # OpenCV sometimes lacks codecs in some environments; fall back to PIL
        try:
            from PIL import Image as PILImage
            import numpy as _np
            pil = PILImage.open(inp).convert('RGB')
            image = cv2.cvtColor(_np.array(pil), cv2.COLOR_RGB2BGR)
            print('Loaded image via PIL fallback')
        except Exception as e:
            print('Error: could not read input image:', inp, 'cv2 failed and PIL fallback also failed:', e)
            return 2

    diameter, _ = find_diameter(image, None, threshold_entry, offset_entry, token_entry, resolution_entry, console)
    if diameter is None:
        print('Warning: diameter not found; continuing with token-based scaling')

    # find contours using the image array so the pipeline matches GUI behavior
    contours, offset_image = find_contours(image, diameter if diameter else (args.token * 25.4), threshold_input, None, console)
    if not contours:
        print('No contours found; exiting')
        return 2

    file_stem = os.path.splitext(os.path.basename(inp))[0]
    # Determine folder_name used by the DXF save helpers. Prefer a provided
    # workfolder basename if present (this matches previous behavior where
    # the project subfolder name was passed as the working folder).
    if args.workfolder:
        folder_name = os.path.basename(os.path.normpath(args.workfolder))
    else:
        folder_name = args.projectdir or os.path.basename(os.getcwd())

    # Compute a scale factor used by save_contours_as_dxf. Historically the
    # code used token(mm) / diameter(pixel) as the scale; replicate that.
    token_mm = float(args.token) * 25.4
    scale_factor = (token_mm / diameter) if diameter and diameter != 0 else token_mm

    # Decide whether to split DXFs. If caller explicitly requested `--split`
    # honor it; otherwise auto-split when multiple contours are detected so
    # behavior matches the previous wrapper which split by default.
    split_flag = bool(args.split or (isinstance(contours, (list, tuple)) and len(contours) > 1))
    print(f"split_flag={split_flag}; contours_found={len(contours) if isinstance(contours, (list,tuple)) else 'unknown'}")
    try:
        dxf_paths, gridx, gridy, filtered_contours, offset_pos_xy = save_contours_as_dxf(contours, file_stem, scale_factor, console, folder_name, splitDXF=split_flag, write_dxfs=False)
    except Exception as e:
        print('save_contours_as_dxf failed:', e)
        dxf_paths = None
        gridx = None
        gridy = None
        filtered_contours = []
        offset_pos_xy = []

    # Build polylines (mm coordinates) from the filtered contours so
    # callers (front-end) can choose to import traced geometry without
    # relying on disk-written DXF files. Use the same scaling used when
    # writing DXF points so coordinates match expected mm units.
    polylines = []
    try:
        source_contours = filtered_contours if 'filtered_contours' in locals() and filtered_contours else contours
        if source_contours:
            # If possible, obtain the original image dimensions so we can
            # rotate contour points about the image center to correct the
            # observed -90deg orientation seen in the frontend. The image
            # variable exists in the CLI path; when absent we fall back to
            # the raw contour coordinates without rotation.
            try:
                img_h = None
                img_w = None
                if 'image' in locals() and image is not None:
                    img_h, img_w = image.shape[0], image.shape[1]
                pts_list = []
                for contour in source_contours:
                    try:
                        pts = []
                        for point in contour:
                            # contour points are stored as [[row, col]] arrays
                            row = float(point[0][0])
                            col = float(point[0][1])
                            if img_w is not None and img_h is not None:
                                # Translate to image-center coordinates
                                cx_img = img_w / 2.0
                                cy_img = img_h / 2.0
                                vx = col - cx_img
                                vy = row - cy_img
                                # Rotate +90 degrees (clockwise): (x,y) -> (y, -x)
                                rx = vy
                                ry = -vx
                                # Translate back
                                new_col = cx_img + rx
                                new_row = cy_img + ry
                                x_mm = new_col * scale_factor
                                y_mm = new_row * scale_factor
                            else:
                                # Fallback: no image dims available; keep original ordering
                                x_mm = col * scale_factor
                                y_mm = row * scale_factor
                            # Round to 0.1 mm for consistency with frontend
                            x_mm = round(x_mm, 1)
                            y_mm = round(y_mm, 1)
                            pts.append({'x': x_mm, 'y': y_mm})
                        if pts:
                            pts_list.append(pts)
                    except Exception:
                        continue
                polylines = pts_list
            except Exception:
                polylines = []
    except Exception:
        polylines = []

    # Create canonical per-shape names to help downstream tooling (server
    # synthesizes .poly.json names from these when converting to DXF). If
    # dxf_paths were created previously prefer basename-derived names, otherwise
    # fall back to a Trace-<N> naming scheme which matches the UI expectation.
    names = []
    try:
        if isinstance(dxf_paths, (list, tuple)) and dxf_paths:
            for p in dxf_paths:
                try:
                    if p:
                        bn = os.path.splitext(os.path.basename(p))[0]
                        names.append(str(bn))
                    else:
                        names.append('')
                except Exception:
                    names.append('')
        else:
            # Use number of polylines as the count
            count = len(polylines) if polylines else (len(filtered_contours) if 'filtered_contours' in locals() and filtered_contours else 0)
            for i in range(count):
                names.append(f"Trace-{i+1}")
    except Exception:
        names = []

    # Write meta.json including optional `polylines` so callers may import
    # traced geometry directly from the processing response.
    # Include per-contour offsets if available so downstream import_to_openscad
    # can consume them without relying on a stateful pickle file.
    try:
        meta = {'dxf_paths': dxf_paths, 'gridx_size': gridx, 'gridy_size': gridy, 'polylines': polylines, 'names': names, 'offset_pos_xy': offset_pos_xy}
    except Exception:
        meta = {'dxf_paths': dxf_paths, 'gridx_size': gridx, 'gridy_size': gridy, 'polylines': polylines, 'names': names}
    try:
        with open(os.path.join(out, 'meta.json'), 'w', encoding='utf8') as mf:
            json.dump(meta, mf, indent=2)
    except Exception as e:
        print('Failed to write meta.json:', e)

    # Ensure traced/offset images exist. Prefer the images written by the
    # headless display calls (display_image_on_canvas). Only synthesize
    # overlays as a fallback when the pipeline didn't already write files.
    try:
        traced_path = os.path.join(out, 'traced.png')
        offset_path = os.path.join(out, 'offset.png')

        if not os.path.exists(traced_path):
            try:
                # Try to create traced from the thresh produced by preprocessing
                _, thresh = preprocess_image(image, threshold_input)
                mask = Image.fromarray(thresh).convert('L')
                base = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                green = Image.new('RGBA', base.size, (0, 255, 0, 255))
                overlay = Image.new('RGBA', base.size, (0, 0, 0, 0))
                overlay.paste(green, (0, 0), mask)
                traced_overlay = Image.alpha_composite(base.convert('RGBA'), overlay)
                traced_overlay.save(traced_path)
            except Exception:
                pass

        if not os.path.exists(offset_path):
            try:
                if isinstance(offset_image, np.ndarray):
                    offset_pil = Image.fromarray(cv2.cvtColor(offset_image, cv2.COLOR_BGR2RGB))
                    offset_pil.save(offset_path)
            except Exception:
                pass
    except Exception as e:
        print('Warning: could not ensure traced/offset images:', e)

    print('Processing finished. Outputs in:', out)
    return 0


if __name__ == '__main__':
    import sys
    sys.exit(cli_main())
