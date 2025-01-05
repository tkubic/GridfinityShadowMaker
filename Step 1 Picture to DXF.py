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

def get_threshold_input(root):
    global offset, token
    threshold_input = simpledialog.askinteger("Threshold Input", "Enter threshold value (0-255, default is 145):", initialvalue=145, parent=root)
    offset = simpledialog.askfloat("Offset", "Enter offset value (inches):", initialvalue=0.1, parent=root)
    token = simpledialog.askfloat("Token Size", "Enter token size value (inches):", initialvalue=2.000, parent=root)
    threshold_input = threshold_input or 145
    offset = offset or 0.1
    token = token or 2.000
    return threshold_input

def display_image_on_canvas(image, canvas):
    img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(img)
    
    # Resize the image to fit the canvas while maintaining aspect ratio
    canvas_width = canvas.winfo_width()
    canvas_height = canvas.winfo_height()
    img.thumbnail((canvas_width, canvas_height), Image.LANCZOS)
    
    img = ImageTk.PhotoImage(img)
    canvas.create_image(0, 0, anchor=tk.NW, image=img)
    canvas.image = img  # Keep a reference to avoid garbage collection
    
    # Pause for 1 second
    canvas.update()
    time.sleep(1)

def find_diameter(image_path, root, canvas):
    while True:
        threshold_input = get_threshold_input(root)
        image = cv2.imread(image_path)
        imgray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        ret, thresh = cv2.threshold(imgray, threshold_input, 255, cv2.THRESH_BINARY)
        thresh = cv2.bitwise_not(thresh)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        display_image_on_canvas(thresh, canvas)
        
        result = messagebox.askquestion("Image Quality", "Are the results good?", icon='question', parent=root)
        if result == 'yes':
            break
    
    contours = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
    find_diameter_contours_img = image.copy()
    cv2.drawContours(find_diameter_contours_img, contours, -1, (0, 255, 0), 3)
    display_image_on_canvas(find_diameter_contours_img, canvas)

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
    epsilon = kernel_size / 10

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

    offset_image = image.copy()
    cv2.drawContours(offset_image, contours, -1, (255, 0, 0), 2)
    display_image_on_canvas(offset_image, canvas)

    if max_circularity_contour is not None:
        (x, y), radius = cv2.minEnclosingCircle(max_circularity_contour)
        diameter = 2 * radius
        print(f"Circle with Greatest Circularity - Diameter: {diameter}, Circularity: {max_circularity}")
    else:
        print("No circle with sufficient circularity found.")

    return contours, offset_image


def save_contours_as_dxf(contours, file_name, scale_factor):
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
    print(f"File path '{output_path}' copied to clipboard.")
    
    # Display a message box to notify the user that the file was saved
    messagebox.showinfo("Save Successful", f"File saved successfully: {output_path}")



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
    root = tk.Tk()
    root.title("Image to DXF Converter")
    
    def process_image():
        input_image_path, file_name = select_image()
        if not input_image_path:
            print("No image selected. Exiting.")
            return
        print(f"Processing image: {input_image_path}")
        image = cv2.imread(input_image_path)
        if image is None:
            print("Failed to load image.")
            return
        diameter, threshold_input = find_diameter(input_image_path, root, canvas)
        contours, offset_image = find_contours(input_image_path, diameter, threshold_input, canvas)
        output_dxf_path = save_contours_as_dxf(contours, file_name, 2.005 / diameter)
        print(f"Contours saved to {output_dxf_path}")

    def exit_application():
        root.destroy()

    root.attributes('-fullscreen', True)

    canvas = tk.Canvas(root)
    canvas.pack(fill=tk.BOTH, expand=True)

    button_frame = tk.Frame(root)
    button_frame.pack(side=tk.BOTTOM, pady=20)

    process_button = tk.Button(button_frame, text="Process Image", command=process_image)
    process_button.grid(row=0, column=0, padx=10)

    exit_button = tk.Button(button_frame, text="Exit", command=exit_application)
    exit_button.grid(row=0, column=1, padx=10)

    root.mainloop()

if __name__ == "__main__":
    main()