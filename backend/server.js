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
            const walk = (dir) => {
              let results = [];
              const list = fs.readdirSync(dir);
              for (const file of list) {
                const p = path.join(dir, file);
                const stat = fs.lstatSync(p);
                if (stat.isDirectory()) results = results.concat(walk(p));
                else if (p.match(/\.(png|jpg|jpeg)$/i)) results.push(p);
              }
              return results;
            };

            try {
              // only scan if we don't already have a canonical original
              if (!workInputPath) {
                const entries = walk(projectFolder);
                if (entries.length) {
                  // Prefer the highest-quality original image when reprocessing.
                  // Heuristic: exclude known processed output names (traced/offset/processing_output)
                  // and choose the largest file by byte-size. Falls back to newest if nothing else.
                  const excludedNameParts = ['traced', 'offset', 'processing_output', '_traced', '_offset', 'overlay', 'mask'];
                  const filtered = entries.filter((p) => {
                    const name = path.basename(p).toLowerCase();
                    if (excludedNameParts.some(part => name.includes(part))) return false;
                    // exclude any file that lives inside a processing_output folder
                    if (p.toLowerCase().includes('processing_output')) return false;
                    return true;
                  });

                  let candidate = null;
                  if (filtered.length) {
                    // pick largest file (heuristic for best quality)
                    filtered.sort((a, b) => {
                      const aSz = fs.statSync(a).size || 0;
                      const bSz = fs.statSync(b).size || 0;
                      return bSz - aSz;
                    });
                    candidate = filtered[0];
                    console.log('Selected largest candidate for reprocess (excluded processed files):', candidate);
                  } else {
                    // fallback: prefer newest image that isn't in processing_output
                    const nonOutput = entries.filter(p => !p.toLowerCase().includes('processing_output'));
                    if (nonOutput.length) {
                      nonOutput.sort((a, b) => {
                        const aMs = fs.statSync(a).mtimeMs || 0;
                        const bMs = fs.statSync(b).mtimeMs || 0;
                        return bMs - aMs;
                      });
                      candidate = nonOutput[0];
                      console.log('Fallback: selected newest non-output image for reprocess:', candidate);
                    } else {
                      // last resort: pick newest overall
                      entries.sort((a, b) => {
                        const aMs = fs.statSync(a).mtimeMs || 0;
                        const bMs = fs.statSync(b).mtimeMs || 0;
                        return bMs - aMs;
                      });
                      candidate = entries[0];
                      console.log('Fallback: selected newest image (no better candidate):', candidate);
                    }
                  }

                  if (candidate) {
                    workInputPath = candidate;
                    console.log('Found existing project image for reprocess:', workInputPath);
                  }
                }
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

    const outPath = path.join(projectFolder, gsmName);
    fs.writeFileSync(outPath, JSON.stringify(projectObj || {}, null, 2), 'utf8');
    console.log('Saved GSM project to', outPath);

    return res.json({ ok: true, path: outPath });
  } catch (e) {
    console.error('Failed to save project gsm', e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Image processing server listening on http://localhost:${PORT}`);
});
