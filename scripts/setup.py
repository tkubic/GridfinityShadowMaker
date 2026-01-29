"""
Cross-platform setup for Gridfinity Shadow Maker.

- Creates a .venv in the repo root (if missing)
- Installs Python dependencies from requirements.txt using the venv python
- Installs npm packages in frontend/ and backend/ if package.json exists

Usage:
  python scripts/setup.py
  python scripts/setup.py --skip-frontend
  python scripts/setup.py --skip-backend
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
import venv

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = REPO_ROOT / ".venv"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    pretty = " ".join(cmd)
    print(f"\n>> {pretty}")
    result = subprocess.run(cmd, cwd=str(cwd or REPO_ROOT))
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def ensure_venv() -> Path:
    if not VENV_DIR.exists():
        print(f"Creating virtual environment at {VENV_DIR}...")
        builder = venv.EnvBuilder(with_pip=True)
        builder.create(VENV_DIR)
    py = venv_python()
    if not py.exists():
        raise SystemExit(f"Venv python not found at {py}")
    return py


def ensure_node() -> str:
    npm_path = shutil.which("npm")
    if not npm_path:
        print("\nNode.js/npm is required before running setup.")
        print("Install Node.js from https://nodejs.org/ and re-run this script.")
        raise SystemExit(1)
    return npm_path


def install_python_deps(py: Path) -> None:
    requirements = REPO_ROOT / "requirements.txt"
    if not requirements.exists():
        print("requirements.txt not found; skipping Python dependency install.")
        return
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([str(py), "-m", "pip", "install", "--prefer-binary", "-r", str(requirements)])


def install_npm_packages(folder: str, npm_path: str) -> None:
    pkg = REPO_ROOT / folder / "package.json"
    if not pkg.exists():
        print(f"No {folder}/package.json; skipping {folder} npm install.")
        return
    lock = REPO_ROOT / folder / "package-lock.json"
    args = [npm_path, "ci"] if lock.exists() else [npm_path, "install"]
    run(args, cwd=REPO_ROOT / folder)


def main() -> int:
    parser = argparse.ArgumentParser(description="GSM cross-platform setup")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip frontend npm install")
    parser.add_argument("--skip-backend", action="store_true", help="Skip backend npm install")
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        print("Python 3.10+ is required.")
        return 1
    if sys.version_info >= (3, 14):
        print("Python 3.14+ is not recommended; use 3.10–3.13 for best compatibility.")

    npm_path = ensure_node()
    py = ensure_venv()
    install_python_deps(py)

    if not args.skip_frontend:
        install_npm_packages("frontend", npm_path)
    if not args.skip_backend:
        install_npm_packages("backend", npm_path)

    print("\nSetup complete.")
    print("Next:")
    print("  - Run: python \"Launch GSM Server.py\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
