# Camera Calibration and Image Undistortion Guide

This guide will help you calibrate your camera and undistort your images for accurate results.

## Camera Calibration

1. **Print the Calibration Pattern**  
   - Locate the `pattern.png` file in the `calibration_files` directory.
   - Print the pattern on a standard sheet of paper.

2. **Capture Calibration Photos**  
   - Take at least 8 photos of the printed checkerboard pattern in various orientations.  
   - Ensure 2-3 of these photos are taken with the checkerboard propped up at an angle.  
     - You can use a clipboard and a 2-4 inch block to prop up different ends of the checkerboard.

3. **Prepare Calibration Images**  
   - Save all captured images as `.jpg` files.
   - Place these images in the `calibration_files` directory.

4. **Run the Calibration Script**  
   - Execute the `camera_calibration.py` script.   
   - Compare the undistorted images with the raw versions to ensure successful calibration.

## Image Undistortion

1. **Prepare Raw Images**  
   - Place all raw images to be undistorted in the `raw photos` folder as `.jpg` files.  
   - **Important:** Do not crop or alter the raw images in any way. The calibration only works on unaltered images directly from the camera.

2. **Run the Undistortion Script**  
   - Execute the `undistort_image.py` script.  
   - The undistorted images will be saved in the `Design Files` folder.

Follow these steps to ensure accurate calibration and undistortion of your images.
