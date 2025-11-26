import React, { useState, useRef } from "react";
import "./App.css";
import type { BoardConfig, CutType, ToolShape, Project } from "./types";
import Header from "./components/Header";
import LeftPanel from "./components/LeftPanel";
import Canvas from "./components/Canvas";
import Inspector from "./components/Inspector";
import TraceCanvas from "./components/TraceCanvas";
import RenderCanvas from "./components/RenderCanvas";
import { parseDxf } from "./utils/dxf";
function App() {
  // Generate a default project name like GSM-YYYYMMDD-Hmm (e.g. GSM-20251124-351)
  function getDefaultProjectName() {
    const d = new Date();
    const YYYY = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');
    const H = d.getHours(); // hour without leading zero per requested format
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `GSM-${YYYY}${MM}${DD}-${H}${mm}`;
  }
  // ==== Dragging state ====
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );

  // ==== Shape / board data ====
  const [project, setProject] = useState<Project>({
    name: getDefaultProjectName(),
    board: {
      gridX: 5,
      gridY: 3,
      cellSizeMM: 42,
      height7Units: 6,
    },
    shapes: [],
  });

  // selectedItem: "board" or a shape id
  const [selectedItem, setSelectedItem] = useState<"board" | string>("board");
  const [shapeCounter, setShapeCounter] = useState<number>(0);
  // local edit fields for inspector inputs (allow typing before commit)
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  const { board, shapes } = project;

  // Refs and state for measuring and adjusting SVG text size so mm->px mapping is accurate
  // removed measurement refs — using direct mm->px scale for font sizing

  // Measure and correct text node sizes after paint to better match requested mm height.
  // (Effect will be placed after scaleX/scaleY are defined.)

  // FONT_OPTIONS is imported from `types.ts`.

  // Determine drawing order: Cut (red) bottom, Blocker (black) middle, Raised (white) top
  function layerPriority(s: ToolShape) {
    if (s.cutType === "Blocker") return 1;
    if (s.cutType === "Raised") return 2;
    return 0; // Cut or undefined
  }

  const drawShapes = shapes
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const p = layerPriority(a.s) - layerPriority(b.s);
      if (p !== 0) return p;
      return a.i - b.i; // stable by insertion order
    })
    .map((x) => x.s);

  const MAX_CANVAS_WIDTH_PX = 1000;

  const boardWidthMM = board.gridX * board.cellSizeMM;
  const boardHeightMM = board.gridY * board.cellSizeMM;

  // Always max width; height scales with gridY
  const pixelsPerUnit = Math.max(
    5,
    MAX_CANVAS_WIDTH_PX / Math.max(1, board.gridX)
  );

  const boardPxWidth = Math.round(MAX_CANVAS_WIDTH_PX);
  const boardPxHeight = Math.round(board.gridY * pixelsPerUnit);

  // uniform scale (px per mm)
  const scaleX = boardPxWidth / boardWidthMM;
  const scaleY = boardPxHeight / boardHeightMM;

  // Correction factor observed: setting font to 58mm rendered ~42mm visually.
  // Apply factor so user-entered mm more closely matches visual size.
  const FONT_SIZE_CORRECTION = 58 / 42; // ≈1.38095

  // Text sizing uses direct mm->px conversion (px per mm) — no measurement loop.

  function updateShape(id: string, partial: Partial<ToolShape>) {
    setProject((prev) => ({
      ...prev,
      shapes: prev.shapes.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    }));
  }

  function updateBoard(partial: Partial<BoardConfig>) {
    setProject((prev) => ({
      ...prev,
      board: { ...prev.board, ...partial },
    }));
  }

  // commit buffered edit field into selected shape
  function commitEditField(key: string) {
    if (!selectedShape) return;
    const raw = editFields[key];
    if (raw === undefined) return;

    if (key === "x" || key === "y") {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) return;
      const rounded = Math.round(v * 10) / 10;
      updateShape(selectedShape.id, { [key]: rounded } as Partial<ToolShape>);
      setEditFields((p) => ({ ...p, [key]: rounded.toFixed(1) }));
      return;
    }

    if (key === "scale") {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) return;
      const rounded = Math.max(0.1, Math.round(v * 10) / 10);
      updateShape(selectedShape.id, { scale: rounded });
      setEditFields((p) => ({ ...p, scale: rounded.toFixed(1) }));
      return;
    }

    if (key === "rotate") {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) return;
      const rounded = Math.round(v * 1); // integer degrees
      updateShape(selectedShape.id, { rotateDeg: rounded });
      setEditFields((p) => ({ ...p, rotate: rounded.toFixed(1) }));
      return;
    }

    if (key === "width" || key === "height") {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) return;
      updateShape(selectedShape.id, { [key === "width" ? "widthMM" : "heightMM"]: v } as Partial<ToolShape>);
      setEditFields((p) => ({ ...p, [key]: v.toString() }));
      return;
    }

    // radius parameter removed: use width/height for ovals
    if (key === "depth") {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) return;
      updateShape(selectedShape.id, { depthMM: v });
      setEditFields((p) => ({ ...p, depth: v.toFixed(1) }));
      return;
    }
      if (key === "fontSize") {
        const v = parseFloat(raw);
        if (Number.isNaN(v)) return;
        updateShape(selectedShape.id, { fontSizeMM: v });
        setEditFields((p) => ({ ...p, fontSize: v.toFixed(1) }));
        return;
      }
    if (key === "cutType") {
      const v = raw as CutType;
      if (!v) return;
      updateShape(selectedShape.id, { cutType: v });
      setEditFields((p) => ({ ...p, cutType: v }));
      return;
    }
  }

  function addDefaultShape() {
    const next = shapeCounter + 1;
    const id = `shape-${next}`;
    setShapeCounter(next);
    const newShape: ToolShape = {
      id,
      type: "oval",
      name: `Shape-${next}`,
      x: boardWidthMM / 2,
      y: boardHeightMM / 2,
      widthMM: 20,
      heightMM: 20,
      depthMM: 15,
      cutType: "Cut",
    };
    setProject((prev) => ({ ...prev, shapes: [...prev.shapes, newShape] }));
    selectItem(id);
  }

  function addTextShape() {
    const next = shapeCounter + 1;
    const id = `shape-${next}`;
    setShapeCounter(next);
    const newShape: ToolShape = {
      id,
      type: "text",
      name: `Text-${next}`,
      x: boardWidthMM / 2,
      y: boardHeightMM / 2,
      text: "Text",
      fontName: "Nunito, Arial, Helvetica, sans-serif",
      fontSizeMM: 15,
      depthMM: 0.6,
      cutType: "Raised",
      fontBold: false,
      fontItalic: false,
      fontUnderline: false,
    };
    setProject((prev) => ({ ...prev, shapes: [...prev.shapes, newShape] }));
    selectItem(id);
  }

  function deleteShape(id: string) {
    setProject((prev) => ({
      ...prev,
      shapes: prev.shapes.filter((s) => s.id !== id),
    }));
    selectItem("board");
    setDraggingId(null);
    setDragOffset(null);
  }

  // hidden file input ref for DXF import
  const dxfInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const gsmInputRef = useRef<HTMLInputElement | null>(null);
  // image input for Trace tab
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<"trace" | "canvas" | "render">("canvas");
  const [processedImages, setProcessedImages] = useState<{ original?: string | null; traced?: string | null; offset?: string | null; dxf?: { dxf_path?: string | null; gridx_size?: number; gridy_size?: number } | null; used_input?: string | null } | null>(null);

  // Lifted trace params so Load Image can include the inspector values
  const [traceParams, setTraceParams] = useState<{ threshold: number; offset: number; token: number; resolution: number }>({ threshold: 145, offset: 0.1, token: 3.0, resolution: 20 });

  function saveProjectToFile() {
    try {
      // prompt the user for a filename (default to project.name)
      const suggested = project.name || "project";
      const fnameRaw = window.prompt("Save project as", suggested);
      if (!fnameRaw) return; // user cancelled
      const safeName = fnameRaw.replace(/[^a-z0-9-_ ]/gi, "_").trim() || suggested;
      const gsmName = `${safeName}.gsm`;

      // Try to save into the project folder on the server. If that fails, fall back to client download.
      const payload = { projectName: project.name || suggested, gsmName, project };
      fetch('http://localhost:5000/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(r => r.json())
        .then(j => {
          if (j && j.ok) {
            alert('Project saved to project folder: ' + j.path);
            return;
          }
          throw new Error((j && j.error) || 'save failed');
        })
        .catch(() => {
          // fallback: download as .gsm locally
          const data = JSON.stringify(project, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = gsmName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          alert('Saved locally as ' + gsmName);
        });
    } catch (err) {
      console.error("Failed to save project:", err);
    }
  }

  function handleGsmFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = reader.result as string;
        const parsed = JSON.parse(txt) as Project;
        if (!parsed || !parsed.board || !Array.isArray(parsed.shapes)) {
          throw new Error("Not a valid GSM project file");
        }
        // Basic normalization: ensure shape ids are strings and compute next counter
        let maxCounter = shapeCounter;
        for (const s of parsed.shapes) {
          if (!s.id) s.id = `shape-${++maxCounter}`;
          // ensure numeric counter from id
          const m = /^shape-(\d+)$/.exec(s.id || "");
          if (m) maxCounter = Math.max(maxCounter, parseInt(m[1], 10));
        }
        setShapeCounter(maxCounter);
        setProject(parsed);
        // reset selection and edit fields
        selectItem("board");
      } catch (err) {
        console.error("Failed to load GSM file:", err);
        alert("Failed to load project file. The file may be invalid.");
      }
    };
    reader.readAsText(file);
    e.currentTarget.value = "";
  }

  // helper functions moved into Canvas component

  // === DXF import ===
  async function handleDxfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    const created: ToolShape[] = [];
    let nextCounter = shapeCounter;

    for (const file of files) {
      try {
        const content = await file.text();
        const parsedPaths = parseDxf(content);

        nextCounter += 1;
        const id = `shape-${nextCounter}`;

        const boardCenterXmm = boardWidthMM / 2;
        const boardCenterYmm = boardHeightMM / 2;

        if (parsedPaths && parsedPaths.length) {
          // Compute bounding box and centroid so rotations occur around the
          // shape center. We store dxfPaths relative to that centroid while
          // keeping the final rendered coordinates identical (shape.x + p.x).
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const path of parsedPaths) {
            for (const p of path) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }
          }
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const relPaths = parsedPaths.map((path) => path.map((p) => ({ x: p.x - cx, y: p.y - cy })));

            // Use filename without extension as the display name
            const baseName = file.name.replace(/\.[^/.]+$/, "");
            const newShape: ToolShape = {
              id,
              type: "dxf",
              name: `DXF - ${baseName}`,
              dxfName: file.name,
              x: Math.round(cx * 10) / 10,
              y: Math.round(cy * 10) / 10,
              scale: 1,
              dxfPaths: relPaths,
              widthMM: Math.round((maxX - minX) * 10) / 10,
              heightMM: Math.round((maxY - minY) * 10) / 10,
              depthMM: 15,
              cutType: "Cut",
            };

          created.push(newShape);
        } else {
          const placeholderWidth = Math.min(boardWidthMM * 0.8, 200);
          const placeholderHeight = Math.min(boardHeightMM * 0.8, 200);
          const newShape: ToolShape = {
            id,
            type: "dxf",
            name: `DXF - ${file.name}`,
            dxfName: file.name,
            x: Math.round(boardCenterXmm * 10) / 10,
            y: Math.round(boardCenterYmm * 10) / 10,
            widthMM: Math.round(placeholderWidth * 10) / 10,
            heightMM: Math.round(placeholderHeight * 10) / 10,
            scale: 1,
            depthMM: 15,
            cutType: "Cut",
          };
          created.push(newShape);
        }
      } catch (err) {
        console.error('Failed to import DXF file', file.name, err);
      }
    }

    if (created.length) {
      setShapeCounter(nextCounter);
      setProject((prev) => ({ ...prev, shapes: [...prev.shapes, ...created] }));
      // select last imported shape
      selectItem(created[created.length - 1].id);
    }

    // allow re-selecting same file later
    e.currentTarget.value = "";
  }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const fd = new FormData();
    fd.append('image', file);
    // include project name so server can mimic desktop load_image behavior
    fd.append('project', project.name || 'project');
    // include current trace params so Load Image uses the values from the inspector
    fd.append('threshold', String(traceParams.threshold));
    fd.append('offset', String(traceParams.offset));
    fd.append('token', String(traceParams.token));
    fd.append('resolution', String(traceParams.resolution));

    fetch('http://localhost:5000/process-image', { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          console.error('processing error', j);
          alert('Processing failed: ' + (j.error || 'unknown'));
          return;
        }
        setProcessedImages({ original: j.original, traced: j.traced, offset: j.offset, dxf: j.dxf, used_input: j.used_input });
      })
      .catch((err) => {
        console.error('upload failed', err);
        alert('Upload failed: ' + err.message);
      })
      .finally(() => {
        e.currentTarget.value = "";
      });
  }

  function captureImage() {
    alert("Capture Image not implemented in this UI mockup.");
  }

  const selectedShape =
    selectedItem === "board"
      ? null
      : shapes.find((s) => s.id === selectedItem) || null;

  // Helper to select an item and initialize buffered edit fields
  function selectItem(id: "board" | string) {
    if (id === "board") {
      setSelectedItem("board");
      setEditFields({});
      return;
    }
    const s = project.shapes.find((sh) => sh.id === id) || null;
    setSelectedItem(id);
    if (!s) {
      setEditFields({});
      return;
    }
    // determine depth edit field based on cutType/type
    const cut = s.cutType ?? (s.type === "text" ? "Raised" : "Cut");
    let depthField: string | undefined;
    if (cut === "Blocker") {
      const boardUnits = board.height7Units ?? 6;
      const blockerDepth = Math.max(0, boardUnits - 1) * 7;
      depthField = blockerDepth.toFixed(1);
    } else if (s.depthMM !== undefined && s.depthMM !== null) {
      depthField = s.depthMM.toFixed(1);
    } else if (cut === "Cut") {
      depthField = (15).toFixed(1);
    } else if (cut === "Raised") {
      depthField = (0.6).toFixed(1);
    } else if (s.type === "text") {
      depthField = (0.6).toFixed(1);
    } else {
      depthField = (0.6).toFixed(1);
    }

    const baseFields: Record<string, string> = {
      x: (s.x ?? 0).toFixed(1),
      y: (s.y ?? 0).toFixed(1),
      scale: ((s.scale ?? 1)).toFixed(1),
      rotate: ((s.rotateDeg ?? 0)).toFixed(1),
      width: (s.widthMM ?? 0).toString(),
      height: (s.heightMM ?? 0).toString(),
      // radius removed; oval uses width/height
      cutType: (s.cutType ?? (s.type === "text" ? "Raised" : "Cut")),
      font: s.fontName ?? "'Arial Rounded MT Bold', Arial, Helvetica, sans-serif",
      fontSize: ((s.fontSizeMM ?? 15)).toFixed(1),
      text: s.text ?? s.name,
      fontBold: s.fontBold ? "1" : "0",
      fontItalic: s.fontItalic ? "1" : "0",
      fontUnderline: s.fontUnderline ? "1" : "0",
    };

    if (depthField !== undefined) {
      baseFields.depth = depthField;
    }

    setEditFields(baseFields);
  }

  // ==== Render ====
  return (
    <div className="app-root">
      {/* Top bar (extracted) */}
      <Header
        projectName={project.name}
        onRename={(n) => setProject((p) => ({ ...p, name: n }))}
        onSave={() => saveProjectToFile()}
        onLoadClick={() => gsmInputRef.current?.click()}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
      <input ref={gsmInputRef} type="file" accept=".gsm,application/json" style={{ display: 'none' }} onChange={handleGsmFile} />

      <div className="app-main">
        {/* Left Panel (extracted) */}
        <LeftPanel
          activeTab={activeTab}
          shapes={shapes}
          selectedItem={selectedItem}
          selectItem={selectItem}
          addDefaultShape={addDefaultShape}
          addTextShape={addTextShape}
          dxfInputRef={dxfInputRef}
          handleDxfFile={handleDxfFile}
          imageInputRef={imageInputRef}
          handleImageFile={handleImageFile}
          onCaptureImage={captureImage}
        />

        {/* Canvas (extracted) */}
        <main className="canvas-container">
          {activeTab === "canvas" ? (
            <Canvas
              boardPxWidth={boardPxWidth}
              boardPxHeight={boardPxHeight}
              board={board}
              drawShapes={drawShapes}
              scaleX={scaleX}
              scaleY={scaleY}
              selectedItem={selectedItem}
              selectItem={selectItem}
              updateShape={updateShape}
              draggingId={draggingId}
              dragOffset={dragOffset}
              setDraggingId={setDraggingId}
              setDragOffset={setDragOffset}
              FONT_SIZE_CORRECTION={FONT_SIZE_CORRECTION}
              textInputRef={textInputRef}
              deleteShape={deleteShape}
            />
          ) : activeTab === "trace" ? (
            <TraceCanvas images={processedImages ?? undefined} />
          ) : (
            <RenderCanvas />
          )}
        </main>
        {/* Export controls for the Canvas tab */}
        {activeTab === 'canvas' && (
          <div style={{ padding: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <button
              onClick={async () => {
                try {
                  const items: any[] = [];
                  function rotatePoint(px: number, py: number, deg: number) {
                    const r = (deg * Math.PI) / 180.0;
                    const cosr = Math.cos(r);
                    const sinr = Math.sin(r);
                    return { x: px * cosr - py * sinr, y: px * sinr + py * cosr };
                  }

                  for (const s of project.shapes) {
                    if (s.type === 'dxf') {
                      // Prefer embedded parsed polylines (client-side) so exports work
                      // even when the original DXF file isn't available on the server.
                      if (s.dxfPaths && s.dxfPaths.length) {
                        const scale = s.scale ?? 1;
                        const rotDeg = s.rotateDeg || 0;
                        const polylines = s.dxfPaths.map((path: any) =>
                          path.map((p: any) => {
                            const sx = (p.x || 0) * scale;
                            const sy = (p.y || 0) * scale;
                            // invert rotation direction to match canvas expectation
                            const rpt = rotatePoint(sx, sy, -rotDeg);
                            return { x: (s.x || 0) + rpt.x, y: (s.y || 0) + rpt.y };
                          })
                        );
                        items.push({ name: s.name || s.id, polylines, posXYRot: [0, 0, 0] });
                        continue;
                      }
                      if (s.dxfName) {
                        items.push({ name: s.name || s.id, dxfPaths: [s.dxfName], posXYRot: [s.x || 0, s.y || 0, s.rotateDeg || 0], scale: s.scale ?? 1 });
                        continue;
                      }
                      continue;
                    }

                    // primitives and text -> polylines
                    // For rectangles the stored x,y may be bottom-left on the canvas;
                    // convert to center-origin for export so DXFs are centered around shape.x/y
                    let cx = s.x || 0;
                    let cy = s.y || 0;
                    const rot = s.rotateDeg || 0;
                    const polylines: Array<Array<{ x: number; y: number }>> = [];
                    if (s.type === 'rect') {
                      const w = s.widthMM || 0;
                      const h = s.heightMM || 0;
                      const halfW = w / 2;
                      const halfH = h / 2;
                      // shape.x/shape.y are already center-origin; no conversion needed
                      // invert rotation sign so exported primitive rotation matches canvas
                      const corners = [
                        { x: -halfW, y: -halfH },
                        { x: halfW, y: -halfH },
                        { x: halfW, y: halfH },
                        { x: -halfW, y: halfH },
                      ].map((p) => rotatePoint(p.x, p.y, -rot)).map((p) => ({ x: p.x + cx, y: p.y + cy }));
                      polylines.push(corners);
                    } else if (s.type === 'oval') {
                      const w = s.widthMM || 20;
                      const h = s.heightMM || 20;
                      const rx = w / 2;
                      const ry = h / 2;
                      const segments = 64;
                      const pts: Array<{ x: number; y: number }> = [];
                      for (let i = 0; i < segments; i++) {
                        const t = (i / segments) * 2 * Math.PI;
                        const px = rx * Math.cos(t);
                        const py = ry * Math.sin(t);
                        // invert rotation sign so exported primitive rotation matches canvas
                        const rpt = rotatePoint(px, py, -rot);
                        pts.push({ x: rpt.x + cx, y: rpt.y + cy });
                      }
                      polylines.push(pts);
                    } else if (s.type === 'text') {
                      // send text for server-side vectorization (glyph outlines)
                      items.push({ name: s.name || s.id, type: 'text', text: s.text || s.name || '', fontSize: s.fontSizeMM || 15, posXYRot: [cx, cy, rot] });
                      continue;
                    }

                    if (polylines.length) items.push({ name: s.name || s.id, polylines, posXYRot: [0, 0, 0] });
                  }

                  const payload = { projectName: project.name, items };
                  const r = await fetch('http://localhost:5000/export-dxfs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                  const j = await r.json();
                  if (!r.ok) {
                    alert('Export DXFs failed: ' + (j && j.error ? j.error : r.statusText));
                    return;
                  }
                  if (j && j.ok) {
                    alert('DXF files written to project processing_output/');
                  } else {
                    alert('Export DXFs completed with unknown result; check server logs.');
                  }
                } catch (e) {
                  console.error('output dxfs failed', e);
                  alert('Output DXFs failed: ' + (e && (e as Error).message ? (e as Error).message : String(e)));
                }
              }}
            >
              Output DXF's
            </button>
          </div>
        )}

        <Inspector
          board={board}
          selectedItem={selectedItem}
          selectedShape={selectedShape}
          editFields={editFields}
          setEditFields={setEditFields}
          commitEditField={commitEditField}
          updateShape={updateShape}
          updateBoard={updateBoard}
          deleteShape={deleteShape}
          textInputRef={textInputRef}
          activeTab={activeTab}
          processImageAgain={(params) => {
            // trigger re-processing using saved project image; send params as form data
            const fd = new FormData();
            fd.append('project', project.name || 'project');
            if (params.threshold !== undefined) fd.append('threshold', String(params.threshold));
            if (params.offset !== undefined) fd.append('offset', String(params.offset));
            if (params.token !== undefined) fd.append('token', String(params.token));
            if (params.resolution !== undefined) fd.append('resolution', String(params.resolution));

            fetch('http://localhost:5000/process-image', { method: 'POST', body: fd })
              .then((r) => r.json())
              .then((j) => {
                if (j.error) {
                  alert('Processing failed: ' + j.error);
                  console.error(j);
                  return;
                }
                setProcessedImages({ original: j.original, traced: j.traced, offset: j.offset, dxf: j.dxf, used_input: j.used_input });
              })
              .catch((err) => {
                console.error('reprocess failed', err);
                alert('Reprocess failed: ' + err.message);
              });
          }}
          traceParams={traceParams}
          setTraceParams={setTraceParams}
        />
      </div>
    </div>
  );
}

export default App;
