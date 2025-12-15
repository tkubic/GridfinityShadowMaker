const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync, spawnSync } = require('child_process');

const app = express();
const REPO_ROOT = path.join(__dirname, '..');
const CALIB_PKL_PATH = path.join(__dirname, '..', 'raw photos', 'calibration_files', 'calibration_data.pkl');
const CALIB_JSON_PATH = path.join(__dirname, '..', 'raw photos', 'calibration_files', 'calibration_data.json');
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.gif', '.webp'];

function sanitizeProjectName(raw) {
  if (!raw) return 'project';
  const cleaned = String(raw).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || 'project';
}

function sanitizeFilenameBase(raw) {
  if (!raw) return '';
  return String(raw).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').trim();
}

function ensureProjectFolder(projectName) {
  const folder = resolveProjectFolder(projectName);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function parseDataUrlToBuffer(dataUrl, explicitMime) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  let mime = explicitMime || null;
  let payload = trimmed;
  const m = /^data:([^;,]+)?;base64,(.+)$/i.exec(trimmed);
  if (m) {
    mime = m[1] || mime;
    payload = m[2];
  }
  if (!payload) return null;
  try {
    const buf = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
    const ext = (mime || '').toLowerCase().includes('png') ? '.png'
      : (mime || '').toLowerCase().includes('jpeg') ? '.jpg'
      : (mime || '').toLowerCase().includes('jpg') ? '.jpg'
      : (mime || '').toLowerCase().includes('bmp') ? '.bmp'
      : (mime || '').toLowerCase().includes('webp') ? '.webp'
      : (mime || '').toLowerCase().includes('gif') ? '.gif'
      : (mime || '').toLowerCase().includes('tif') ? '.tif'
      : '.png';
    return { buffer: buf, mime: mime || 'image/png', ext };
  } catch (e) {
    console.error('Failed to parse data URL payload', e);
    return null;
  }
}

let cachedCalibration = { mtime: 0, data: null };
function loadCalibrationData() {
  try {
    const candidates = [];
    if (fs.existsSync(CALIB_JSON_PATH)) candidates.push({ path: CALIB_JSON_PATH, type: 'json' });
    if (fs.existsSync(CALIB_PKL_PATH)) candidates.push({ path: CALIB_PKL_PATH, type: 'pkl' });
    if (!candidates.length) return null;
    const chosen = candidates[0];
    const stat = fs.statSync(chosen.path);
    const mtime = stat.mtimeMs || stat.ctimeMs || Date.now();
    if (cachedCalibration.data && cachedCalibration.mtime === mtime) return cachedCalibration.data;

    let data = null;
    if (chosen.type === 'json') {
      const raw = fs.readFileSync(chosen.path, 'utf8');
      data = JSON.parse(raw);
    } else {
      const python = findPythonCmd(REPO_ROOT);
      if (!python) return null;
      const script = [
        'import pickle, json, numpy as np',
        'from pathlib import Path',
        'p = Path(' + JSON.stringify(CALIB_PKL_PATH.replace(/\\/g, '\\\\')) + ')',
        'data = pickle.load(open(p, "rb"))',
        'def normalize(x):',
        '    if isinstance(x, np.ndarray):',
        '        return normalize(x.tolist())',
        '    if isinstance(x, dict):',
        '        return {k: normalize(v) for k, v in x.items()}',
        '    if isinstance(x, (list, tuple)):',
        '        return [normalize(v) for v in x]',
        '    try:',
        '        return normalize(x.tolist())',
        '    except Exception:',
        '        return x',
        'out = {k: normalize(v) for k, v in data.items()}',
        'print(json.dumps(out, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))',
      ].join('\n');
      const sp = spawnSync(python.cmd, (python.args || []).concat(['-c', script]), { encoding: 'utf8', timeout: 5000 });
      if (sp.status !== 0) {
        console.error('Failed to convert calibration pkl to json', sp.stderr || sp.stdout);
        return null;
      }
      data = JSON.parse(sp.stdout || '{}');
    }
    cachedCalibration = { mtime, data };
    return data;
  } catch (e) {
    console.error('loadCalibrationData failed', e);
    return null;
  }
}

// Helper: resolve project folder. For auto-generated GSM project names
// (starting with 'GSM-') the user prefers a single `projects` folder
// instead of creating per-project subfolders. This function implements
// that policy. Pass a sanitized projectName string.
function resolveProjectFolder(projectName) {
  const projectsRoot = path.join(__dirname, '..', 'projects');
  // Flatten: always use the shared `projects/` folder for all projects.
  // This places all project artifacts under the single repository-level
  // `projects/` directory regardless of the provided projectName.
  return projectsRoot;
}

// Helper: find an available Python command to run. Returns an object { cmd, args }
// or null if none found. Order: GSM_PYTHON_EXE -> repo .venv -> py -3 (probe) -> python on PATH (probe).
function findPythonCmd(repoRoot) {
  const venvPython = path.join(repoRoot, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
  let pythonCmd = null;
  let pythonArgs = [];

  if (process.env.GSM_PYTHON_EXE) {
    try {
      const candidate = String(process.env.GSM_PYTHON_EXE);
      if (fs.existsSync(candidate)) {
        pythonCmd = candidate;
        console.log('Using GSM_PYTHON_EXE override:', pythonCmd);
        return { cmd: pythonCmd, args: pythonArgs };
      } else {
        console.log('GSM_PYTHON_EXE set but path not found:', candidate);
      }
    } catch (e) { /* ignore */ }
  }

  if (fs.existsSync(venvPython)) {
    pythonCmd = venvPython;
    console.log('Using repo .venv python:', pythonCmd);
    return { cmd: pythonCmd, args: pythonArgs };
  }

  // Prefer 'python' on PATH first (avoids py-launcher mapping to a removed installation)
  try {
    const probe2 = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
    if (!probe2.error && probe2.status === 0) {
      pythonCmd = 'python';
      console.log('Using python from PATH');
      return { cmd: pythonCmd, args: pythonArgs };
    }
  } catch (e) { /* ignore */ }

  // Fallback: try 'py -3' on Windows
  if (process.platform === 'win32') {
    try {
      const probe = spawnSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
      if (!probe.error && probe.status === 0) {
        pythonCmd = 'py';
        pythonArgs = ['-3'];
        console.log('Using py -3 launcher for Python');
        return { cmd: pythonCmd, args: pythonArgs };
      }
    } catch (e) { /* ignore */ }
  }

  return null;
}

// Simple Server-Sent Events (SSE) clients registry for render notifications
const sseClients = new Set();

function sendSseEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      // ignore write errors; client cleanup happens on 'close'
    }
  }
}

const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Enable simple CORS for local development
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // handle preflight
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve repository-level fonts directory at /fonts so browser clients can
// fetch TTF/OTF files when converting text to polylines client-side.
try {
  const fontsDir = path.join(__dirname, '..', 'fonts');
  if (fs.existsSync(fontsDir)) {
    app.use('/fonts', express.static(fontsDir));
    console.log('Serving fonts from', fontsDir, 'at /fonts');
  }
} catch (e) {
  console.warn('Fonts directory not served:', e);
}

// Provide a simple listing of available font files so the frontend can present
// an accurate font picker mapped to actual TTF/OTF files in the repo.
app.get('/fonts/list', (req, res) => {
  try {
    const fontsDir = path.join(__dirname, '..', 'fonts');
    if (!fs.existsSync(fontsDir)) return res.json([]);
    const files = fs.readdirSync(fontsDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ['.ttf', '.otf', '.woff', '.woff2'].includes(ext);
    });
    return res.json(files);
  } catch (e) {
    console.error('Failed to list fonts', e);
    return res.status(500).json({ error: 'failed to list fonts' });
  }
});

// Diagnostics: report which Python the server would use and basic env info
app.get('/diagnostics/python', (req, res) => {
  try {
    const probe = findPythonCmd(REPO_ROOT);
    const venvPath = path.join(REPO_ROOT, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
    const venvExists = fs.existsSync(venvPath);
    const envGsm = process.env.GSM_PYTHON_EXE || null;
    const pathEnv = process.env.PATH || process.env.Path || '';

    let execResult = null;
    if (probe && probe.cmd) {
      try {
        const fullArgs = (probe.args || []).concat(['-c', 'import sys; print(sys.executable); print(sys.version)']);
        const sp = spawnSync(probe.cmd, fullArgs, { encoding: 'utf8', timeout: 5000 });
        execResult = { status: sp.status, stdout: sp.stdout, stderr: sp.stderr };
      } catch (e) {
        execResult = { error: String(e) };
      }
    }

    return res.json({ probe, venvExists, envGsm, pathEnv, execResult });
  } catch (e) {
    return res.status(500).json({ error: 'diagnostics_failed', message: String(e) });
  }
});

app.use(express.json({ limit: '50mb' }));

// Photo capture + calibration helpers for the Trace tab
app.get('/api/photos/calibration', (req, res) => {
  const data = loadCalibrationData();
  if (!data) return res.status(404).json({ error: 'calibration_not_found' });
  const cameraMatrix = data.camera_matrix || data.cameraMatrix || data.mtx || null;
  const distortion = data.distortion_coefficients || data.distortion_coeffs || data.distortion || data.dist || null;
  if (!cameraMatrix || !distortion) return res.status(500).json({ error: 'calibration_missing_fields' });
  return res.json({ camera_matrix: cameraMatrix, distortion_coefficients: distortion });
});

app.get('/api/photos/list', (req, res) => {
  try {
    const rawProject = (req.query && req.query.project) || 'project';
    const projectName = sanitizeProjectName(Array.isArray(rawProject) ? rawProject[0] : rawProject);
    const projectFolder = ensureProjectFolder(projectName);
    const files = fs.readdirSync(projectFolder);
    const items = [];
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      const full = path.join(projectFolder, f);
      let st = null;
      try { st = fs.statSync(full); } catch { st = null; }
      items.push({
        name: f,
        edited: !f.startsWith('_'),
        mtimeMs: st ? st.mtimeMs || st.ctimeMs || 0 : 0,
        size: st ? st.size || 0 : 0,
        url: `/api/photos/raw?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(f)}`,
      });
    }
    items.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return res.json({ project: projectName, projectFolder, items });
  } catch (e) {
    console.error('photo list failed', e);
    return res.status(500).json({ error: 'photo_list_failed', detail: String(e) });
  }
});

app.get('/api/photos/raw', (req, res) => {
  try {
    const rawProject = (req.query && req.query.project) || 'project';
    const projectName = sanitizeProjectName(Array.isArray(rawProject) ? rawProject[0] : rawProject);
    const rawFile = req.query && req.query.file;
    if (!rawFile || (Array.isArray(rawFile) && !rawFile.length)) return res.status(400).json({ error: 'missing_file' });
    const file = path.basename(Array.isArray(rawFile) ? rawFile[0] : rawFile);
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) return res.status(400).json({ error: 'invalid_extension' });
    const projectFolder = ensureProjectFolder(projectName);
    const target = path.join(projectFolder, file);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'not_found' });
    return res.sendFile(target);
  } catch (e) {
    console.error('photo raw failed', e);
    return res.status(500).json({ error: 'photo_raw_failed', detail: String(e) });
  }
});

app.post('/api/photos/capture', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = sanitizeProjectName(body.project || 'project');
    const projectFolder = ensureProjectFolder(projectName);
    const dataUrl = body.dataUrl || body.data || null;
    const parsed = parseDataUrlToBuffer(dataUrl, body.mimeType || body.mimetype || null);
    if (!parsed) return res.status(400).json({ error: 'invalid_image_payload' });
    const rawName = body.name || body.filename || '';
    const parsedName = path.parse(rawName || '');
    const base = sanitizeFilenameBase(parsedName.name || rawName || `capture_${Date.now()}`) || `capture_${Date.now()}`;
    const ext = (parsedName.ext && IMAGE_EXTS.includes(parsedName.ext.toLowerCase())) ? parsedName.ext : parsed.ext;
    const finalName = `_${base}${ext}`;
    const target = path.join(projectFolder, finalName);
    fs.writeFileSync(target, parsed.buffer);
    return res.json({ ok: true, filename: finalName, project: projectName });
  } catch (e) {
    console.error('photo capture failed', e);
    return res.status(500).json({ error: 'photo_capture_failed', detail: String(e) });
  }
});

app.post('/api/photos/mark-edited', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = sanitizeProjectName(body.project || 'project');
    const projectFolder = ensureProjectFolder(projectName);
    const rawFile = body.filename || body.name;
    if (!rawFile) return res.status(400).json({ error: 'missing_filename' });
    const file = path.basename(String(rawFile));
    if (!file.startsWith('_')) return res.status(400).json({ error: 'not_prefixed' });
    const src = path.join(projectFolder, file);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'not_found' });
    const baseName = file.replace(/^_+/, '') || file;
    const parsed = path.parse(baseName);
    let destName = baseName;
    let dest = path.join(projectFolder, destName);

    // First try to remove an existing target so we overwrite cleanly
    try {
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
    } catch (e) {
      console.warn('Failed to remove existing target during mark-edited', dest, e);
    }

    // If the destination still exists (locked, permissions, etc.), fall back to a unique suffixed name
    if (fs.existsSync(dest)) {
      let idx = 1;
      while (fs.existsSync(path.join(projectFolder, `${parsed.name}-${idx}${parsed.ext}`))) {
        idx += 1;
      }
      destName = `${parsed.name}-${idx}${parsed.ext}`;
      dest = path.join(projectFolder, destName);
    }

    try {
      fs.renameSync(src, dest);
    } catch (e) {
      console.error('photo mark-edited failed (rename)', e);
      return res.status(500).json({ error: 'photo_mark_failed', detail: String(e) });
    }
    return res.json({ ok: true, filename: destName, project: projectName });
  } catch (e) {
    console.error('photo mark-edited failed', e);
    return res.status(500).json({ error: 'photo_mark_failed', detail: String(e) });
  }
});

// Allow uploading a calibration file (pkl or json) into the calibration_files folder
// Handle multer errors explicitly so clients always receive JSON (avoids HTML error pages)
app.post('/api/photos/calibration-upload', (req, res) => {
  upload.single('calibration')(req, res, (err) => {
    if (err) {
      console.error('calibration upload failed (multer)', err);
      return res.status(400).json({ error: 'calibration_upload_failed', detail: String(err) });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'missing_file' });
      const ext = (path.extname(req.file.originalname || '') || '').toLowerCase();
      if (!['.pkl', '.json'].includes(ext)) return res.status(400).json({ error: 'unsupported_extension' });
      const targetDir = path.join(__dirname, '..', 'raw photos', 'calibration_files');
      fs.mkdirSync(targetDir, { recursive: true });
      const pklPath = path.join(targetDir, 'calibration_data.pkl');
      const jsonPath = path.join(targetDir, 'calibration_data.json');
      if (ext === '.pkl') {
        fs.copyFileSync(req.file.path, pklPath);
        // attempt to refresh cache
        cachedCalibration = { mtime: 0, data: null };
      } else if (ext === '.json') {
        fs.copyFileSync(req.file.path, jsonPath);
        cachedCalibration = { mtime: 0, data: null };
      }
      return res.json({ ok: true, stored: ext === '.pkl' ? pklPath : jsonPath });
    } catch (e) {
      console.error('calibration upload failed', e);
      return res.status(500).json({ error: 'calibration_upload_failed', detail: String(e) });
    }
  });
});

app.post('/api/photos/save', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = sanitizeProjectName(body.project || 'project');
    const projectFolder = ensureProjectFolder(projectName);
    const rawFile = body.filename || body.name;
    if (!rawFile) return res.status(400).json({ error: 'missing_filename' });
    const file = path.basename(String(rawFile));
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) return res.status(400).json({ error: 'invalid_extension' });
    const parsed = parseDataUrlToBuffer(body.dataUrl || body.data || null, body.mimeType || body.mimetype || null);
    if (!parsed) return res.status(400).json({ error: 'invalid_image_payload' });
    const target = path.join(projectFolder, file);
    fs.writeFileSync(target, parsed.buffer);
    return res.json({ ok: true, filename: file, project: projectName });
  } catch (e) {
    console.error('photo save failed', e);
    return res.status(500).json({ error: 'photo_save_failed', detail: String(e) });
  }
});

// Helper: merge and write GSM snapshot for a project
function writeGsmSnapshot(projectFolder, projectName, incomingProjectOrItems, incomingBoard) {
  try {
    // If a GSM already exists, start from it and shallow-merge incoming data
    const gsmPath = path.join(projectFolder, `${projectName}.gsm`);
    let baseGsm = {};
    if (fs.existsSync(gsmPath)) {
      try {
        const raw = fs.readFileSync(gsmPath, 'utf8');
        baseGsm = JSON.parse(raw) || {};
      } catch (e) {
        baseGsm = {};
      }
    }

    let gsmObj = {};
    if (incomingProjectOrItems && typeof incomingProjectOrItems === 'object' && incomingProjectOrItems.project) {
      gsmObj = Object.assign({}, baseGsm, incomingProjectOrItems.project);
    } else if (incomingProjectOrItems && typeof incomingProjectOrItems === 'object' && Array.isArray(incomingProjectOrItems.items)) {
      gsmObj = Object.assign({}, baseGsm, incomingProjectOrItems);
    } else if (incomingProjectOrItems && typeof incomingProjectOrItems === 'object') {
      gsmObj = Object.assign({}, baseGsm, incomingProjectOrItems);
    } else {
      gsmObj = Object.assign({}, baseGsm, { projectName });
    }

    // if items were passed directly as array
    if (Array.isArray(incomingProjectOrItems) && incomingProjectOrItems.length) {
      gsmObj.items = incomingProjectOrItems;
    }

    // Ensure commonly-referenced DXF arrays exist so template.scad
    // does not warn about unknown variables when OpenSCAD loads the GSM.
    const ensureArray = (k) => { if (!Object.prototype.hasOwnProperty.call(gsmObj, k) || !Array.isArray(gsmObj[k])) gsmObj[k] = []; };
    ensureArray('dxf_file_paths');
    ensureArray('dxf_cut_depths');
    ensureArray('dxf_sections');
    ensureArray('section_positions');
    ensureArray('dxf_file_paths_raised');
    ensureArray('dxf_raised_heights');
    ensureArray('dxf_file_paths_blocker');

    // Merge explicit board info into existing board (preserve existing keys)
    if (incomingBoard && typeof incomingBoard === 'object') {
      gsmObj.board = Object.assign({}, baseGsm.board || {}, gsmObj.board || {}, incomingBoard);
    } else if (baseGsm.board && !gsmObj.board) {
      gsmObj.board = baseGsm.board;
    }

    // NOTE: We intentionally do NOT write a separate `board_parameters` block.
    // The canonical board data is stored in `board` (preferred). Downstream
    // tools should read `board` directly.

    fs.writeFileSync(gsmPath, JSON.stringify(gsmObj, null, 2), 'utf8');
    console.log('Wrote project GSM to', gsmPath);
    return gsmPath;
  } catch (e) {
    console.warn('Failed to write project GSM snapshot', e);
    throw e;
  }
}

app.post('/process-image', upload.single('image'), (req, res) => {
  // Optional project name to mimic load_image() behavior
  const rawProjectName = (req.body && req.body.project) || null;
  // sanitize project name to a safe folder name (remove chars invalid on Windows)
  let projectName = null;
  if (rawProjectName) {
    projectName = String(rawProjectName).replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_').trim();
    if (!projectName) projectName = 'project';
  }

  const inputPath = req.file ? req.file.path : null;

  // If projectName provided, create project folder and copy ./src into it (like the desktop app)
  let workInputPath = inputPath;
  let workingOutDir = path.join(__dirname, 'output', Date.now().toString());
  fs.mkdirSync(workingOutDir, { recursive: true });

  let projectFolder = null;
  if (projectName) {
    try {
      projectFolder = resolveProjectFolder(projectName);
      fs.mkdirSync(projectFolder, { recursive: true });

      // Do NOT copy repo `src` into the project folder. The server will always
      // reference the canonical `src` at the repository root (single source of truth).
      console.log('Using repository src as single source of truth; projectFolder=', projectFolder);

          // save uploaded image into project folder using its original filename (preserve name)
          if (req.file) {
            try {
              const origName = req.file.originalname || path.basename(inputPath || 'upload');
              const savedPath = path.join(projectFolder, origName);
              fs.copyFileSync(inputPath, savedPath);
              console.log('Saved uploaded file to project folder:', savedPath);
              // update workInputPath to point to saved copy (ensures reprocess uses this original)
              workInputPath = savedPath;
              // persist canonical original filename in project.json so reprocess can deterministically use it
              try {
                // Write a canonical GSM snapshot so the project metadata is
                // preserved under the preferred .gsm format instead of a
                // transient project.json. This keeps a single canonical
                // snapshot file per project name.
                try {
                  writeGsmSnapshot(projectFolder, projectName, { project: { original: origName } }, null);
                  console.log('Wrote GSM snapshot with original:', origName);
                } catch (wj) {
                  // Fallback: if for any reason writing GSM fails, persist
                  // a minimal project.json so reprocess flows can still find
                  // the uploaded filename.
                  const meta = { original: origName };
                  fs.writeFileSync(path.join(projectFolder, 'project.json'), JSON.stringify(meta, null, 2), 'utf8');
                  console.error('Failed to write GSM snapshot, wrote project.json instead', wj);
                }
              } catch (wj) {
                console.error('Failed to persist uploaded original filename', wj);
              }
            } catch (err) {
              console.error('Failed to save uploaded file into project folder, will continue using temp file:', err);
            }
          } else {
            // no uploaded file: first prefer canonical original from project.json if present
            try {
              const pjPath = path.join(projectFolder, 'project.json');
              console.log('Checking for project.json at', pjPath);
              if (fs.existsSync(pjPath)) {
                try {
                  const pjRaw = fs.readFileSync(pjPath, 'utf8');
                  console.log('project.json raw:', pjRaw);
                  const pj = JSON.parse(pjRaw);
                  console.log('project.json parsed:', pj);
                  if (pj && pj.original) {
                    const candidatePath = path.join(projectFolder, pj.original);
                    console.log('Checking candidatePath exists?', candidatePath, fs.existsSync(candidatePath));
                    if (fs.existsSync(candidatePath)) {
                      workInputPath = candidatePath;
                      console.log('Using canonical original from project.json for reprocess:', workInputPath);
                    } else {
                      console.log('project.json referenced original but file missing:', candidatePath);
                    }
                  }
                } catch (e) {
                  console.error('Failed to read/parse project.json', e);
                }
              } else {
                console.log('project.json not present in', projectFolder);
              }
            } catch (e) {
              console.error('Error checking project.json', e);
            }

            // if project.json didn't yield a workInputPath, try to find an existing image in project folder (search recursively)
            try {
              const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.gif', '.webp'];
              const foundFiles = [];
              const walkDir = (dir) => {
                try {
                  const list = fs.readdirSync(dir, { withFileTypes: true });
                  for (const ent of list) {
                    const p = path.join(dir, ent.name);
                    try {
                      if (ent.isDirectory()) {
                        if (ent.name === 'processing_output') continue;
                        walkDir(p);
                      } else {
                        const ext = path.extname(ent.name).toLowerCase();
                        if (imageExts.includes(ext)) foundFiles.push(p);
                      }
                    } catch (e) { /* ignore per-file errors */ }
                  }
                } catch (e) { /* ignore dir read errors */ }
              };
              if (fs.existsSync(projectFolder)) walkDir(projectFolder);
              if (foundFiles.length) {
                foundFiles.sort((a, b) => {
                  const aMs = fs.statSync(a).mtimeMs || 0;
                  const bMs = fs.statSync(b).mtimeMs || 0;
                  return bMs - aMs;
                });
                workInputPath = foundFiles[0];
                console.log('Found existing project image for reprocess:', workInputPath);
              } else {
                console.log('No existing project image found for reprocess in', projectFolder);
              }
            } catch (e) {
              console.error('error searching project folder for images', e);
            }
          }
          
          // set output dir inside project folder
          workingOutDir = path.join(projectFolder, 'processing_output');
          fs.mkdirSync(workingOutDir, { recursive: true });
    } catch (err) {
      console.error('project setup failed', err);
    }
  }

  if (!workInputPath) {
    console.error('no input image found. projectFolder=', projectFolder);
    return res.status(400).json({ error: 'no file uploaded and no project image found', projectFolder });
  }

  // collect processing params (optional)
  const threshold = req.body.threshold;
  const offset = req.body.offset;
  const token = req.body.token;
  const resolution = req.body.resolution;

  // Call the python processing script with the working input and out dir and optional params
  // Always pass the repository root as the projectdir so Python imports the
  // canonical `src` package from the repository (single source of truth).
  const repoRoot = path.join(__dirname, '..');
  // Prefer using the repository virtual environment python if it exists
  const venvPython = path.join(repoRoot, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');

  // Decide which python command to spawn. We avoid hard-coding absolute
  // interpreter paths unless explicitly provided via GSM_PYTHON_EXE. Try in
  // order: GSM_PYTHON_EXE (if exists), .venv python, 'py -3' launcher (Windows),
  // then 'python' on PATH. We detect availability by doing a quick spawnSync
  // probe that does not throw when the command is absent.
  let pythonCmd = null;
  let pythonPrefixArgs = [];

  // 1) explicit override
  if (process.env.GSM_PYTHON_EXE) {
    try {
      const candidate = String(process.env.GSM_PYTHON_EXE);
      if (fs.existsSync(candidate)) {
        pythonCmd = candidate;
        console.log('Using GSM_PYTHON_EXE override:', pythonCmd);
      } else {
        console.log('GSM_PYTHON_EXE is set but path not found:', candidate);
      }
    } catch (e) { /* ignore */ }
  }

  // 2) repo venv
  if (!pythonCmd && fs.existsSync(venvPython)) {
    pythonCmd = venvPython;
    console.log('Using repo .venv python:', pythonCmd);
  }

    // 3) try 'python' on PATH
    try {
      const probe2 = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
      if (!probe2.error && probe2.status === 0) {
        pythonCmd = 'python';
        console.log('Using python from PATH');
      } else {
        console.log('python probe failed; no python found on PATH');
      }
    } catch (e) {
      // ignore
    }

    // 4) try 'py -3' on Windows as a fallback
    if (!pythonCmd && process.platform === 'win32') {
      try {
        const probe = spawnSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
        if (!probe.error && probe.status === 0) {
          pythonCmd = 'py';
          pythonPrefixArgs = ['-3'];
          console.log('Using py -3 launcher for Python');
        } else {
          console.log('py -3 probe failed or not available');
        }
      } catch (e) { /* ignore */ }
    }

  // 4) fallback to 'python' on PATH
  if (!pythonCmd) {
    try {
      const probe2 = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
      if (!probe2.error && probe2.status === 0) {
        pythonCmd = 'python';
        console.log('Using python from PATH');
      } else {
        console.log('python probe failed; no python found on PATH');
      }
    } catch (e) {
      // ignore
    }
  }

  const python = findPythonCmd(repoRoot);
  if (!python) {
    console.error('No Python interpreter found. Set GSM_PYTHON_EXE to an absolute python path or install Python and ensure py/python is on PATH.');
    return res.status(500).json({ error: 'python_not_found', message: 'No Python interpreter found. Set GSM_PYTHON_EXE or install Python.' });
  }

  const pyArgs = python.args.concat([path.join(__dirname, 'process_image.py'), workInputPath, workingOutDir, '--projectdir', repoRoot]);
  if (projectFolder) {
    // Also tell the Python side where to put per-project outputs and where the
    // project image lives.
    pyArgs.push('--workfolder', projectFolder);
  }
  if (threshold) pyArgs.push('--threshold', String(threshold));
  if (offset) pyArgs.push('--offset', String(offset));
  if (token) pyArgs.push('--token', String(token));
  if (resolution) pyArgs.push('--resolution', String(resolution));

  // Capture stdout/stderr so we can detect where Python actually wrote outputs
  const py = spawn(python.cmd ? python.cmd : python, pyArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  console.log('Spawning python with args:', pyArgs);
  console.log('Final workInputPath before processing:', workInputPath);

  let pyOut = '';
  let pyErr = '';
  py.stdout.on('data', (c) => { pyOut += String(c || ''); });
  py.stderr.on('data', (c) => { pyErr += String(c || ''); });

  py.on('close', (code) => {
    if (code !== 0) {
      console.error('python exited with code', code, 'stderr:', pyErr);
      return res.status(500).json({ error: 'python failed', code, stderr: pyErr });
    }

    try {
      // Python may have written outputs to a temporary directory. The CLI
      // prints a line like: 'Processing finished. Outputs in: <outdir>'
      // Try to parse that and, if present, move outputs into the project
      // folder's processing_output so they persist under `projects/<name>`.
      let actualOutDir = workingOutDir;
      try {
        // First, try to capture the printed output path. Use a permissive
        // match that accepts spaces and any characters until the end of line.
        let candidate = null;
        const m1 = /Processing finished\. Outputs in:\s*(.+)/m.exec(pyOut);
        if (m1 && m1[1]) {
          candidate = m1[1].trim();
          // Trim any trailing punctuation
          candidate = candidate.replace(/["'\r\n]+$/g, '').trim();
        }

        // If that didn't yield an existing path, look for absolute windows paths
        // (e.g., C:\...) or unix-style absolute paths in the stdout.
        if (!candidate || !fs.existsSync(candidate)) {
          const m2 = /([A-Za-z]:\\[^\r\n]+)/.exec(pyOut) || /\/(?:[^\s\r\n]+\/?)+processing_output/m.exec(pyOut);
          if (m2 && m2[1]) candidate = m2[1].trim();
        }

        // As a last resort, search the repo and system temp for any
        // 'processing_output' directories modified in the last 120 seconds.
        if ((!candidate || !fs.existsSync(candidate)) && projectFolder) {
          const candidates = [];
          const searchDirs = [path.join(__dirname, '..'), require('os').tmpdir()];
          const now = Date.now();
          const maxAge = 120 * 1000; // 120s
          for (const sd of searchDirs) {
            try {
              const walk = (dir) => {
                try {
                  const list = fs.readdirSync(dir, { withFileTypes: true });
                  for (const ent of list) {
                    const p = path.join(dir, ent.name);
                    try {
                      if (ent.isDirectory()) {
                        if (ent.name === 'processing_output') {
                          try {
                            const st = fs.statSync(p);
                            if ((now - st.mtimeMs) < maxAge) candidates.push(p);
                          } catch (e) { }
                        }
                        // recurse lightly (depth-limited)
                        if (p.split(path.sep).length - sd.split(path.sep).length < 6) walk(p);
                      }
                    } catch (e) { }
                  }
                } catch (e) { }
              };
              if (fs.existsSync(sd)) walk(sd);
            } catch (e) { }
          }
          if (candidates.length) {
            // prefer the most-recent candidate
            candidates.sort((a,b)=> {
              try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (e) { return 0; }
            });
            candidate = candidates[0];
          }
        }

        if (candidate && fs.existsSync(candidate)) {
          try {
            const st = fs.lstatSync(candidate);
            if (st.isDirectory()) {
              actualOutDir = candidate;
              if (projectFolder) {
                try {
                  fs.mkdirSync(workingOutDir, { recursive: true });
                  const copyRecursive = (src, dst) => {
                    const entries = fs.readdirSync(src, { withFileTypes: true });
                    for (const ent of entries) {
                      const s = path.join(src, ent.name);
                      const d = path.join(dst, ent.name);
                      if (ent.isDirectory()) {
                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                        copyRecursive(s, d);
                      } else {
                        try { fs.copyFileSync(s, d); } catch (e) { console.warn('copy file failed', s, d, e); }
                      }
                    }
                  };
                  copyRecursive(actualOutDir, workingOutDir);
                  console.log('Copied Python outputs from', actualOutDir, 'to', workingOutDir);
                  // Normalize legacy CLI image names to canonical names used by the server/frontend
                  try {
                    const auxPath = path.join(workingOutDir, 'aux_region3.png');
                    const tracedPath = path.join(workingOutDir, 'traced.png');
                    const offsetPath = path.join(workingOutDir, 'offset.png');
                    const originalPath = path.join(workingOutDir, 'original.png');
                    // If legacy aux_region3 exists but offset.png does not, rename it
                    if (fs.existsSync(auxPath) && !fs.existsSync(offsetPath)) {
                      try { fs.renameSync(auxPath, offsetPath); console.log('Renamed aux_region3.png -> offset.png'); } catch (e) { console.warn('rename aux->offset failed', e); }
                    }
                    // If traced.png is missing but there is a file named 'region_2.png', rename it
                    const region2 = path.join(workingOutDir, 'region_2.png');
                    if (!fs.existsSync(tracedPath) && fs.existsSync(region2)) {
                      try { fs.renameSync(region2, tracedPath); console.log('Renamed region_2.png -> traced.png'); } catch (e) { console.warn('rename region2->traced failed', e); }
                    }
                    // If original.png missing but there is 'region_1.png', rename it
                    const region1 = path.join(workingOutDir, 'region_1.png');
                    if (!fs.existsSync(originalPath) && fs.existsSync(region1)) {
                      try { fs.renameSync(region1, originalPath); console.log('Renamed region_1.png -> original.png'); } catch (e) { console.warn('rename region1->original failed', e); }
                    }
                  } catch (e) {
                    console.warn('Failed to normalize legacy image names', e);
                  }
                } catch (e) {
                  console.warn('Failed to copy python outputs into project processing_output', e);
                }
              }
            } else {
              console.warn('Parsed candidate path from Python stdout is not a directory, skipping copy:', candidate);
            }
          } catch (e) {
            console.warn('Failed to stat candidate path, skipping copy:', candidate, e);
          }
        }
      } catch (e) {
        console.warn('Failed to locate/copy python outputs', e);
      }

      const original = fs.readFileSync(workInputPath).toString('base64');
      const tracedPath = path.join(workingOutDir, 'traced.png');
      const offsetPath = path.join(workingOutDir, 'offset.png');
      const traced = fs.existsSync(tracedPath) ? fs.readFileSync(tracedPath).toString('base64') : null;
      const offset = fs.existsSync(offsetPath) ? fs.readFileSync(offsetPath).toString('base64') : null;

      // try to read meta.json produced by the python runner (contains dxf info)
      let dxfInfo = null;
      const metaPath = path.join(workingOutDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const raw = fs.readFileSync(metaPath, 'utf8');
          dxfInfo = JSON.parse(raw);
        } catch (e) {
          console.error('failed to parse meta.json', e);
        }
      }

      // If we have projectFolder and meta info, merge the processing meta
      // into the project's canonical .gsm snapshot so the .gsm becomes the
      // single source of truth for UI and downstream tooling.
      if (projectFolder && projectName && dxfInfo) {
        try {
          // Write under a `processing` key so existing project fields are preserved.
          writeGsmSnapshot(projectFolder, projectName, { project: { processing: dxfInfo } }, null);
          console.log('Merged processing meta into .gsm for project', projectName);
          // Remove meta.json from processing_output now that we've merged it
          try {
            if (fs.existsSync(metaPath)) {
              fs.unlinkSync(metaPath);
              console.log('Removed meta.json from', metaPath, 'after merging into .gsm');
            }
          } catch (e) {
            console.warn('Failed to remove meta.json after merging into .gsm', e);
          }
        } catch (e) {
          console.warn('Failed to merge processing meta into .gsm', e);
        }
      }

      // Attempt to remove meta.json from processing_output so GSM is canonical
      try {
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
          console.log('Removed meta.json from processing_output (post-process cleanup)');
        }
      } catch (e) {
        console.warn('Failed to remove meta.json during cleanup', e);
      }

      // include which input file was used so frontend can verify
      res.json({ original, traced, offset, dxf: dxfInfo, used_input: workInputPath });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed to read outputs', detail: String(err) });
    }
  });
});

// Save project (.gsm) into the project's folder on disk
app.post('/save-project', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = String(body.projectName || 'project').replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_').trim() || 'project';
    const gsmName = String(body.gsmName || `${projectName}.gsm`);
    const projectObj = body.project;

    const projectFolder = resolveProjectFolder(projectName);
    if (!fs.existsSync(projectFolder)) fs.mkdirSync(projectFolder, { recursive: true });

    // Use the shared helper so Save and Output DXF's produce identical GSMs
    const projToSave = Object.assign({}, projectObj || {});
    // Determine whether to attach defaults: prefer incoming board, then existing GSM board, otherwise fallback to defaults
    const gsmPathCandidate = path.join(projectFolder, `${projectName}.gsm`);
    let incomingBoard = null;
    if (projToSave.board && typeof projToSave.board === 'object') {
      incomingBoard = projToSave.board;
    } else if (fs.existsSync(gsmPathCandidate)) {
      try {
        const raw = fs.readFileSync(gsmPathCandidate, 'utf8');
        const existing = JSON.parse(raw) || {};
        if (existing && existing.board && typeof existing.board === 'object') {
          // preserve existing board by not passing an incomingBoard (writeGsmSnapshot will merge)
          incomingBoard = null;
        }
      } catch (e) {
        // ignore parse errors and fall through to defaults
      }
    }
    if (!incomingBoard) {
      // if no incoming board and no existing board, create sensible defaults
      const defaultBoard = { gridX: 4, gridY: 3, cellSizeMM: 42, height7Units: 8 };
      projToSave.board = projToSave.board && typeof projToSave.board === 'object' ? projToSave.board : defaultBoard;
      incomingBoard = projToSave.board;
    }
    const gsmPath = writeGsmSnapshot(projectFolder, projectName, { project: projToSave }, incomingBoard);
    // If caller requested a different gsm filename, also write that copy
    if (gsmName && gsmName !== `${projectName}.gsm`) {
      try {
        const altPath = path.join(projectFolder, gsmName);
        fs.writeFileSync(altPath, JSON.stringify(projectObj || {}, null, 2), 'utf8');
        console.log('Also wrote alternate GSM name to', altPath);
      } catch (e) { /* non-fatal */ }
    }
    console.log('Saved GSM project to', gsmPath);

    return res.json({ ok: true, path: gsmPath });
  } catch (e) {
    console.error('Failed to save project gsm', e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// Export multiple DXFs per canvas item into project processing_output
app.post('/export-dxfs', async (req, res) => {
  try {
    const body = req.body || {};
    const projectName = String(body.projectName || 'default_project').replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_') || 'default_project';
    const items = Array.isArray(body.items) ? body.items : [];
    const repoRoot = path.join(__dirname, '..');
    const projectFolder = resolveProjectFolder(projectName);
    if (!fs.existsSync(projectFolder)) fs.mkdirSync(projectFolder, { recursive: true });
    const out = path.join(projectFolder, 'processing_output');
    if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

    // Clean stale .poly.json files so export reflects only current canvas shapes
    try {
      const existing = fs.readdirSync(out);
      for (const f of existing) {
        if (f.toLowerCase().endsWith('.poly.json')) {
          try { fs.unlinkSync(path.join(out, f)); } catch (e) { console.warn('Failed to remove old poly.json', f, e); }
        }
      }
    } catch (e) {
      console.warn('Unable to clean existing .poly.json files before export', e);
    }

    const results = [];
    const manifest = [];
    // Save a snapshot of the project as a .gsm so downstream tools can
    // read full project/shape metadata (depthMM, cutType, etc.). If the
    // frontend provided a richer `project` object prefer that, otherwise
    // serialize the `items` array we received.
    try {
      // Build a project object similar to /save-project so Output DXF's and Save behave identically
      let projectObj = (req.body && req.body.project && typeof req.body.project === 'object') ? Object.assign({}, req.body.project) : { projectName, items };
      // If the client provided a top-level board, merge it in
      if (req.body && req.body.board && typeof req.body.board === 'object') {
        projectObj.board = Object.assign({}, projectObj.board || {}, req.body.board);
      }
      // Decide whether to attach defaults: prefer incoming board, then existing GSM board, otherwise fallback to defaults
      const gsmPathCandidate2 = path.join(projectFolder, `${projectName}.gsm`);
      let incomingBoard2 = null;
      if (projectObj.board && typeof projectObj.board === 'object') {
        incomingBoard2 = projectObj.board;
      } else if (fs.existsSync(gsmPathCandidate2)) {
        try {
          const raw = fs.readFileSync(gsmPathCandidate2, 'utf8');
          const existing = JSON.parse(raw) || {};
          if (existing && existing.board && typeof existing.board === 'object') {
            incomingBoard2 = null; // preserve existing
          }
        } catch (e) {
          // ignore
        }
      }
      if (!incomingBoard2) {
        const defaultBoard = { gridX: 4, gridY: 3, cellSizeMM: 42, height7Units: 8 };
        projectObj.board = projectObj.board && typeof projectObj.board === 'object' ? projectObj.board : defaultBoard;
        incomingBoard2 = projectObj.board;
      }
      writeGsmSnapshot(projectFolder, projectName, { project: projectObj }, incomingBoard2);
    } catch (e) {
      console.warn('Failed to write project GSM snapshot', e);
    }
    // If no items were provided to export-dxfs, attempt to synthesize .poly.json
    // files from the project's GSM processing metadata or from processing_output/meta.json
    try {
      const outFilesNow = fs.existsSync(out) ? fs.readdirSync(out) : [];
      const hasPolyJson = outFilesNow.some(f => f.toLowerCase().endsWith('.poly.json'));
      if (items && items.length) {
        // Client provided explicit items; do not synthesize processing polylines
        console.log('export-dxfs: items provided by client; skipping GSM/meta synthesis of .poly.json');
      } else {
        if (!hasPolyJson) {
          // Try to read GSM for embedded polylines
          const gsmPath = path.join(projectFolder, `${projectName}.gsm`);
          let created = 0;
          if (fs.existsSync(gsmPath)) {
            try {
              const raw = fs.readFileSync(gsmPath, 'utf8');
              const gsmObj = JSON.parse(raw);
              // Look for polylines under processing or meta
              let proc = null;
              if (gsmObj && typeof gsmObj === 'object') {
                proc = gsmObj.processing || gsmObj.processing_meta || (gsmObj.project && gsmObj.project.processing) || null;
              }
              if (proc && Array.isArray(proc.polylines) && proc.polylines.length) {
                for (let i = 0; i < proc.polylines.length; i++) {
                  const poly = proc.polylines[i];
                  const name = (proc.names && proc.names[i]) ? proc.names[i] : `shape_${i+1}`;
                  const polyObj = { name: name, polylines: [poly] };
                  const polyPath = path.join(out, `${name}.poly.json`);
                  try {
                    fs.writeFileSync(polyPath, JSON.stringify(polyObj, null, 2), 'utf8');
                    created += 1;
                  } catch (e) { console.warn('failed to write synthesized poly.json', polyPath, e); }
                }
              }
            } catch (e) { /* ignore parse errors */ }
          }

          // Fall back to reading processing_output/meta.json directly
          if (created === 0) {
            const metaPath = path.join(projectFolder, 'processing_output', 'meta.json');
            if (fs.existsSync(metaPath)) {
              try {
                const raw = fs.readFileSync(metaPath, 'utf8');
                const metaObj = JSON.parse(raw);
                if (metaObj && Array.isArray(metaObj.polylines) && metaObj.polylines.length) {
                  for (let i = 0; i < metaObj.polylines.length; i++) {
                    const poly = metaObj.polylines[i];
                    const name = metaObj.names && metaObj.names[i] ? metaObj.names[i] : `shape_${i+1}`;
                    const polyObj = { name: name, polylines: [poly] };
                    const polyPath = path.join(out, `${name}.poly.json`);
                    try {
                      fs.writeFileSync(polyPath, JSON.stringify(polyObj, null, 2), 'utf8');
                      created += 1;
                    } catch (e) { console.warn('failed to write synthesized poly.json from meta', polyPath, e); }
                  }
                }
              } catch (e) { /* ignore parse errors */ }
            }
          }
          if (created) console.log(`Synthesized ${created} .poly.json files in ${out} from GSM/meta polylines`);
        }
      }
    } catch (e) {
      console.warn('Failed to synthesize poly.json files for export-dxfs', e);
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const safeName = (it.name || `item_${i}`).replace(/[^a-z0-9_\-\.]/gi, '_');
      if (it.polylines) {
        // Use the exact display name from the UI when writing the poly.json
        // Do not sanitize; if the filesystem rejects the name the write will
        // error and we'll record a missing result per your request.
        const rawBase = it.name || `item_${i}`;
        const polyPath = path.join(out, `${rawBase}.poly.json`);
        const toWrite = Object.assign({}, it, { polylines: it.polylines });
        try {
          fs.writeFileSync(polyPath, JSON.stringify(toWrite, null, 2), 'utf8');
          results.push({ type: 'polyjson', path: polyPath });
        } catch (e) {
          console.error('Failed to write polyjson with UI name', polyPath, e);
          results.push({ type: 'missing', requested: `${rawBase}.poly.json`, error: String(e) });
        }
      } else if (it.dxfPaths && it.dxfPaths.length) {
        // dxfPaths can be either filenames or embedded polylines. If the
        // first entry looks like a polyline (array of {x,y}), persist it as
        // a .poly.json to be converted by the Python helper. Otherwise treat
        // each entry as a filename and search/copy it into processing_output.
        const first = it.dxfPaths[0];
        // Accept either: [[{x,y},...], ...] (array of polylines) OR [{x,y},...] (single polyline)
        const looksLikePolylines = (Array.isArray(first) && first.length && typeof first[0] === 'object' && ('x' in first[0] || 'y' in first[0])) || (typeof first === 'object' && ('x' in first || 'y' in first));
        if (looksLikePolylines) {
          const rawBase = it.name || `item_${i}`;
          const polyPath = path.join(out, `${rawBase}.poly.json`);
          // normalize to array-of-polylines
          const normalized = Array.isArray(first) && first.length && typeof first[0] === 'object' && ('x' in first[0] || 'y' in first[0]) ? it.dxfPaths : [it.dxfPaths];
          const toWrite = Object.assign({}, it, { polylines: normalized });
          try {
            fs.writeFileSync(polyPath, JSON.stringify(toWrite, null, 2), 'utf8');
            results.push({ type: 'polyjson', path: polyPath, source: 'embedded_dxfPaths' });
          } catch (e) {
            console.error('Failed to write embedded polyjson with UI name', polyPath, e);
            results.push({ type: 'missing', requested: `${rawBase}.poly.json`, source: 'embedded_dxfPaths', error: String(e) });
          }
        } else {
          for (let d of it.dxfPaths) {
            if (Array.isArray(d)) d = d.length ? d[0] : '';
            if (typeof d !== 'string') {
              console.warn('Skipping invalid dxfPaths entry (not a string):', d);
              results.push({ type: 'missing', requested: d, checked: [], error: 'invalid dxfPaths entry (not a string)' });
              continue;
            }

            const candidates = [];
            if (path.isAbsolute(d)) candidates.push(d);
            candidates.push(path.join(projectFolder, d));
            candidates.push(path.join(projectFolder, 'processing_output', d));
            candidates.push(path.join(repoRoot, d));
            candidates.push(path.join(repoRoot, 'assets', d));
            candidates.push(path.join(repoRoot, 'frontend', 'public', d));
            candidates.push(path.join(repoRoot, 'frontend', 'src', 'assets', d));

            let found = null;
            for (const c of candidates) {
              if (fs.existsSync(c)) { found = c; break; }
            }
            if (found) {
              const ext = path.extname(found) || '.dxf';
              // Save the referenced DXF using the exact UI-provided name (no sanitize).
              const dstName = it.name ? `${it.name}${ext}` : path.basename(found);
              const dst = path.join(out, dstName);
              try {
                fs.copyFileSync(found, dst);
                manifest.push({ name: it.name || safeName, src: dstName, posXYRot: it.posXYRot || (it.posXYRot === undefined ? [it.x || 0, it.y || 0, it.rotateDeg || 0] : it.posXYRot), scale: it.scale || 1, depthMM: it.depthMM || 0, type: it.type || 'dxf', cutType: it.cutType || null });
                results.push({ type: 'dxf', path: dst });
              } catch (e) {
                console.error('failed to copy referenced dxf to UI name', found, dst, e);
                results.push({ type: 'missing', requested: dstName, checked: [found], error: String(e) });
              }
              continue;
            }

            // As a last resort, search the repository recursively for the filename
            const search = (dir, name) => {
              try {
                const list = fs.readdirSync(dir);
                for (const f of list) {
                  const p = path.join(dir, f);
                  try {
                    const st = fs.lstatSync(p);
                    if (st.isDirectory()) {
                      const r = search(p, name);
                      if (r) return r;
                    } else if (f === name) {
                      return p;
                    }
                  } catch (e) { }
                }
              } catch (e) { return null; }
              return null;
            };

            const searchTolerant = (dir, nameLower) => {
              try {
                const list = fs.readdirSync(dir);
                for (const f of list) {
                  const p = path.join(dir, f);
                  try {
                    const st = fs.lstatSync(p);
                    if (st.isDirectory()) {
                      const r = searchTolerant(p, nameLower);
                      if (r) return r;
                    } else if (f.toLowerCase().includes(nameLower) || nameLower.includes(f.toLowerCase())) {
                      return p;
                    }
                  } catch (e) { }
                }
              } catch (e) { return null; }
              return null;
            };

            const recursiveFound = search(repoRoot, d);
            const recursiveFound2 = recursiveFound || searchTolerant(repoRoot, String(d).toLowerCase());
            if (recursiveFound) {
              try {
                const ext = path.extname(recursiveFound) || '.dxf';
                const dstName = it.name ? `${it.name}${ext}` : path.basename(recursiveFound);
                const dstPath = path.join(out, dstName);
                fs.copyFileSync(recursiveFound, dstPath);
                manifest.push({ name: it.name || safeName, src: dstName, posXYRot: it.posXYRot || [it.x || 0, it.y || 0, it.rotateDeg || 0], scale: it.scale || 1, depthMM: it.depthMM || 0, type: it.type || 'dxf', cutType: it.cutType || null });
                results.push({ type: 'dxf', path: dstPath, foundBy: 'recursive' });
              } catch (e) { results.push({ type: 'missing', requested: d, checked: candidates, error: String(e) }); }
            } else if (recursiveFound2) {
              try {
                const ext = path.extname(recursiveFound2) || '.dxf';
                const dstName = it.name ? `${it.name}${ext}` : path.basename(recursiveFound2);
                const dstPath = path.join(out, dstName);
                fs.copyFileSync(recursiveFound2, dstPath);
                manifest.push({ name: it.name || safeName, src: dstName, posXYRot: it.posXYRot || [it.x || 0, it.y || 0, it.rotateDeg || 0], scale: it.scale || 1, depthMM: it.depthMM || 0, type: it.type || 'dxf', cutType: it.cutType || null });
                results.push({ type: 'dxf', path: dstPath, foundBy: 'recursive_tolerant' });
              } catch (e) { results.push({ type: 'missing', requested: d, checked: candidates, error: String(e) }); }
            } else {
              console.warn('Referenced DXF not found in candidates for', d, 'checked', candidates);
              results.push({ type: 'missing', requested: d, checked: candidates });
            }
          }
        }
      } else if (it.type === 'text') {
        const txtPath = path.join(out, `${safeName}.text.json`);
        fs.writeFileSync(txtPath, JSON.stringify(it, null, 2), 'utf8');
        results.push({ type: 'textjson', path: txtPath });
      }
    }

    // spawn python helper to convert .poly.json and .text.json to DXF using existing processing code
    // write manifest for referenced DXF transforms
    if (manifest.length) {
      try {
        fs.writeFileSync(path.join(out, 'export_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      } catch (e) {
        console.error('failed to write export_manifest.json', e);
      }
    }

    const python = findPythonCmd(repoRoot);
    if (!python) {
      return res.status(500).json({ error: 'python_not_found', message: 'No Python interpreter found. Set GSM_PYTHON_EXE or install Python.' });
    }

    // Log processing_output contents and any synthesized .poly.json files
    try {
      const currentFiles = fs.existsSync(out) ? fs.readdirSync(out) : [];
      console.log('processing_output contents before export-dxfs:', out, currentFiles);
      const polyFiles = currentFiles.filter(f => f.toLowerCase().endsWith('.poly.json'));
      if (polyFiles.length) console.log('Found .poly.json files to export:', polyFiles);
      else console.log('No .poly.json files found in processing_output; Python export will have nothing to convert unless synthesis occurred.');
    } catch (e) { console.warn('Failed to list processing_output before export:', e); }

    const py = spawn(python.cmd, python.args.concat([path.join(__dirname, 'process_image.py'), '--export-dxfs', out, '--projectdir', repoRoot]), { stdio: 'inherit' });
    py.on('close', (code) => {
      // Clean up any temporary per-shape JSON files so processing_output
      // only contains final DXF assets. This removes .poly.json and
      // .text.json artifacts created earlier.
      try {
        const outFiles = fs.existsSync(out) ? fs.readdirSync(out) : [];
        for (const f of outFiles) {
          if (f.endsWith('.poly.json') || f.endsWith('.text.json')) {
            try { fs.unlinkSync(path.join(out, f)); } catch (e) { console.warn('failed to remove temp json', f, e); }
          }
        }
      } catch (e) { console.warn('cleanup failed', e); }

      if (code === 0) {
        return res.json({ ok: true, results });
      }
      return res.status(500).json({ error: 'python helper failed', code });
    });
    py.on('error', (err) => {
      console.error('python spawn error', err);
      return res.status(500).json({ error: 'python spawn error', detail: String(err) });
    });

  } catch (err) {
    console.error('export-dxfs handler error', err);
    return res.status(500).json({ error: 'export-dxfs failed', detail: String(err) });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Image processing server listening on http://localhost:${PORT}`);
});

// SSE endpoint: clients can subscribe to render events (stl ready notifications)
app.get('/api/render/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  // send a comment to establish the stream
  res.write(':ok\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Export SCAD file for a project by reading processing_output and manifest
app.post('/export-scad', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = String(body.projectName || 'default_project').replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_') || 'default_project';
    const repoRoot = path.join(__dirname, '..');
    const projectFolder = resolveProjectFolder(projectName);
    const out = path.join(projectFolder, 'processing_output');
    if (!fs.existsSync(projectFolder) || !fs.existsSync(out)) {
      return res.status(400).json({ error: 'project or processing_output not found', projectFolder, out });
    }

    // Prepare project folder for SCAD generation: ensure a local copy of `src`
    try {
      // Do not copy the repository `src` into the project folder. The
      // SCAD template and import routine should reference files relative
      // to the repository or the project's folder under `projects/`.

      // Delegate SCAD generation to the Python helper which will call
      // src.processing.import_to_openscad for robust behavior.
      const python = findPythonCmd(repoRoot);
      if (!python) {
        return res.status(500).json({ error: 'python_not_found', message: 'No Python interpreter found. Set GSM_PYTHON_EXE or install Python.' });
      }
      const py = spawn(python.cmd, python.args.concat([path.join(__dirname, 'process_image.py'), '--generate-scad', projectFolder, '--projectname', projectName, '--projectdir', repoRoot]), { stdio: ['ignore', 'pipe', 'pipe'] });
      let outBuf = '';
      let errBuf = '';
      py.stdout.on('data', (c) => { outBuf += String(c || ''); });
      py.stderr.on('data', (c) => { errBuf += String(c || ''); });
      py.on('close', (code) => {
        if (code !== 0) {
          console.error('python generate-scad failed', code, errBuf);
          return res.status(500).json({ error: 'python generate-scad failed', code, detail: errBuf || outBuf });
        }
        const outScad = path.join(projectFolder, `${projectName}.scad`);
          if (fs.existsSync(outScad)) {
            // read manifest/dxfs list for response
            const dirList = fs.existsSync(out) ? fs.readdirSync(out) : [];
            const dxfFiles = dirList.filter(f => f.toLowerCase().endsWith('.dxf'));
              // Hide legacy autogenerated `shape_N.dxf` files when a more
              // descriptive `Trace-N.dxf` (or similarly named) file exists for
              // the same numeric index. This avoids confusing downstream
              // consumers with duplicate entries while preserving the
              // on-disk files.
              try {
                const cleaned = [];
                const namesSet = new Set(dxfFiles.map(f => path.parse(f).name));
                const shapeRe = /^shape[_-]?(\d+)$/i;
                for (const f of dxfFiles) {
                  const base = path.parse(f).name;
                  const m = base.match(shapeRe);
                  if (m) {
                    const idx = m[1];
                    const traceName = `Trace-${idx}`;
                    if (namesSet.has(traceName)) {
                      // prefer Trace-N; skip adding shape_N to the returned list
                      continue;
                    }
                  }
                  cleaned.push(f);
                }
                // replace dxfFiles with cleaned list for the API response
                dxfFiles.length = 0;
                for (const f of cleaned) dxfFiles.push(f);
              } catch (e) {
                console.warn('Failed to dedupe dxfFiles for response', e);
              }
            let manifest = [];
            const manifestPath = path.join(out, 'export_manifest.json');
            if (fs.existsSync(manifestPath)) {
              try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = []; }
            }

            // Attempt to render SCAD -> STL using OpenSCAD CLI
            const outStl = path.join(projectFolder, `${projectName}.stl`);

            // Resolve OpenSCAD CLI executable. Preference order:
            // 1) `OPENSCAD_BIN` environment variable (full path) — prefer openscad.com
            // 2) common Windows install locations (try openscad.com then openscad.exe)
            // 3) check PATH for openscad.com or openscad.exe
            // Use the manifold backend for faster, manifold meshes when available.
            const openscadArgs = ['--backend=manifold', '-o', outStl, outScad];
            const envBin = process.env.OPENSCAD_BIN && String(process.env.OPENSCAD_BIN).trim();
            const commonPaths = [
              path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenSCAD', 'openscad.com'),
              path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenSCAD', 'openscad.exe'),
              path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenSCAD (Nightly)', 'openscad.com'),
              path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenSCAD (Nightly)', 'openscad.exe')
            ];
            let chosen = null;
            if (envBin && fs.existsSync(envBin)) {
              chosen = envBin;
            } else {
              for (const p of commonPaths) {
                try { if (fs.existsSync(p)) { chosen = p; break; } } catch (e) { /* ignore */ }
              }
            }
            // If still not found, check synchronously whether `openscad.com` or `openscad.exe` exists on PATH.
            if (!chosen) {
              try {
                const cmds = process.platform === 'win32' ? ['where openscad.com', 'where openscad.exe', 'where openscad'] : ['which openscad'];
                for (const cmd of cmds) {
                  try {
                    const whereOut = String(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
                    if (whereOut) {
                      const first = whereOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
                      if (first && fs.existsSync(first)) { chosen = first; break; }
                    }
                  } catch (e) { /* ignore this attempt */ }
                }
              } catch (e) { /* ignore */ }
              if (!chosen) {
                return res.status(500).json({
                  error: 'openscad not found',
                  detail: 'OpenSCAD CLI not found. Set environment variable OPENSCAD_BIN to the full path to openscad.com (Windows) or ensure `openscad.com`/`openscad.exe` is on PATH. Example (PowerShell): $env:OPENSCAD_BIN = "C:\\Program Files\\OpenSCAD\\openscad.com"'
                });
              }
            }
            try {
              let responded = false;
              const osSpawn = spawn(chosen, openscadArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: projectFolder });
              let osOut = '';
              let osErr = '';
              osSpawn.stdout.on('data', (c) => { osOut += String(c || ''); });
              osSpawn.stderr.on('data', (c) => { osErr += String(c || ''); });
              osSpawn.on('close', (ocode) => {
                if (responded) return;
                responded = true;
                if (ocode === 0 && fs.existsSync(outStl)) {
                  try {
                    const stlUrl = `/api/render/output-stl?projectName=${encodeURIComponent(projectName)}`;
                    // Notify any SSE subscribers that an STL for this project is ready
                    sendSseEvent('stl', { projectName, stlUrl });
                  } catch (e) { /* non-fatal */ }
                  // Cleanup: remove all contents of the project's processing_output
                  try {
                    if (fs.existsSync(out)) {
                      const list = fs.readdirSync(out, { withFileTypes: true });
                      for (const ent of list) {
                        const p = path.join(out, ent.name);
                        try {
                          if (ent.isDirectory()) {
                            try { fs.rmdirSync(p, { recursive: true }); } catch (e) { /* fallback */ fs.rmSync ? fs.rmSync(p, { recursive: true, force: true }) : null; }
                          } else {
                            try { fs.unlinkSync(p); } catch (e) { console.warn('Failed to unlink during processing_output cleanup', p, e); }
                          }
                        } catch (e) { console.warn('Failed to remove processing_output entry', p, e); }
                      }
                      console.log('Cleaned processing_output for project', projectName, 'at', out);
                    }
                  } catch (e) {
                    console.warn('Failed to cleanup processing_output for project', projectName, e);
                  }

                  return res.json({ ok: true, scad: outScad, stl: outStl, dxfFiles, manifest, python_stdout: outBuf, openscad_stdout: osOut });
                }
                console.error('openscad failed', ocode, osErr || osOut);
                return res.status(500).json({ error: 'openscad failed', code: ocode, scad: outScad, detail: osErr || osOut });
              });
              osSpawn.on('error', (e) => {
                if (responded) return;
                responded = true;
                console.error('failed to spawn openscad', e);
                return res.status(500).json({ error: 'failed to spawn openscad', detail: String(e), scad: outScad });
              });
              return; // response will be sent from openscad handlers
            } catch (e) {
              console.error('openscad spawn exception', e);
              return res.status(500).json({ error: 'openscad spawn exception', detail: String(e), scad: outScad });
            }
          }
          return res.status(500).json({ error: 'scad not created', out: outBuf, err: errBuf });
      });
      py.on('error', (err) => {
        console.error('python spawn error', err);
        return res.status(500).json({ error: 'python spawn error', detail: String(err) });
      });
      return; // response will be sent from python close handler
    } catch (err) {
      console.error('export-scad failed', err);
      return res.status(500).json({ error: 'export-scad failed', detail: String(err) });
    }
  } catch (err) {
    console.error('export-scad failed', err);
    return res.status(500).json({ error: 'export-scad failed', detail: String(err) });
  }
});

// Serve generated STL for a project. Query params: ?projectName=MyProject
app.get('/api/render/output-stl', (req, res) => {
  try {
    const projectName = String(req.query.projectName || req.query.project || 'default_project').replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_') || 'default_project';
    const stlPath = path.join(resolveProjectFolder(projectName), `${projectName}.stl`);
    if (!fs.existsSync(stlPath)) {
      return res.status(404).json({ error: 'stl not found', path: stlPath });
    }
    return res.sendFile(stlPath);
  } catch (e) {
    console.error('failed to serve output.stl', e);
    return res.status(500).json({ error: 'failed to serve stl', detail: String(e) });
  }
});

// List projects that contain an output.stl file (for viewer auto-detection)
app.get('/api/render/projects', (req, res) => {
  try {
    const projectsRoot = path.join(REPO_ROOT, 'projects');
    if (!fs.existsSync(projectsRoot)) return res.json([]);
    // When using single projects folder for GSM- auto projects we list
    // subfolders (non-GSM) and also include the projects root itself if
    // any STLs were written directly into it. Gather directories and
    // check both the root and its subdirectories for stl files.
    const roots = fs.readdirSync(projectsRoot, { withFileTypes: true }).filter(d => d.isDirectory());
    const projects = [];
    for (const d of roots) {
      const stl = path.join(projectsRoot, d.name, `${d.name}.stl`);
      if (fs.existsSync(stl)) {
        const stat = fs.statSync(stl);
        projects.push({ name: d.name, stlPath: stl, mtime: stat.mtimeMs });
      }
    }
    // sort most recent first
    projects.sort((a, b) => b.mtime - a.mtime);
    return res.json(projects);
  } catch (e) {
    console.error('failed to list render projects', e);
    return res.status(500).json({ error: 'failed to list projects', detail: String(e) });
  }
});
