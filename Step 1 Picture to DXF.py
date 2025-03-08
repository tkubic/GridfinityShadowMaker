from PyQt5 import QtWidgets, QtGui
from src.ui import Ui_MainWindow # type: ignore
from src.processing import find_diameter, find_contours, save_contours_as_dxf, select_image, import_to_openscad, exit_application, clear_canvas, create_main_window, display_image_on_canvas # type: ignore
import cv2
import traceback
from PIL import Image
import threading
import os
from datetime import datetime

def create_main_window():
    MainWindow = QtWidgets.QMainWindow()
    ui = Ui_MainWindow()
    ui.setupUi(MainWindow)
    
    canvas = ui.canvas
    canvas.setScene(QtWidgets.QGraphicsScene())
    
    return (MainWindow, canvas, ui.load_button, ui.process_button, ui.import_button, 
            ui.exit_button, ui.threshold_entry, ui.offset_entry, ui.token_entry, 
            ui.resolution_entry, ui.console_text, ui.comboBox, ui.camera_pushButton, ui.image_name)

def detect_cameras(max_cameras=10):
    index = 0
    arr = []
    while index < max_cameras:
        cap = cv2.VideoCapture(index)
        if not cap.read()[0]:
            break
        else:
            arr.append(f"USB Camera {index}")
        cap.release()
        index += 1
    return arr

def populate_camera_comboBox(comboBox):
    cameras = detect_cameras()
    comboBox.clear()
    if cameras:
        comboBox.addItems(cameras)
    else:
        comboBox.addItem("No USB Camera Detected")

def main():
    global threshold_entry, offset_entry, token_entry, resolution_entry, input_image_path, file_name, console_text, image
    app = QtWidgets.QApplication([])
    window, canvas, load_button, process_button, import_button, exit_button, threshold_entry, offset_entry, token_entry, resolution_entry, console_text, comboBox, camera_pushButton, image_name_input = create_main_window()
    
    # Detect connected USB cameras in a separate thread
    threading.Thread(target=populate_camera_comboBox, args=(comboBox,)).start()

    def load_image():
        global input_image_path, file_name, image
        try:
            clear_canvas(canvas)
            input_image_path, file_name = select_image(console_text)
            if not input_image_path:
                console_text.setText("No image selected. Exiting.")
                return
            console_text.setText(f"Loaded image: {input_image_path}")
            image = cv2.imread(input_image_path)
            if image is None:
                console_text.setText("Failed to load image.")
                return
            display_image_on_canvas(image, canvas, 1, "Original")
            process_image()  # Automatically run process_image after loading the image
        except Exception as e:
            console_text.setText(f"Error loading image: {str(e)}")
            print(traceback.format_exc())

    def capture_image():
        global image, file_name
        try:
            camera_index = comboBox.currentIndex()
            cap = cv2.VideoCapture(camera_index)
            ret, frame = cap.read()
            cap.release()
            if not ret:
                console_text.setText("Failed to capture image from camera.")
                return
            image = frame
            image_name = image_name_input.text().strip()
            if not image_name:
                image_name = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
            file_name = image_name
            # Change image_path to the Pictures folder in the same relative path
            image_path = os.path.join(os.path.dirname(__file__), "Pictures", f"{image_name}.png")
            os.makedirs(os.path.dirname(image_path), exist_ok=True)
            cv2.imwrite(image_path, image)
            console_text.setText(f"Captured image saved as: {image_path}")
            display_image_on_canvas(image, canvas, 1, "Captured")
            process_image()  # Automatically run process_image after capturing the image
        except Exception as e:
            console_text.setText(f"Error capturing image: {str(e)}")
            print(traceback.format_exc())

    def process_image():
        global image
        if image is None:
            console_text.setText("No image loaded. Please load or capture an image first.")
            return
        try:
            clear_canvas(canvas, keep_original=True)
            console_text.setText(f"Processing image.")
            diameter, threshold_input = find_diameter(image, canvas, threshold_entry, offset_entry, token_entry, resolution_entry, console_text)
            if diameter is None or threshold_input is None:
                return  # Return to main loop if the user selects "no"
            contours, offset_image = find_contours(image, diameter, threshold_input, canvas, console_text)
            dxf_path, gridx_size, gridy_size = save_contours_as_dxf(contours, file_name, float(token_entry.text()) / diameter, console_text)
            console_text.setText(f"Processing image\nGrid X Size: {gridx_size}, Grid Y Size: {gridy_size}")
            import_button.setEnabled(True)
            import_button.dxf_path = dxf_path
            import_button.gridx_size = gridx_size
            import_button.gridy_size = gridy_size
            
        except Exception as e:
            console_text.setText(f"Error processing image: {str(e)}")
            print(traceback.format_exc())

    load_button.clicked.connect(load_image)
    process_button.clicked.connect(process_image)
    camera_pushButton.clicked.connect(capture_image)
    import_button.clicked.connect(lambda: import_to_openscad(import_button.dxf_path, import_button.gridx_size, import_button.gridy_size, console_text, file_name))
    exit_button.clicked.connect(lambda: exit_application(console_text))
    
    window.show()
    app.exec_()

if __name__ == "__main__":
    main()
