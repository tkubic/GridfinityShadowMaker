import os
import json
import shutil
import getpass

# Build the directory path relative to the user's home directory
directory = os.path.join(
    os.path.expanduser("~"),
    "AppData", "Roaming", "BambuStudio", "system", "BBL", "process"
)

# Settings for 0.4mm nozzles
settings_0_4mm = {
    "brim_type": "no_brim",
    "sparse_infill_pattern": "cubic",
    "top_shell_layers": "4",
    "wall_generator": "classic",
    "wall_loops": "3"
}

# Settings for 0.6mm nozzles
settings_0_6mm = {
    "brim_type": "no_brim",
    "sparse_infill_pattern": "cubic"
}

PLACEHOLDER = "<USERNAME>"
TEMPLATE_PATH = r"C:\\Users\\<USERNAME>\\AppData\\Roaming\\BambuStudio"

username = getpass.getuser()
user_path = TEMPLATE_PATH.replace(PLACEHOLDER, username)
os.makedirs(user_path, exist_ok=True)

config_files = [
    "BambuStudio.conf",
    "BambuStudio.conf.bak"
]

# Replace username in file contents and copy to the user path
def process_and_copy_file(src_path, dst_path, username):
    with open(src_path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Replace all occurrences of the username with the placeholder
    content = content.replace(username, PLACEHOLDER)
    # Write the placeholder version back to the source directory (optional)
    with open(src_path, 'w', encoding='utf-8') as f:
        f.write(content)
    # Replace the placeholder with the actual username for the destination
    user_content = content.replace(PLACEHOLDER, username)
    with open(dst_path, 'w', encoding='utf-8') as f:
        f.write(user_content)

if __name__ == "__main__":
    # Process config files
    cwd = os.path.dirname(os.path.abspath(__file__))
    for fname in config_files:
        src = os.path.join(cwd, fname)
        dst = os.path.join(user_path, fname)
        process_and_copy_file(src, dst, username)
    print(f"Config files copied to {user_path} with username replaced.")

for filename in os.listdir(directory):
    if filename.endswith(".json") and filename.startswith("0.20mm Standard"):
        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            data.update(settings_0_4mm)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            print(f"Updated: {filename}")
        except Exception as e:
            print(f"Error processing {filename}: {e}")
    elif filename.endswith(".json") and filename.startswith("0.30mm Standard"):
        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            data.update(settings_0_6mm)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            print(f"Updated: {filename}")
        except Exception as e:
            print(f"Error processing {filename}: {e}")
    elif filename.endswith(".json"):
        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["instantiation"] = "false"
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            print(f"Updated: {filename}")
        except Exception as e:
            print(f"Error processing {filename}: {e}")

print("\nAll done! You can now close this window.")
input("\nPress Enter to exit...")