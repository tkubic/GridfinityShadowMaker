const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();

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

app.use(express.json({ limit: '50mb' }));

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
      projectFolder = path.join(__dirname, '..', projectName);
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
                const meta = { original: origName };
                fs.writeFileSync(path.join(projectFolder, 'project.json'), JSON.stringify(meta, null, 2), 'utf8');
                console.log('Wrote project.json with original:', origName);
              } catch (wj) {
                console.error('Failed to write project.json', wj);
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
  const pyArgs = [path.join(__dirname, 'process_image.py'), workInputPath, workingOutDir, '--projectdir', repoRoot];
  if (projectFolder) {
    // Also tell the Python side where to put per-project outputs and where the
    // project image lives.
    pyArgs.push('--workfolder', projectFolder);
  }
  if (threshold) pyArgs.push('--threshold', String(threshold));
  if (offset) pyArgs.push('--offset', String(offset));
  if (token) pyArgs.push('--token', String(token));
  if (resolution) pyArgs.push('--resolution', String(resolution));

  const py = spawn('python', pyArgs, { stdio: 'inherit' });

  console.log('Spawning python with args:', pyArgs);
  console.log('Final workInputPath before processing:', workInputPath);

  py.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'python failed', code });
    }

    try {
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

      // include which input file was used so frontend can verify
      res.json({ original, traced, offset, dxf: dxfInfo, used_input: workInputPath });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed to read outputs' });
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

    const projectFolder = path.join(__dirname, '..', projectName);
    fs.mkdirSync(projectFolder, { recursive: true });

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
    const projectFolder = path.join(repoRoot, projectName);
    if (!fs.existsSync(projectFolder)) fs.mkdirSync(projectFolder, { recursive: true });
    const out = path.join(projectFolder, 'processing_output');
    if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

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

    const py = spawn('python', [path.join(__dirname, 'process_image.py'), '--export-dxfs', out, '--projectdir', repoRoot], { stdio: 'inherit' });
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

// Export SCAD file for a project by reading processing_output and manifest
app.post('/export-scad', (req, res) => {
  try {
    const body = req.body || {};
    const projectName = String(body.projectName || 'default_project').replace(/[<>:\"/\\|?*\x00-\x1F]/g, '_') || 'default_project';
    const repoRoot = path.join(__dirname, '..');
    const projectFolder = path.join(repoRoot, projectName);
    const out = path.join(projectFolder, 'processing_output');
    if (!fs.existsSync(projectFolder) || !fs.existsSync(out)) {
      return res.status(400).json({ error: 'project or processing_output not found', projectFolder, out });
    }

    // Prepare project folder for SCAD generation: ensure a local copy of `src`
    try {
      const repoSrc = path.join(repoRoot, 'src');
      const dstSrc = path.join(projectFolder, 'src');
      if (fs.existsSync(repoSrc)) {
        // prefer fs.cpSync when available (Node 16.7+), otherwise fallback to recursive copy
        try {
          if (fs.cpSync) {
            fs.cpSync(repoSrc, dstSrc, { recursive: true });
          } else {
            // simple recursive copy
            const copyRecursive = (src, dst) => {
              if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
              const entries = fs.readdirSync(src, { withFileTypes: true });
              for (const ent of entries) {
                const s = path.join(src, ent.name);
                const d = path.join(dst, ent.name);
                if (ent.isDirectory()) copyRecursive(s, d);
                else fs.copyFileSync(s, d);
              }
            };
            copyRecursive(repoSrc, dstSrc);
          }
        } catch (e) {
          console.warn('Failed to copy repo src into project folder (continuing):', e);
        }
      }

      // Delegate SCAD generation to the Python helper which will call
      // src.processing.import_to_openscad for robust behavior.
      const py = spawn('python', [path.join(__dirname, 'process_image.py'), '--generate-scad', projectFolder, '--projectdir', repoRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
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
          const dirList = fs.readdirSync(out);
          const dxfFiles = dirList.filter(f => f.toLowerCase().endsWith('.dxf'));
          let manifest = [];
          const manifestPath = path.join(out, 'export_manifest.json');
          if (fs.existsSync(manifestPath)) {
            try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = []; }
          }
          return res.json({ ok: true, scad: outScad, dxfFiles, manifest, python_stdout: outBuf });
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
