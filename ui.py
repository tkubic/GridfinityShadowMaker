from PyQt5 import QtWidgets, QtGui, QtCore
import traceback
import cv2
from PIL import Image

def create_main_window():
    window = QtWidgets.QMainWindow()
    window.setWindowTitle("Image to DXF Converter")
    window.showFullScreen()
    
    central_widget = QtWidgets.QWidget()
    window.setCentralWidget(central_widget)
    layout = QtWidgets.QVBoxLayout(central_widget)
    
    canvas = QtWidgets.QGraphicsView()
    canvas.setScene(QtWidgets.QGraphicsScene())
    canvas.setStyleSheet("border: 2px solid black;")  # Add border to canvas
    layout.addWidget(canvas, stretch=3)
    
    # Create a horizontal layout to place control_frame and console_text side by side
    bottom_layout = QtWidgets.QHBoxLayout()
    layout.addLayout(bottom_layout, stretch=1)
    
    control_frame = QtWidgets.QWidget()
    control_frame.setFixedSize(300, 300)
    control_frame.setStyleSheet("")  # 
    control_layout = QtWidgets.QVBoxLayout(control_frame)
    bottom_layout.addWidget(control_frame)
    
    form_frame = QtWidgets.QWidget()
    form_layout = QtWidgets.QGridLayout(form_frame)
    control_layout.addWidget(form_frame)
    
    load_button = QtWidgets.QPushButton("Load Image")
    load_button.setFixedSize(150, 30)
    load_button.setStyleSheet("")  # Remove border from button
    control_layout.addWidget(load_button)
    load_button.setToolTip("Load an image to process")
    
    form_layout.addWidget(QtWidgets.QLabel("Threshold Input (0-255):"), 0, 0)
    threshold_entry = QtWidgets.QLineEdit("145")
    threshold_entry.setFixedSize(100, 30)
    form_layout.addWidget(threshold_entry, 0, 1)
    
    form_layout.addWidget(QtWidgets.QLabel("Offset (inches):"), 1, 0)
    offset_entry = QtWidgets.QLineEdit("0.1")
    offset_entry.setFixedSize(100, 30)
    form_layout.addWidget(offset_entry, 1, 1)
    
    form_layout.addWidget(QtWidgets.QLabel("Token Size (inches):"), 2, 0)
    token_entry = QtWidgets.QLineEdit("2.000")
    token_entry.setFixedSize(100, 30)
    form_layout.addWidget(token_entry, 2, 1)
    
    form_layout.addWidget(QtWidgets.QLabel("Resolution:"), 3, 0)
    resolution_entry = QtWidgets.QLineEdit("10")
    resolution_entry.setFixedSize(100, 30)
    form_layout.addWidget(resolution_entry, 3, 1)
    
    process_button = QtWidgets.QPushButton("Process Image")
    process_button.setFixedSize(150, 30)
    process_button.setStyleSheet("")  # Remove border from button
    control_layout.addWidget(process_button)
    process_button.setToolTip("Process the loaded image")
    
    import_button = QtWidgets.QPushButton("Import to OpenSCAD")
    import_button.setFixedSize(200, 30)
    import_button.setStyleSheet("")  # Remove border from button
    control_layout.addWidget(import_button)
    import_button.setToolTip("Import the DXF file to OpenSCAD")
    import_button.setEnabled(False)
    
    console_text = QtWidgets.QLabel()
    console_text.setStyleSheet("border: 2px solid black;")  # Add border to console text
    console_text.setWordWrap(True)  # Enable word wrapping
    bottom_layout.addWidget(console_text, stretch=1)  # Set stretch factor to make it expand
    
    exit_button = QtWidgets.QPushButton("Exit")
    exit_button.setFixedSize(150, 30)
    exit_button.setStyleSheet("")  # Remove border from button
    layout.addWidget(exit_button)
    
    return window, canvas, load_button, process_button, import_button, exit_button, threshold_entry, offset_entry, token_entry, resolution_entry, console_text

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
