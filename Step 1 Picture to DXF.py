import cv2
import ezdxf
import tkinter as tk
from tkinter import filedialog, simpledialog, messagebox
from PIL import Image, ImageTk
import numpy as np
import math
import os
import time
import pyperclip

# Global variables
offset = 0.1  # inches
token = 2.000  # inches

def get_threshold_input():
    global offset, token, resolution
    try:
        threshold_input = int(threshold_entry.get())
        if threshold_input < 0:
            threshold_input = 0
        elif threshold_input > 255:
            threshold_input = 255
    except ValueError:
        threshold_input = 145
    try:
        offset = float(offset_entry.get())
    except ValueError:
        offset = 0.1
    try:
        token = float(token_entry.get())
    except ValueError:
        token = 2.000
    try:
        resolution = float(resolution_entry.get())
    except ValueError:
        resolution = 10
    return threshold_input

def display_image_on_canvas(image, canvas, region, caption):
    img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(img)
    
    # Resize the image to fit the specified region while maintaining aspect ratio
    canvas_width = canvas.winfo_width() // 3
    canvas_height = canvas.winfo_height() - 50  # Leave more space for caption
    img.thumbnail((canvas_width, canvas_height), Image.LANCZOS)
    
    img = ImageTk.PhotoImage(img)
    if region == 1:
        x_offset = 0
        canvas.image1 = img  # Keep a reference to avoid garbage collection
    elif region == 2:
        x_offset = canvas_width
        canvas.image2 = img  # Keep a reference to avoid garbage collection
    elif region == 3:
        x_offset = 2 * canvas_width
        canvas.image3 = img  # Keep a reference to avoid garbage collection
    canvas.create_image(x_offset, 0, anchor=tk.NW, image=img)
    canvas.create_text(x_offset + canvas_width // 2, 5, text=caption, fill="black", font=("Helvetica", 16), anchor=tk.N)  # Move text up slightly
    
    # Update the canvas
    canvas.update()

def find_diameter(image_path, root, canvas):
    threshold_input = get_threshold_input()
    image = cv2.imread(image_path)
    imgray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ret, thresh = cv2.threshold(imgray, threshold_input, 255, cv2.THRESH_BINARY)
    thresh = cv2.bitwise_not(thresh)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    display_image_on_canvas(thresh, canvas, 2, "Traced")
    
    contours = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
    find_diameter_contours_img = image.copy()
    cv2.drawContours(find_diameter_contours_img, contours, -1, (0, 255, 0), 3)
    display_image_on_canvas(find_diameter_contours_img, canvas, 2, "Traced")

    max_circularity = 0
    global max_circularity_contour
    max_circularity_contour = None

    for contour in contours:
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        circularity = (4 * np.pi * area) / (perimeter * perimeter)
        if circularity > 0.85:
            if circularity > max_circularity:
                max_circularity = circularity
                max_circularity_contour = contour

    if max_circularity_contour is not None:
        (x, y), radius = cv2.minEnclosingCircle(max_circularity_contour)
        diameter = 2 * radius
        print(f"Circle with Greatest Circularity - Diameter: {diameter}, Circularity: {max_circularity}")
    else:
        print("No circle with sufficient circularity found.")
    return diameter, threshold_input

def find_contours(image_path, diameter, threshold_input, canvas):
    image = cv2.imread(image_path)
    imgray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ret, thresh = cv2.threshold(imgray, threshold_input, 255, cv2.THRESH_BINARY)
    thresh = cv2.bitwise_not(thresh)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    kernel_size = math.ceil(diameter / (token / offset) * 2)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    thresh = cv2.dilate(thresh, kernel)
    epsilon = kernel_size / resolution

    contours_tuple = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
    print(f"epsilon: {epsilon}")
    contours = [cv2.approxPolyDP(contour, epsilon, True) for contour in contours_tuple]

    max_circularity = 0
    global max_circularity_contour
    max_circularity_contour = None

    for contour in contours:
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        circularity = (4 * np.pi * area) / (perimeter * perimeter)
        if circularity > 0.8:
            if circularity > max_circularity:
                max_circularity = circularity
                max_circularity_contour = contour

    filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_circularity_contour)]
    filtered_contours_image = image.copy()
    cv2.drawContours(filtered_contours_image, filtered_contours, -1, (255, 0, 0), 2)
    display_image_on_canvas(filtered_contours_image, canvas, 3, "Filtered Contours")

    if max_circularity_contour is not None:
        (x, y), radius = cv2.minEnclosingCircle(max_circularity_contour)
        diameter = 2 * radius
        print(f"Circle with Greatest Circularity - Diameter: {diameter}, Circularity: {max_circularity}")
    else:
        print("No circle with sufficient circularity found.")

    return contours, filtered_contours_image

def save_contours_as_dxf(contours, file_name, scale_factor, console_text):
    doc = ezdxf.new()
    msp = doc.modelspace()

    # Exclude the max_circularity_contour from the contours
    filtered_contours = [contour for contour in contours if not np.array_equal(contour, max_circularity_contour)]

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
        
    # Ensure the DXF directory exists in the script's directory
    script_directory = os.path.dirname(os.path.abspath(__file__))
    dxf_directory = os.path.join(script_directory, "DXF")
    os.makedirs(dxf_directory, exist_ok=True)
    output_path = os.path.join(dxf_directory, file_name + ".dxf")
    
    doc.saveas(output_path)
    
    # Copy the file path to the clipboard
    pyperclip.copy(output_path)
    console_text.set(f"File saved successfully: {output_path}\nFile path '{output_path}' copied to clipboard.")

def select_image():
    root = tk.Tk()
    root.withdraw()  # Hide the root window
    root.update()  # Ensure the root window is updated
    file_path = filedialog.askopenfilename(
        title="Select Image",
        filetypes=[("Image files", "*.jpg;*.jpeg;*.png;*.bmp")]
    )
    root.destroy()  # Destroy the root window after file dialog is closed
    if file_path:
        print(f"Selected file: {file_path}")
    else:
        print("No file selected.")
    file_name, file_extension = os.path.splitext(os.path.basename(file_path))
    return file_path, file_name

def main():
    global threshold_entry, offset_entry, token_entry, resolution_entry, input_image_path, file_name
    root = tk.Tk()
    root.title("Image to DXF Converter")
    
    def load_image():
        global input_image_path, file_name
        input_image_path, file_name = select_image()
        if not input_image_path:
            print("No image selected. Exiting.")
            return
        print(f"Loaded image: {input_image_path}")
        image = cv2.imread(input_image_path)
        if image is None:
            print("Failed to load image.")
            return
        display_image_on_canvas(image, canvas, 1, "Original")

    def process_image():
        if not input_image_path:
            print("No image loaded. Please load an image first.")
            return
        print(f"Processing image: {input_image_path}")
        diameter, threshold_input = find_diameter(input_image_path, root, canvas)
        if diameter is None or threshold_input is None:
            return  # Return to main loop if the user selects "no"
        contours, offset_image = find_contours(input_image_path, diameter, threshold_input, canvas)
        save_contours_as_dxf(contours, file_name, 2.005 / diameter, console_text)

    def exit_application():
        root.destroy()

    root.attributes('-fullscreen', True)

    canvas_frame = tk.Frame(root)
    canvas_frame.pack(fill=tk.BOTH, expand=True)

    canvas = tk.Canvas(canvas_frame, height=canvas_frame.winfo_height() - 100)  # Set a fixed height for the canvas
    canvas.pack(fill=tk.BOTH, expand=True)

    control_frame = tk.Frame(root)
    control_frame.pack(side=tk.TOP, anchor=tk.NE, padx=20, pady=20)

    load_button = tk.Button(control_frame, text="Load Image", command=load_image, font=("Helvetica", 16))
    load_button.grid(row=0, column=0, columnspan=2, pady=10)

    tk.Label(control_frame, text="Threshold Input (0-255):").grid(row=1, column=0, sticky=tk.W)
    threshold_entry = tk.Entry(control_frame)
    threshold_entry.grid(row=1, column=1)
    threshold_entry.insert(0, "145")

    tk.Label(control_frame, text="Offset (inches):").grid(row=2, column=0, sticky=tk.W)
    offset_entry = tk.Entry(control_frame)
    offset_entry.grid(row=2, column=1)
    offset_entry.insert(0, "0.1")

    tk.Label(control_frame, text="Token Size (inches):").grid(row=3, column=0, sticky=tk.W)
    token_entry = tk.Entry(control_frame)
    token_entry.grid(row=3, column=1)
    token_entry.insert(0, "2.000")

    tk.Label(control_frame, text="Resolution:").grid(row=4, column=0, sticky=tk.W)
    resolution_entry = tk.Entry(control_frame)
    resolution_entry.grid(row=4, column=1)
    resolution_entry.insert(0, "10")

    process_button = tk.Button(control_frame, text="Process Image", command=process_image, font=("Helvetica", 16))
    process_button.grid(row=5, column=0, columnspan=2, pady=10)

    console_frame = tk.Frame(root)
    console_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=5)  # Adjust the padding to make the console smaller

    console_text = tk.StringVar()
    console_label = tk.Label(console_frame, textvariable=console_text, font=("Helvetica", 12), fg="green")
    console_label.pack(padx=10)

    button_frame = tk.Frame(console_frame)
    button_frame.pack(side=tk.BOTTOM, pady=5)

    exit_button = tk.Button(button_frame, text="Exit", command=exit_application, font=("Helvetica", 16))
    exit_button.pack(padx=10)

    root.mainloop()

if __name__ == "__main__":
    main()