import cv2
import pickle
import os
from tkinter import Tk
from tkinter.filedialog import askopenfilename

# Path to calibration data
CALIBRATION_FILE = 'calibration_files/calibration_data.pkl'
UNDISTORTED_IMAGES_DIR = '../Design Files'

def load_calibration_data(calibration_file):
    """
    Load calibration data from a file.
    
    Args:
        calibration_file: Path to the calibration data file.
    
    Returns:
        mtx: Camera matrix
        dist: Distortion coefficients
    """
    if not os.path.exists(calibration_file):
        print(f"Calibration file not found: {calibration_file}")
        return None, None
    
    with open(calibration_file, 'rb') as f:
        data = pickle.load(f)
    
    return data['camera_matrix'], data['distortion_coefficients']

def undistort_image(img, mtx, dist):
    """
    Undistort a single image using the calibration data.
    
    Args:
        img: Input image as a numpy array.
        mtx: Camera matrix.
        dist: Distortion coefficients.
    
    Returns:
        dst: Undistorted image as a numpy array.
    """
    h, w = img.shape[:2]
    
    # Refine camera matrix based on free scaling parameter
    newcameramtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))
    
    # Undistort image
    dst = cv2.undistort(img, mtx, dist, None, newcameramtx)
    
    # Crop the image (optional)
    x, y, w, h = roi
    dst = dst[y:y+h, x:x+w]
    
    return dst

def save_image(dst, output_dir, image_name):
    """
    Save the undistorted image to the specified directory.
    
    Args:
        dst: Undistorted image as a numpy array.
        output_dir: Directory to save the undistorted image.
        image_name: Name of the input image file.
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    output_path = os.path.join(output_dir, f'undistorted_{image_name}')
    cv2.imwrite(output_path, dst)
    print(f"Undistorted image saved to: {output_path}")

def main():
    """
    Main function to undistort all .jpg images in the current directory.
    """
    print("Loading calibration data...")
    mtx, dist = load_calibration_data(CALIBRATION_FILE)
    
    if mtx is None or dist is None:
        print("Failed to load calibration data. Exiting.")
        return
    
    # Directory to save undistorted images
    output_dir = UNDISTORTED_IMAGES_DIR
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    # Find all .jpg files in the current directory
    print("Finding .jpg files in the current directory...")
    image_files = [f for f in os.listdir('.') if f.lower().endswith('.jpg')]
    
    if not image_files:
        print("No .jpg files found in the current directory. Exiting.")
        return
    
    for image_file in image_files:
        print(f"Processing {image_file}...")
        img = cv2.imread(image_file)
        if img is None:
            print(f"Failed to read image: {image_file}. Skipping.")
            continue
        
        # Undistort the image
        dst = undistort_image(img, mtx, dist)
        
        # Save the undistorted image
        save_image(dst, output_dir, image_file)

    print("Processing complete. Undistorted images saved to 'undistorted_images' directory.")

if __name__ == "__main__":
    main()
