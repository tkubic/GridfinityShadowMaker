r"""
GSM Server Launcher

Single-file launcher that provides the same Dev Server Dashboard UI as the
tools/dev_dashboard.py implementation but copied here so users can double-
click this file without depending on the `tools/` package.

Double-clicking this script will hide the console (Windows) and show only
the GUI. Set `GSM_SHOW_CONSOLE=1` to keep the console visible.
"""

import subprocess
import threading
import queue
import tkinter as tk
from tkinter import ttk
import signal
import os
import sys
import shlex
import re
import webbrowser

# ===========================
# CONFIG: edit or override via env
# ===========================
# Default command strings (repository-relative defaults):
# - Frontend: run Vite dev in the `frontend` folder
# - Backend: run the Node backend server from repo root
DEFAULT_FRONTEND_CMD = r"npm --prefix frontend run dev"
DEFAULT_BACKEND_CMD = r"node backend\\server.js"

# You can override by setting environment variables `GSM_FRONTEND_CMD` and `GSM_BACKEND_CMD`.
FRONTEND_CMD = os.environ.get('GSM_FRONTEND_CMD', DEFAULT_FRONTEND_CMD)
BACKEND_CMD = os.environ.get('GSM_BACKEND_CMD', DEFAULT_BACKEND_CMD)

# Optional: PowerShell executable to wrap scripts (keeps compatibility)
POWERSHELL_EXE = os.environ.get('GSM_POWERSHELL_EXE', 'powershell')


# Helper to coerce a command string into a list for subprocess.Popen
def make_command_list(cmd_str: str):
    """Return a list suitable for Popen depending on the string.
    If cmd_str ends with .ps1 or .psm1 we wrap it with the PowerShell launcher.
    If it looks like a simple command (npm, node) we split it with shlex.
    """
    cs = cmd_str.strip()
    if not cs:
        return []
    lower = cs.lower()
    if lower.endswith('.ps1') or lower.endswith('.psm1'):
        return [POWERSHELL_EXE, "-ExecutionPolicy", "Bypass", "-NoLogo", "-NoProfile", "-File", cs]
    # otherwise split by shell rules (works cross-platform)
    try:
        return shlex.split(cs, posix=(os.name != 'nt'))
    except Exception:
        return [cs]


# Repository root (directory containing this file)
REPO_ROOT = os.path.abspath(os.path.dirname(__file__))


def find_pids_by_port(port: int):
    """Return a list of PIDs listening on the given TCP port (best-effort).
    Uses platform tools: `netstat -ano` on Windows, `lsof` or `ss` on POSIX.
    This is a heuristic helper for cleaning up previously-running servers.
    """
    pids = set()
    try:
        if os.name == 'nt':
            # Try using PowerShell's Get-NetTCPConnection (more reliable)
            try:
                out = subprocess.check_output([
                    'powershell', '-NoProfile', '-Command',
                    f"Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -ExpandProperty OwningProcess"
                ], stderr=subprocess.DEVNULL, text=True)
                for line in out.splitlines():
                    line = line.strip()
                    if line.isdigit():
                        pids.add(int(line))
            except Exception:
                # Fallback to netstat parsing
                cmd = 'netstat -ano -p tcp'
                out = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL, text=True)
                for line in out.splitlines():
                    if f':{port} ' in line or f':{port}\r' in line or line.strip().endswith(f':{port}'):
                        parts = line.split()
                        if parts:
                            pid = parts[-1]
                            if pid.isdigit():
                                pids.add(int(pid))
        else:
            # Try lsof first
            try:
                out = subprocess.check_output(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN'], stderr=subprocess.DEVNULL, text=True)
                for line in out.splitlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 2 and parts[1].isdigit():
                        pids.add(int(parts[1]))
            except Exception:
                # Fallback to ss parsing
                try:
                    out = subprocess.check_output(['ss', '-ltnp'], stderr=subprocess.DEVNULL, text=True)
                    for line in out.splitlines():
                        if f':{port} ' in line or f':{port}\n' in line:
                            m = re.search(r'pid=(\d+),', line)
                            if m:
                                pids.add(int(m.group(1)))
                except Exception:
                    pass
    except subprocess.CalledProcessError:
        pass
    except Exception:
        pass
    return list(pids)


def kill_pids(pids, logger=None):
    """Kill the given PIDs. If `logger` is provided (a ProcessPanel), log actions."""
    for pid in pids:
        try:
            if logger:
                logger.log(f"[Killing process {pid}]\n")
            if os.name == 'nt':
                # Use taskkill for robust termination on Windows; include /T to kill child processes
                try:
                    subprocess.check_call(['taskkill', '/F', '/PID', str(pid), '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if logger:
                        logger.log(f"[Killed {pid}]\n")
                except subprocess.CalledProcessError:
                    if logger:
                        logger.log(f"[taskkill failed for {pid}]\n")
            else:
                try:
                    os.kill(pid, signal.SIGTERM)
                    if logger:
                        logger.log(f"[Sent SIGTERM to {pid}]\n")
                except Exception:
                    try:
                        os.kill(pid, signal.SIGKILL)
                        if logger:
                            logger.log(f"[Sent SIGKILL to {pid}]\n")
                    except Exception:
                        if logger:
                            logger.log(f"[Failed to kill {pid}]\n")
        except Exception:
            if logger:
                logger.log(f"[Failed to kill {pid}]\n")


class ProcessPanel:
    def __init__(self, parent, title):
        self.frame = ttk.Frame(parent)
        self.title_label = ttk.Label(self.frame, text=title, font=("Segoe UI", 10, "bold"))
        self.title_label.pack(anchor="w", padx=4, pady=(4, 0))

        # Text area with monospace font
        self.text = tk.Text(self.frame, wrap="none", height=12, font=("Consolas", 10))
        self.text.pack(fill="both", expand=True, padx=4, pady=4)

        # Vertical scrollbar
        vscroll = ttk.Scrollbar(self.frame, orient="vertical", command=self.text.yview)
        vscroll.pack(side="right", fill="y")
        self.text.configure(yscrollcommand=vscroll.set)

        # Horizontal scrollbar
        hscroll = ttk.Scrollbar(self.frame, orient="horizontal", command=self.text.xview)
        hscroll.pack(side="bottom", fill="x")
        self.text.configure(xscrollcommand=hscroll.set)

        self.text.config(state="disabled")

        self.process = None
        self.stdout_thread = None
        self.stderr_thread = None
        self.queue = queue.Queue()

    def log(self, message: str):
        """Append text to the panel safely from the main thread."""
        self.text.config(state="normal")
        self.text.insert("end", message)
        self.text.see("end")
        self.text.config(state="disabled")

    def _reader_thread(self, stream, prefix=""):
        try:
            # stream is opened in binary mode; read bytes and decode here.
            for raw in iter(stream.readline, b''):
                if not raw:
                    break
                # Attempt to decode as UTF-8 first
                try:
                    s = raw.decode('utf-8', errors='replace')
                except Exception:
                    try:
                        s = raw.decode('cp1252', errors='replace')
                    except Exception:
                        s = raw.decode('utf-8', errors='replace')

                # Heuristic: if decoded text contains mojibake sequences like
                # 'â' or 'Ã' which often indicate the bytes were UTF-8 but
                # previously decoded as cp1252, try to repair by round-tripping
                # through cp1252->utf-8.
                if re.search(r'[\u00C2\u00E2\u00C3]', s):
                    try:
                        repaired = s.encode('cp1252', errors='replace').decode('utf-8', errors='replace')
                        # If repaired seems better (fewer replacement chars), use it
                        if repaired.count('\ufffd') <= s.count('\ufffd'):
                            s = repaired
                    except Exception:
                        pass

                self.queue.put(prefix + s)
        except Exception as e:
            try:
                self.queue.put(f"[ERROR reading stream: {e}]\n")
            except Exception:
                pass

    def _start_reader_threads(self):
        if not self.process:
            return
        self.stdout_thread = threading.Thread(
            target=self._reader_thread, args=(self.process.stdout, ''), daemon=True
        )
        self.stderr_thread = threading.Thread(
            target=self._reader_thread, args=(self.process.stderr, '[ERR] '), daemon=True
        )
        self.stdout_thread.start()
        self.stderr_thread.start()

    def clear_logs(self):
        """Clear the text area contents."""
        self.text.config(state="normal")
        self.text.delete('1.0', 'end')
        self.text.config(state="disabled")

    def start_process(self, command_list):
        """Start a new process and hook output into this panel."""
        self.stop_process()

        self.log('\n' + '='*28 + '\n')
        self.log(f"Starting: {' '.join(command_list)}\n")
        self.log('='*28 + '\n')

        creationflags = 0
        popen_kwargs = {
            # Read binary and decode ourselves so we can robustly handle
            # different encodings and recover from mojibake (UTF-8 vs CP1252 issues).
            'stdout': subprocess.PIPE,
            'stderr': subprocess.PIPE,
            'stdin': subprocess.DEVNULL,
            'bufsize': 1,
            'cwd': REPO_ROOT,
        }
        if os.name == 'nt':
            # Prevent console windows from popping up for child console apps
            # when this dashboard is running without a console (pythonw).
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
            try:
                creationflags |= subprocess.CREATE_NO_WINDOW
            except Exception:
                # Some Python builds may not define CREATE_NO_WINDOW; ignore
                pass
            popen_kwargs['creationflags'] = creationflags

        try:
            # Try direct exec first (preferred)
            self.process = subprocess.Popen(command_list, **popen_kwargs)
        except FileNotFoundError as e:
            # On Windows it's common that tools like `npm` are available via the
            # user's shell but not directly visible to the Python process. Try
            # falling back to launching via the shell (cmd /c on Windows or
            # sh -c on POSIX).
            try:
                cmd_str = ' '.join(command_list)
                self.log(f"[Direct exec failed, retrying via shell: {cmd_str}]\n")
                if os.name == 'nt':
                    # Use cmd.exe /c so PATH resolution behaves like a normal shell
                    self.process = subprocess.Popen(cmd_str, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, bufsize=1, creationflags=creationflags, shell=True, cwd=REPO_ROOT)
                else:
                    self.process = subprocess.Popen(cmd_str, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, bufsize=1, shell=True, cwd=REPO_ROOT)
            except Exception as e2:
                self.log(f"[Failed to start process via shell: {e2}]\n")
                self.process = None
                return
        except Exception as e:
            self.log(f"[Failed to start process: {e}]\n")
            self.process = None
            return

        self._start_reader_threads()

    def stop_process(self):
        """Terminate the running process if there is one."""
        if self.process and self.process.poll() is None:
            self.log('\n[Stopping process...]\n')
            try:
                if os.name == 'nt':
                    # Try graceful CTRL_BREAK
                    try:
                        self.process.send_signal(signal.CTRL_BREAK_EVENT)
                    except Exception:
                        pass
                else:
                    try:
                        self.process.terminate()
                    except Exception:
                        pass
            except Exception:
                pass

            try:
                self.process.wait(timeout=5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass

            self.log('[Process stopped]\n')

        self.process = None

    def poll_queue(self):
        try:
            while True:
                msg = self.queue.get_nowait()
                # Strip ANSI escape sequences (color codes) so the tkinter Text
                # widget shows plain readable output instead of escape codes or
                # mojibake from colored terminal output.
                try:
                    ansi_re = getattr(self, '_ansi_re', None)
                    if ansi_re is None:
                        # Robust ANSI escape regex (covers CSI and other sequences)
                        self._ansi_re = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
                        ansi_re = self._ansi_re
                    msg = ansi_re.sub('', msg)
                except Exception:
                    # If regex fails for any reason, fall back to raw message
                    pass
                self.log(msg)
        except queue.Empty:
            pass


class TerminalDashboardApp:
    def __init__(self, root):
        self.root = root
        root.title("GSM Server Dashboard")

        # Attempt to set the window icon to assets/GSM.ico if available
        try:
            ico = os.path.join(REPO_ROOT, 'assets', 'GSM.ico')
            if os.path.exists(ico):
                root.iconbitmap(ico)
        except Exception:
            pass

        # Allow a 2x2 grid: two rows and two columns both grow
        root.rowconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)
        root.columnconfigure(0, weight=1)
        root.columnconfigure(1, weight=1)

        # Left panes: use a vertical split that will occupy the left column
        # of a 2x2 grid (rows 0..1, column 0)
        left_pane = ttk.PanedWindow(root, orient="vertical")
        left_pane.grid(row=0, column=0, rowspan=2, sticky="nsew")

        self.frontend_panel = ProcessPanel(left_pane, "Frontend Server")
        self.backend_panel = ProcessPanel(left_pane, "Backend Server")

        left_pane.add(self.frontend_panel.frame, weight=1)
        left_pane.add(self.backend_panel.frame, weight=1)

        # Right controls: split into two stacked rows so they align with left pane halves
        right_frame = ttk.Frame(root, padding=10)
        right_frame.grid(row=0, column=1, rowspan=2, sticky="nsew")
        right_frame.columnconfigure(0, weight=1)
        right_frame.rowconfigure(0, weight=1)
        right_frame.rowconfigure(1, weight=1)

        # Top-right container: Controls header, Start bar, Frontend controls
        top_container = ttk.Frame(right_frame)
        top_container.grid(row=0, column=0, sticky='nsew')
        top_container.columnconfigure(0, weight=1)

        ttk.Label(top_container, text="Controls", font=("Segoe UI", 11, "bold")).grid(row=0, column=0, sticky='nw', pady=(0, 6))

        top_bar = ttk.Frame(top_container)
        top_bar.grid(row=1, column=0, sticky='ew', pady=(0, 8))
        top_bar.columnconfigure(0, weight=1)
        btn_start_servers = ttk.Button(top_bar, text="Start Servers", command=self.start_servers)
        btn_start_servers.grid(row=0, column=0, sticky='w', padx=(0,6))
        status_frame = ttk.Frame(top_bar)
        status_frame.grid(row=0, column=1, sticky='e')
        self._status_canvas = tk.Canvas(status_frame, width=14, height=14, highlightthickness=0)
        self._status_canvas.grid(row=0, column=0, padx=(0,6))
        self._status_indicator = self._status_canvas.create_oval(2, 2, 12, 12, fill='red')
        ttk.Label(status_frame, text="Server Status").grid(row=0, column=1)

        top_controls = ttk.LabelFrame(top_container, text="Frontend")
        top_controls.grid(row=2, column=0, sticky='nsew', padx=(0,6), pady=(4,8))
        top_controls.columnconfigure(0, weight=1)
        btn_restart_frontend = ttk.Button(top_controls, text="Restart Frontend", command=self.restart_frontend)
        btn_restart_frontend.pack(fill="x", pady=4, padx=6)
        btn_stop_frontend = ttk.Button(top_controls, text="Stop Frontend", command=self.stop_frontend)
        btn_stop_frontend.pack(fill="x", pady=4, padx=6)
        btn_clear_frontend = ttk.Button(top_controls, text="Clear Frontend Log", command=self.clear_frontend)
        btn_clear_frontend.pack(fill="x", pady=(0,4), padx=6)

        # Bottom-right container: Backend controls and launch/help
        bottom_container = ttk.Frame(right_frame)
        bottom_container.grid(row=1, column=0, sticky='nsew')
        bottom_container.columnconfigure(0, weight=1)

        bottom_controls = ttk.LabelFrame(bottom_container, text="Backend")
        bottom_controls.grid(row=0, column=0, sticky='nsew', pady=(4,8))
        bottom_controls.columnconfigure(0, weight=1)
        btn_restart_backend = ttk.Button(bottom_controls, text="Restart Backend", command=self.restart_backend)
        btn_restart_backend.pack(fill="x", pady=4, padx=6)
        btn_stop_backend = ttk.Button(bottom_controls, text="Stop Backend", command=self.stop_backend)
        btn_stop_backend.pack(fill="x", pady=4, padx=6)
        btn_clear_backend = ttk.Button(bottom_controls, text="Clear Backend Log", command=self.clear_backend)
        btn_clear_backend.pack(fill="x", pady=(0,4), padx=6)

        # Launch button and helper text placed under backend controls, aligned with bottom-right
        btn_launch = ttk.Button(bottom_container, text="Launch App", command=self.launch_app)
        btn_launch.grid(row=1, column=0, sticky='sew', pady=(6, 4))
        ttk.Label(bottom_container, text="(Uses PowerShell scripts or commands)", font=("Segoe UI", 8)).grid(row=2, column=0, sticky='nw', pady=(6, 0))

        # Launch button placed below controls
        btn_launch = ttk.Button(right_frame, text="Launch App", command=self.launch_app)
        btn_launch.grid(row=4, column=0, sticky='sew', pady=(6, 4))

        ttk.Label(right_frame, text="(Uses PowerShell scripts or commands)", font=("Segoe UI", 8)).grid(row=5, column=0, sticky='nw', pady=(6, 0))

        # Poll queues
        self._schedule_queue_poll()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _schedule_queue_poll(self):
        self.frontend_panel.poll_queue()
        self.backend_panel.poll_queue()
        self._update_status()
        self.root.after(100, self._schedule_queue_poll)

    def _update_status(self):
        """Update the server status indicator: green when both servers are running."""
        try:
            fproc = self.frontend_panel.process
            bproc = self.backend_panel.process
            running = (fproc is not None and fproc.poll() is None) and (bproc is not None and bproc.poll() is None)
            color = 'green' if running else 'red'
            try:
                self._status_canvas.itemconfig(self._status_indicator, fill=color)
            except Exception:
                pass
        except Exception:
            pass

    def start_frontend(self):
        cmd_list = make_command_list(FRONTEND_CMD)
        if not cmd_list:
            self.frontend_panel.log("[No frontend command configured]\n")
            return
        # If this is a PowerShell script path and it doesn't exist, warn instead of starting
        raw = FRONTEND_CMD.strip()
        if raw.lower().endswith('.ps1') and not os.path.exists(raw):
            # Resolve relative paths against the repo root
            candidate = os.path.join(REPO_ROOT, raw)
            if raw.lower().endswith('.ps1') and not os.path.exists(candidate):
                self.frontend_panel.log(f"[PowerShell script not found: {raw}]\n")
                self.frontend_panel.log("Set the environment variable GSM_FRONTEND_CMD to a valid script path or command.\n")
                return
            else:
                cmd_list = make_command_list(candidate)
        self.frontend_panel.start_process(cmd_list)

    def stop_frontend(self):
        self.frontend_panel.stop_process()

    def clear_frontend(self):
        self.frontend_panel.clear_logs()

    def restart_frontend(self):
        self.frontend_panel.start_process(make_command_list(FRONTEND_CMD))

    def stop_backend(self):
        self.backend_panel.stop_process()

    def clear_backend(self):
        self.backend_panel.clear_logs()

    def start_backend(self):
        cmd_list = make_command_list(BACKEND_CMD)
        if not cmd_list:
            self.backend_panel.log("[No backend command configured]\n")
            return
        raw = BACKEND_CMD.strip()
        if raw.lower().endswith('.ps1') and not os.path.exists(raw):
            candidate = os.path.join(REPO_ROOT, raw)
            if raw.lower().endswith('.ps1') and not os.path.exists(candidate):
                self.backend_panel.log(f"[PowerShell script not found: {raw}]\n")
                self.backend_panel.log("Set the environment variable GSM_BACKEND_CMD to a valid script path or command.\n")
                return
            else:
                cmd_list = make_command_list(candidate)
        self.backend_panel.start_process(cmd_list)

    def restart_backend(self):
        self.backend_panel.start_process(make_command_list(BACKEND_CMD))

    def start_servers(self):
        """Start both frontend and backend servers."""
        try:
            self.frontend_panel.log('[Starting both servers]\n')
        except Exception:
            pass

        # Kill any existing processes listening on the expected ports
        # Frontend default port: 5173, Backend default port: 5000
        try:
            f_pids = find_pids_by_port(5173)
            b_pids = find_pids_by_port(5000)
            if f_pids:
                self.frontend_panel.log(f"[Found existing frontend PIDs on 5173: {f_pids}]\n")
                kill_pids(f_pids, logger=self.frontend_panel)
            if b_pids:
                self.backend_panel.log(f"[Found existing backend PIDs on 5000: {b_pids}]\n")
                kill_pids(b_pids, logger=self.backend_panel)
        except Exception:
            pass

        # Start frontend then backend
        try:
            self.start_frontend()
        except Exception:
            pass
        try:
            self.start_backend()
        except Exception:
            pass

    def launch_app(self):
        url = os.environ.get('GSM_LAUNCH_URL', 'http://localhost:5173/')
        try:
            webbrowser.open(url)
            # Log to frontend panel to give feedback
            self.frontend_panel.log(f"[Opening browser: {url}]\n")
        except Exception as e:
            self.frontend_panel.log(f"[Failed to open browser: {e}]\n")


    def on_close(self):
        self.frontend_panel.stop_process()
        self.backend_panel.stop_process()
        self.root.destroy()


def main():
    # On Windows, prefer to run under pythonw (no console) when double-clicked.
    # If we detect we're running under a console-backed python.exe and the
    # user hasn't requested to keep the console, attempt to relaunch with
    # pythonw.exe located next to the current interpreter. We set an env
    # marker to avoid relaunch loops.
    if sys.platform.startswith("win"):
        try:
            if os.environ.get('GSM_SHOW_CONSOLE', '') != '1' and os.environ.get('GSM_RELAUNCHED', '') != '1':
                exe = sys.executable or ''
                exe_lower = exe.lower()
                # If we're already running under pythonw, skip relaunch.
                if exe_lower.endswith('python.exe'):
                    pythonw = os.path.join(os.path.dirname(exe), 'pythonw.exe')
                    if os.path.exists(pythonw):
                        # Relaunch using pythonw so no console window is created.
                        new_env = os.environ.copy()
                        new_env['GSM_RELAUNCHED'] = '1'
                        try:
                            subprocess.Popen([pythonw, os.path.abspath(__file__)] + sys.argv[1:], env=new_env, cwd=REPO_ROOT, close_fds=True)
                            # Exit the console-backed process immediately.
                            return
                        except Exception:
                            # Fall back to hiding the console below if relaunch fails.
                            pass

            # If we couldn't relaunch with pythonw, keep the old behaviour of
            # hiding the console window via Win32 API (may still show briefly).
            try:
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("DevServerDashboard")
            except Exception:
                pass

            try:
                show_console = os.environ.get('GSM_SHOW_CONSOLE', '') == '1'
                if not show_console:
                    h = ctypes.windll.kernel32.GetConsoleWindow()
                    if h:
                        SW_HIDE = 0
                        ctypes.windll.user32.ShowWindow(h, SW_HIDE)
            except Exception:
                pass
        except Exception:
            # If anything goes wrong here, don't prevent the GUI from starting.
            pass

    root = tk.Tk()
    app = TerminalDashboardApp(root)
    root.geometry('1100x700')
    root.mainloop()


if __name__ == "__main__":
    main()
