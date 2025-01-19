from PyQt5 import QtWidgets
from ui import create_main_window, display_image_on_canvas
from processing import find_diameter, find_contours, save_contours_as_dxf, select_image, import_to_openscad, exit_application, clear_canvas
import cv2
import traceback

def main():
    global threshold_entry, offset_entry, token_entry, resolution_entry, input_image_path, file_name, console_text
    app = QtWidgets.QApplication([])
    window, canvas, load_button, process_button, import_button, exit_button, threshold_entry, offset_entry, token_entry, resolution_entry, console_text = create_main_window()
    
    def load_image():
        global input_image_path, file_name
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
        except Exception as e:
            console_text.setText(f"Error loading image: {str(e)}")
            print(traceback.format_exc())

    def process_image():
        if not input_image_path:
            console_text.setText("No image loaded. Please load an image first.")
            return
        try:
            clear_canvas(canvas, keep_original=True)
            console_text.setText(f"Processing image: {input_image_path}")
            diameter, threshold_input = find_diameter(input_image_path, canvas, threshold_entry, offset_entry, token_entry, resolution_entry, console_text)
            if diameter is None or threshold_input is None:
                return  # Return to main loop if the user selects "no"
            contours, offset_image = find_contours(input_image_path, diameter, threshold_input, canvas, console_text)
            dxf_path, gridx_size, gridy_size = save_contours_as_dxf(contours, file_name, 2.005 / diameter, console_text)
            console_text.setText(f"Processing image: {input_image_path}\nGrid X Size: {gridx_size}, Grid Y Size: {gridy_size}")
            import_button.setEnabled(True)
            import_button.dxf_path = dxf_path
            import_button.gridx_size = gridx_size
            import_button.gridy_size = gridy_size
            
        except Exception as e:
            console_text.setText(f"Error processing image: {str(e)}")
            print(traceback.format_exc())

    load_button.clicked.connect(load_image)
    process_button.clicked.connect(process_image)
    import_button.clicked.connect(lambda: import_to_openscad(import_button.dxf_path, import_button.gridx_size, import_button.gridy_size, console_text, file_name))
    exit_button.clicked.connect(lambda: exit_application(console_text))
    
    window.show()
    app.exec_()

if __name__ == "__main__":
    main()
