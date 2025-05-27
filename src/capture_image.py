import cv2
import os
import pickle
import sys
import time
import numpy as np
from PyQt5 import QtWidgets, QtGui, QtCore
from capture_image_ui import Ui_Dialog
import subprocess
import threading
import contextlib

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
CALIBRATION_FILE = os.path.join(PROJECT_ROOT, 'raw photos', 'calibration_files', 'calibration_data.pkl')
SETTINGS_CACHE = os.path.join(PROJECT_ROOT, "camera_settings_cache.pkl")

def load_calibration_data(calibration_file):
    if not os.path.exists(calibration_file):
        print(f"Calibration file not found: {calibration_file}")
        return None, None
    with open(calibration_file, 'rb') as f:
        data = pickle.load(f)
    return data['camera_matrix'], data['distortion_coefficients']

def undistort_image(img, mtx, dist):
    # If calibration data is missing, return the raw image
    if mtx is None or dist is None:
        return img
    h, w = img.shape[:2]
    newcameramtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))
    dst = cv2.undistort(img, mtx, dist, None, newcameramtx)
    x, y, w, h = roi
    dst = dst[y:y+h, x:x+w]
    return dst

@contextlib.contextmanager
def suppress_stderr():
    """Context manager to suppress stderr (for OpenCV warnings)."""
    import sys, os
    stderr = sys.stderr
    devnull = open(os.devnull, 'w')
    sys.stderr = devnull
    try:
        yield
    finally:
        sys.stderr = stderr
        devnull.close()

def try_read_frame(cap, timeout=2.0):
    """Try to read a frame from cap with a timeout (in seconds)."""
    result = {'ret': False, 'frame': None}
    def grab():
        result['ret'], result['frame'] = cap.read()
    t = threading.Thread(target=grab)
    t.start()
    t.join(timeout)
    if t.is_alive():
        return False, None
    return result['ret'], result['frame']

def find_available_cameras(max_test=5, open_timeout=2.0, read_timeout=1.5):
    """
    Try to open each camera index up to max_test.
    Skip indices that hang or error by using timeouts.
    Suppress OpenCV warnings during detection.
    """
    available = []
    for i in range(max_test):
        cap = None
        try:
            with suppress_stderr():
                start_time = time.time()
                cap = cv2.VideoCapture(i)
                while not cap.isOpened() and (time.time() - start_time) < open_timeout:
                    time.sleep(0.1)
                if not cap.isOpened():
                    continue
                # Try to read a frame with a timeout using a thread
                ret, _ = try_read_frame(cap, timeout=read_timeout)
                if ret:
                    print(f"Found camera at index {i}")
                    available.append(i)
        except Exception as e:
            print(f"Camera index {i} caused an exception: {e}")
        finally:
            if cap is not None:
                cap.release()
    return available

def cache_camera_settings(idx, width, height):
    try:
        with open(SETTINGS_CACHE, "wb") as f:
            pickle.dump({"idx": idx, "width": width, "height": height}, f)
    except Exception as e:
        print(f"Could not cache camera settings: {e}")

def load_cached_camera_settings():
    if os.path.exists(SETTINGS_CACHE):
        try:
            with open(SETTINGS_CACHE, "rb") as f:
                return pickle.load(f)
        except Exception:
            pass
    return None

def open_camera(idx, width=None, height=None):
    cap = cv2.VideoCapture(idx)
    if not cap.isOpened():
        print(f"Failed to open camera {idx}.")
        return None

    if width and height:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera {idx} set to cached resolution: {actual_width}x{actual_height}")
        return cap

    preferred_resolutions = [
        (3264, 2448),  # 8MP
        (3840, 2160),  # 4K UHD
        (2560, 1440),
        (1920, 1080),
        (1280, 720),
        (1024, 768),
        (800, 600),
        (640, 480)
    ]
    for width, height in preferred_resolutions:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        for _ in range(5):
            actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if abs(actual_width - width) <= 16 and abs(actual_height - height) <= 16:
            print(f"Camera {idx} set to resolution: {actual_width}x{actual_height}")
            cache_camera_settings(idx, actual_width, actual_height)
            break
    else:
        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera {idx} using default resolution: {actual_width}x{actual_height}")
        cache_camera_settings(idx, actual_width, actual_height)

    return cap

def get_save_folder(project_folder):
    if project_folder is None:
        save_folder = os.path.join(PROJECT_ROOT, "project")
    else:
        save_folder = project_folder
    if not os.path.exists(save_folder):
        os.makedirs(save_folder)
    return save_folder

def find_photos(folder):
    return [f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.jpeg', '.png')) and f.startswith('_')]

def open_in_paint(filepath):
    try:
        subprocess.Popen(['mspaint', filepath])
    except Exception as e:
        QtWidgets.QMessageBox.critical(None, "Error", f"Could not open image in Paint: {e}")

class CaptureImageDialog(QtWidgets.QDialog):
    def __init__(self, save_folder, parent=None):
        super().__init__(parent)
        self.ui = Ui_Dialog()
        self.ui.setupUi(self)
        self.save_folder = save_folder
        self.img_counter = 0
        self.cameras = find_available_cameras()
        self.cam_pos = len(self.cameras) - 1 if self.cameras else 0
        self.current_cam_idx = self.cameras[self.cam_pos] if self.cameras else 0
        self.cap = None
        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self.update_frame)
        self.mtx, self.dist = load_calibration_data(CALIBRATION_FILE)
        self.cached = load_cached_camera_settings()
        self.setWindowTitle("Capture Image")
        self.running = True
        self.failed_frame_count = 0  # Track consecutive frame failures
        self.max_failed_frames = 1   # Switch camera after this many failures

        # Connect UI signals
        self.ui.buttonCaptureImage.clicked.connect(self.capture_image)
        self.ui.buttonSwitchCamera.clicked.connect(self.switch_camera)
        self.ui.buttonQuit.clicked.connect(self.quit_app)
        self.ui.lineeditImageName.textChanged.connect(self.toggle_capture_button)
        self.ui.buttonEditImage.clicked.connect(self.edit_selected)
        self.ui.buttonReloadList.clicked.connect(self.reload_image_list)

        # Keyboard shortcuts
        self.shortcut_quit = QtWidgets.QShortcut(QtGui.QKeySequence("q"), self)
        self.shortcut_quit.activated.connect(self.quit_app)
        self.shortcut_switch = QtWidgets.QShortcut(QtGui.QKeySequence("c"), self)
        self.shortcut_switch.activated.connect(self.switch_camera)
        self.shortcut_capture = QtWidgets.QShortcut(QtGui.QKeySequence("Space"), self)
        self.shortcut_capture.activated.connect(self.capture_image)

        self.toggle_capture_button()  # Initial state
        self.open_camera_and_start()
        self.reload_image_list()

    def toggle_capture_button(self):
        self.ui.buttonCaptureImage.setEnabled(bool(self.ui.lineeditImageName.text().strip()))

    def open_camera_and_start(self):
        if self.cap:
            self.cap.release()
        if not self.cameras:
            QtWidgets.QMessageBox.critical(self, "Error", "No cameras available.")
            self.reject()
            return
        self.cap = open_camera(self.current_cam_idx)
        if self.cap is None:
            QtWidgets.QMessageBox.critical(self, "Error", "Failed to open camera.")
            self.reject()
            return
        self.timer.start(30)

    def update_frame(self):
        # Try to read a frame with a timeout
        ret, frame = try_read_frame(self.cap, timeout=2.0)
        if not ret:
            self.failed_frame_count += 1
            if self.failed_frame_count >= self.max_failed_frames:
                print("Frame grab failed or timed out, switching camera.")
                self.switch_camera()
                self.failed_frame_count = 0
            return
        self.failed_frame_count = 0
        undistorted = undistort_image(frame, self.mtx, self.dist)
        # Resize for display
        display_size = (self.ui.canvasCamera.width(), self.ui.canvasCamera.height())
        h, w = undistorted.shape[:2]
        scale = min(display_size[0] / w, display_size[1] / h)
        disp_w, disp_h = int(w * scale), int(h * scale)
        undistorted_disp = cv2.resize(undistorted, (disp_w, disp_h), interpolation=cv2.INTER_AREA)
        # Convert to QImage and display
        rgb_image = cv2.cvtColor(undistorted_disp, cv2.COLOR_BGR2RGB)
        qimg = QtGui.QImage(rgb_image.data, rgb_image.shape[1], rgb_image.shape[0], rgb_image.strides[0], QtGui.QImage.Format_RGB888)
        pixmap = QtGui.QPixmap.fromImage(qimg)
        scene = QtWidgets.QGraphicsScene()
        scene.addPixmap(pixmap)
        self.ui.canvasCamera.setScene(scene)
        self.ui.canvasCamera.fitInView(scene.itemsBoundingRect(), QtCore.Qt.KeepAspectRatio)

    def capture_image(self):
        if not self.cap or not self.cap.isOpened():
            return
        ret, frame = self.cap.read()
        if not ret:
            QtWidgets.QMessageBox.warning(self, "Error", "Failed to capture image.")
            return
        undistorted = undistort_image(frame, self.mtx, self.dist)
        image_name = self.ui.lineeditImageName.text().strip()
        if not image_name:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"_capture_{timestamp}_{self.img_counter}.jpg"
        else:
            filename = f"_{image_name}.jpg"
        save_path = os.path.join(self.save_folder, filename)
        cv2.imwrite(save_path, undistorted)
        # Use labelConsole instead of popup
        self.ui.labelConsole.setText(f"Saved image: {save_path}")
        self.img_counter += 1
        # Clear and disable after capture
        self.ui.lineeditImageName.clear()
        self.ui.buttonCaptureImage.setEnabled(False)
        self.reload_image_list()  # Reload the image list after saving

    def switch_camera(self):
        if not self.cameras:
            return
        self.cap.release()
        self.cam_pos = (self.cam_pos + 1) % len(self.cameras)
        self.current_cam_idx = self.cameras[self.cam_pos]
        self.cap = open_camera(self.current_cam_idx)

    def quit_app(self):
        self.running = False
        self.timer.stop()
        if self.cap:
            self.cap.release()
        self.accept()

    def reload_image_list(self):
        # Populate the listImages QListView with unedited images
        from PyQt5.QtCore import QStringListModel
        photos = find_photos(self.save_folder)
        self.photo_list = photos
        model = QStringListModel(photos)
        self.ui.listImages.setModel(model)

    def edit_selected(self):
        # Get selected image from listImages and open in Paint after renaming
        index = self.ui.listImages.currentIndex()
        if not index.isValid():
            QtWidgets.QMessageBox.warning(self, "No Selection", "Please select a photo to edit.")
            return
        filename = self.photo_list[index.row()]
        filepath = os.path.join(self.save_folder, filename)
        new_filename = filename[1:] if filename.startswith('_') else filename
        new_filepath = os.path.join(self.save_folder, new_filename)
        try:
            os.rename(filepath, new_filepath)
            self.reload_image_list()
            open_in_paint(new_filepath)
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Error", f"Could not rename or open image: {e}")

def main(project_folder=None):
    # Enable high DPI scaling for better text/UI scaling on Windows
    if hasattr(QtCore.Qt, 'AA_EnableHighDpiScaling'):
        QtWidgets.QApplication.setAttribute(QtCore.Qt.AA_EnableHighDpiScaling, True)
    if hasattr(QtCore.Qt, 'AA_UseHighDpiPixmaps'):
        QtWidgets.QApplication.setAttribute(QtCore.Qt.AA_UseHighDpiPixmaps, True)
    app = QtWidgets.QApplication(sys.argv)
    save_folder = get_save_folder(project_folder)
    dlg = CaptureImageDialog(save_folder)
    dlg.exec_()

if __name__ == "__main__":
    project_folder = sys.argv[1] if len(sys.argv) > 1 else None
    main(project_folder)
