import os
import shutil
import tempfile
import subprocess
from pathlib import Path

# Configuration
REPO_URL = "https://github.com/tkubic/GridfinityShadowMaker.git"
FILES_TO_COPY = [
    "Step 1 Picture to DXF.py",
    "Step 2 DXF to STL.scad",
    "default_settings.txt"
]
FOLDERS_TO_COPY = [
    "src",
    "raw photos"
]

# Get Desktop path
DESKTOP = str(Path.home() / "Desktop")

def clone_or_pull_repo(repo_url, dest_dir):
    # Always clone into a fresh temp directory, so just clone
    subprocess.run(["git", "clone", repo_url, dest_dir], check=True)

def copy_items(src_dir, dest_dir, files, folders):
    for file in files:
        src_file = os.path.join(src_dir, file)
        dest_file = os.path.join(dest_dir, file)
        if os.path.exists(src_file):
            shutil.copy2(src_file, dest_file)
            print(f"Copied {file}")
        else:
            print(f"File not found in repo: {file}")
    for folder in folders:
        src_folder = os.path.join(src_dir, folder)
        dest_folder = os.path.join(dest_dir, folder)
        if os.path.exists(src_folder):
            # Ensure destination folder exists
            os.makedirs(dest_folder, exist_ok=True)
            for root, dirs, files in os.walk(src_folder):
                rel_path = os.path.relpath(root, src_folder)
                dest_root = os.path.join(dest_folder, rel_path) if rel_path != '.' else dest_folder
                os.makedirs(dest_root, exist_ok=True)
                for file in files:
                    src_file_path = os.path.join(root, file)
                    dest_file_path = os.path.join(dest_root, file)
                    shutil.copy2(src_file_path, dest_file_path)
            print(f"Copied/updated folder {folder}")
        else:
            print(f"Folder not found in repo: {folder}")

def main():
    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"Cloning or updating repo in {tmpdir}...")
        clone_or_pull_repo(REPO_URL, tmpdir)
        print("Copying files and folders to Desktop...")
        copy_items(tmpdir, DESKTOP, FILES_TO_COPY, FOLDERS_TO_COPY)
        # Copy this script to the Desktop as well
        script_path = os.path.abspath(__file__)
        script_name = os.path.basename(script_path)
        dest_script = os.path.join(DESKTOP, script_name)
        shutil.copy2(script_path, dest_script)
        print(f"Copied script itself to Desktop as {script_name}")
        print("Done.")

if __name__ == "__main__":
    main()
