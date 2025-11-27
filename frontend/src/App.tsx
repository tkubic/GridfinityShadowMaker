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
import { convertTextShapeToPolygons } from "./lib/textToPolylines";
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
  // `selectedItems` holds the multi-selection (ctrl/meta click)
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
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
    // Apply the partial update and, if the update touches text/font properties,
    // attempt to re-vectorize the text into `dxfPaths` so the canvas contains
    // exact vector geometry immediately.
    const nextProject = ((): typeof project => {
      const next = {
        ...project,
        shapes: project.shapes.map((s) => (s.id === id ? { ...s, ...partial } : s)),
      } as typeof project;
      return next;
    })();
    setProject(nextProject);

    // If the updated shape is a text shape and the partial touches any of the
    // properties that affect glyph outlines, re-vectorize.
    const vectKeys = ["text", "fontSizeMM", "fontFile", "fontName", "fontBold", "fontItalic"];
    const touched = Object.keys(partial).some((k) => vectKeys.includes(k));
    if (touched) {
      const s = nextProject.shapes.find((sh) => sh.id === id);
      if (s && s.type === "text") {
        // fire-and-forget; updates will be applied when available
        void vectorizeTextShape(s);
      }
    }
  }

  // Vectorize a text shape in-place: convert glyphs -> polygons and store
  // the resulting polylines in `dxfPaths` on the same ToolShape entry so the
  // Canvas renders the exact vectors while the shape remains type 'text'.
  async function vectorizeTextShape(s: ToolShape) {
    if (!s || s.type !== 'text') return;
    try {
      const content = s.text ?? s.name ?? '';
      const fontFile = (s as any).fontFile as string | undefined;
      const fontUrl = fontFile && (fontFile.startsWith('http://') || fontFile.startsWith('https://')) ? fontFile : (fontFile ? `http://localhost:5000/fonts/${fontFile}` : 'http://localhost:5000/fonts/verdana.ttf');
      const libShape = {
        id: s.id,
        kind: 'text',
        content,
        fontFamily: (s.fontName && typeof s.fontName === 'string') ? s.fontName.split(',')[0].trim() : 'Verdana',
        fontStyle: (s.fontBold ? 'bold' : s.fontItalic ? 'italic' : 'normal') as any,
        heightMm: ((s.fontSizeMM ?? s.heightMM ?? 15) * FONT_SIZE_CORRECTION),
        positionMm: { x: s.x ?? 0, y: s.y ?? 0 },
        rotationDeg: s.rotateDeg ?? 0,
        align: (s.textAlign as any) || 'center',
        valign: (s.textValign as any) || 'baseline',
      };

      const polygons = await convertTextShapeToPolygons(libShape as any, fontUrl, 0.1);
      if (!polygons || !polygons.length) return;

      // compute bbox and centroid/centroid-based placement
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of polygons) {
        for (const pt of p.outer) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }
        for (const h of p.holes) for (const pt of h) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }
      }
      const cx = isFinite(minX) ? (minX + maxX) / 2 : (s.x ?? 0);
      const cy = isFinite(minY) ? (minY + maxY) / 2 : (s.y ?? 0);

      // Store dxfPaths relative to the current shape position so we do not
      // change the shape's on-canvas location when re-vectorizing.
      const baseX = s.x ?? 0;
      const baseY = s.y ?? 0;
      const dxfPaths: Array<Array<{ x: number; y: number }>> = [];
      for (const p of polygons) {
        if (p.outer && p.outer.length) dxfPaths.push(p.outer.map((pt) => ({ x: Math.round((pt.x - baseX) * 10) / 10, y: Math.round((pt.y - baseY) * 10) / 10 })));
        if (p.holes && p.holes.length) for (const h of p.holes) if (h && h.length) dxfPaths.push(h.map((pt) => ({ x: Math.round((pt.x - baseX) * 10) / 10, y: Math.round((pt.y - baseY) * 10) / 10 })));
      }

      const widthMM = isFinite(minX) ? Math.round((maxX - minX) * 10) / 10 : (s.widthMM ?? 0);
      const heightMM = isFinite(minY) ? Math.round((maxY - minY) * 10) / 10 : (s.heightMM ?? 0);

      setProject((prev) => ({
        ...prev,
        shapes: prev.shapes.map((sh) => sh.id === s.id ? ({ ...sh, dxfPaths, widthMM, heightMM }) : sh),
      }));
    } catch (err) {
      console.warn('vectorizeTextShape failed for', s.id, err);
    }
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

  async function addTextShape() {
    const next = shapeCounter + 1;
    const id = `shape-${next}`;
    setShapeCounter(next);

    // Default parameters for new text
    const defaultText = "Text";
    const defaultFontFile = 'ARLRDBD.TTF';
    const defaultFontUrl = `http://localhost:5000/fonts/${defaultFontFile}`;
    const defaultFontSize = 15; // mm

    // Build a lightweight TextShape for conversion
    const libShape = {
      id,
      kind: 'text',
      content: defaultText,
      fontFamily: 'ARLRDBD',
      fontStyle: 'normal' as const,
      heightMm: defaultFontSize * FONT_SIZE_CORRECTION,
      positionMm: { x: 0, y: boardHeightMM },
      rotationDeg: 0,
      align: 'left' as const,
      valign: 'top' as const,
    };

    // Try to vectorize immediately using the repository font(s). If conversion
    // succeeds we store the generated polylines as a `dxf` shape so the canvas
    // displays the exact vector geometry and exports are deterministic.
    try {
      const polygons = await convertTextShapeToPolygons(libShape as any, defaultFontUrl, 0.1);
      if (polygons && polygons.length) {
        // Compute bounding centroid to store dxfPaths relative to a center point
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polygons) {
          for (const pt of p.outer) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }
          for (const h of p.holes) {
            for (const pt of h) {
              minX = Math.min(minX, pt.x);
              minY = Math.min(minY, pt.y);
              maxX = Math.max(maxX, pt.x);
              maxY = Math.max(maxY, pt.y);
            }
          }
        }
        const cx = isFinite(minX) ? (minX + maxX) / 2 : 0;
        const cy = isFinite(minY) ? (minY + maxY) / 2 : 0;

        // Build dxfPaths relative to centroid (matching how imported DXFs are stored)
        const dxfPaths: Array<Array<{ x: number; y: number }>> = [];
        for (const p of polygons) {
          if (p.outer && p.outer.length) dxfPaths.push(p.outer.map((pt) => ({ x: pt.x - cx, y: pt.y - cy })));
          if (p.holes && p.holes.length) {
            for (const h of p.holes) {
              if (h && h.length) dxfPaths.push(h.map((pt) => ({ x: pt.x - cx, y: pt.y - cy })));
            }
          }
        }

        const widthMM = isFinite(minX) ? (maxX - minX) : 0;
        const heightMM = isFinite(minY) ? (maxY - minY) : 0;

        // Create a TEXT-typed shape that contains the computed vector geometry
        // in `dxfPaths`. This keeps the object editable in the Inspector while
        // displaying deterministic vectors on the Canvas.
        const newShape: ToolShape = {
          id,
          type: 'text',
          name: `Text-${next}`,
          x: Math.round(cx * 10) / 10,
          y: Math.round(cy * 10) / 10,
          scale: 1,
          // vector geometry for deterministic rendering/export
          dxfPaths: dxfPaths,
          // preserve measured extents so selection/handles work correctly
          widthMM: Math.round(widthMM * 10) / 10,
          heightMM: Math.round(heightMM * 10) / 10,
          // text-specific editable properties
          text: defaultText,
          textAlign: 'left',
          textValign: 'top',
          fontName: `GSM-ARLRDBD`,
          fontFile: defaultFontFile,
          fontSizeMM: defaultFontSize,
          depthMM: 0.6,
          cutType: 'Raised',
          fontBold: false,
          fontItalic: false,
          fontUnderline: false,
        };

        setProject((prev) => ({ ...prev, shapes: [...prev.shapes, newShape] }));
        selectItem(id);
        return;
      }
    } catch (err) {
      console.warn('Vectorizing text at creation failed, falling back to text shape', err);
    }

    // Fallback: add a regular text shape (if vectorization failed)
    const fallback: ToolShape = {
      id,
      type: "text",
      name: `Text-${next}`,
      x: 0,
      y: boardHeightMM,
      textAlign: 'left',
      textValign: 'top',
      text: defaultText,
      fontName: `GSM-ARLRDBD`,
      fontFile: defaultFontFile,
      fontSizeMM: defaultFontSize,
      depthMM: 0.6,
      cutType: "Raised",
      fontBold: false,
      fontItalic: false,
      fontUnderline: false,
    };
    setProject((prev) => ({ ...prev, shapes: [...prev.shapes, fallback] }));
    selectItem(id);
  }

  function deleteShape(idOrIds: string | string[]) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    setProject((prev) => ({
      ...prev,
      shapes: prev.shapes.filter((s) => !ids.includes(s.id)),
    }));
    setSelectedItems([]);
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
    const input = e.currentTarget;
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
    // clear input so same file can be re-selected later
    try { input.value = ""; } catch (err) { /* ignore */ }
  }

  // helper functions moved into Canvas component

  // === DXF import ===
  async function handleDxfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
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
    try { input.value = ""; } catch (err) { /* ignore */ }
  }

  // Export DXFs using the server endpoint. Extracted so Inspector can call it.
  async function exportDxfs(silent = false) {
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
          if (s.dxfPaths && s.dxfPaths.length) {
            const scale = s.scale ?? 1;
            const rotDeg = s.rotateDeg || 0;
            const polylines = s.dxfPaths.map((path: any) =>
              path.map((p: any) => {
                const sx = (p.x || 0) * scale;
                const sy = (p.y || 0) * scale;
                const rpt = rotatePoint(sx, sy, -rotDeg);
                return { x: (s.x || 0) + rpt.x, y: (s.y || 0) + rpt.y };
              })
            );
            items.push({
              name: s.name || s.id,
              type: s.type,
              cutType: s.cutType,
              x: s.x || 0,
              y: s.y || 0,
              rotateDeg: s.rotateDeg || 0,
              scale: s.scale || 1,
              depthMM: s.depthMM || 0,
              widthMM: s.widthMM || 0,
              heightMM: s.heightMM || 0,
              dxfPaths: polylines,
              posXYRot: [0, 0, 0],
            });
            continue;
          }
          if (s.dxfName) {
            items.push({
              name: s.name || s.id,
              type: s.type,
              cutType: s.cutType,
              x: s.x || 0,
              y: s.y || 0,
              rotateDeg: s.rotateDeg || 0,
              scale: s.scale || 1,
              depthMM: s.depthMM || 0,
              dxfPaths: [s.dxfName],
              posXYRot: [s.x || 0, s.y || 0, s.rotateDeg || 0],
            });
            continue;
          }
          continue;
        }

        // primitives and text -> polylines
        let cx = s.x || 0;
        let cy = s.y || 0;
        const rot = s.rotateDeg || 0;
        const polylines: Array<Array<{ x: number; y: number }>> = [];
        if (s.type === 'rect') {
          const w = s.widthMM || 0;
          const h = s.heightMM || 0;
          const halfW = w / 2;
          const halfH = h / 2;
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
            const rpt = rotatePoint(px, py, -rot);
            pts.push({ x: rpt.x + cx, y: rpt.y + cy });
          }
          polylines.push(pts);
        } else if (s.type === 'text') {
          // If this text shape already contains vectorized geometry (`dxfPaths`),
          // reuse it directly for export so exported DXFs match the on-canvas
          // placement exactly. This avoids re-running font layout which can
          // produce slightly different anchor offsets when different font
          // candidates are used server-side or during conversion.
          if (s.dxfPaths && s.dxfPaths.length) {
            const scale = s.scale ?? 1;
            const rotDeg = s.rotateDeg || 0;
            const polylines = s.dxfPaths.map((path: any) =>
              path.map((p: any) => {
                const sx = (p.x || 0) * scale;
                const sy = (p.y || 0) * scale;
                const rpt = rotatePoint(sx, sy, -rotDeg);
                return { x: (s.x || 0) + rpt.x, y: (s.y || 0) + rpt.y };
              })
            );
            items.push({
              name: s.name || s.id,
              type: 'text',
              cutType: s.cutType,
              x: s.x || 0,
              y: s.y || 0,
              rotateDeg: s.rotateDeg || 0,
              scale: s.scale || 1,
              depthMM: s.depthMM || 0,
              widthMM: s.widthMM || 0,
              heightMM: s.heightMM || 0,
              dxfPaths: polylines,
              _fontUrl: null,
              posXYRot: [0, 0, 0],
            });
            continue;
          }
          try {
            // Map our internal ToolShape to the library TextShape shape
            const libShape = {
              id: s.id,
              kind: 'text',
              content: s.text || s.name || '',
              // fontFamily may be a CSS-like family string or a direct filename (e.g. 'verdana.ttf')
              fontFamily: (s.fontName && typeof s.fontName === 'string') ? s.fontName.split(',')[0].trim() : 'Verdana',
              fontStyle: (s.fontBold ? 'bold' : s.fontItalic ? 'italic' : 'normal') as any,
              // apply the same visual correction used by the canvas so DXF matches on-screen size
              heightMm: ((s.fontSizeMM || s.heightMM || 15) * FONT_SIZE_CORRECTION),
              positionMm: { x: cx, y: cy },
              rotationDeg: rot,
              align: (s.textAlign as any) || 'center',
              valign: (s.textValign as any) || 'baseline',
            };

            // Attempt to load fonts by guessing likely TTF filenames derived from the
            // UI font family (try bold/italic variants), falling back to Verdana.
            const family = (libShape.fontFamily || 'verdana').replace(/['\"]/g, '').trim();
            const candidates: string[] = [];
            const base = family.split(',')[0].trim();
            // If the inspector set an explicit font file on the shape, prefer it
            const fontFile = (s as any).fontFile as string | undefined;
            const addCandidate = (fn: string) => candidates.push(`http://localhost:5000/fonts/${fn}`);
            if (fontFile) {
              const baseName = fontFile.replace(/\.[^.]+$/, '');
              // Prefer variants that match bold/italic flags
              const ordered: string[] = [];
              const wantBold = !!s.fontBold;
              const wantItalic = !!s.fontItalic;
              if (wantBold && wantItalic) {
                ordered.push(`${baseName}ib.ttf`, `${baseName}bi.ttf`, `${baseName}ib.ttf`);
              }
              if (wantBold) ordered.push(`${baseName}b.ttf`, `${baseName}-bold.ttf`, `${baseName}Bold.ttf`);
              if (wantItalic) ordered.push(`${baseName}i.ttf`, `${baseName}-italic.ttf`, `${baseName}Italic.ttf`);
              // always try the base font file next
              ordered.push(fontFile);
              // finally add some other common guesses
              ordered.push(`${baseName}z.ttf`, `${baseName}ab.ttf`, `${baseName}ib.ttf`);
              for (const fn of ordered) addCandidate(fn);
            } else {
              // quick mapping for commonly-present TTF filenames in the repo `fonts/` folder
              const fontFileMap: Record<string, string> = {
                arial: 'ARLRDBD.TTF',
                verdana: 'verdana.ttf',
                nunito: 'nunito.ttf',
              };
              const baseKey = base.toLowerCase();
              if (fontFileMap[baseKey]) addCandidate(fontFileMap[baseKey]);
              // If the selected font looks like a filename (ends with .ttf/.otf) or is already a URL, try it directly
              if (base.toLowerCase().endsWith('.ttf') || base.toLowerCase().endsWith('.otf')) {
                candidates.unshift(base);
              } else if (base.startsWith('http://') || base.startsWith('https://')) {
                candidates.unshift(base);
              }
              const nameVariants = [base, base.replace(/\s+/g, ''), base.toLowerCase(), base.replace(/\s+/g, '-').toLowerCase()];
              const styleSuffixes = ['', '-bold', '-italic', 'b', 'i', 'Bold', 'Italic'];
              for (const v of nameVariants) {
                for (const suf of styleSuffixes) addCandidate(`${v}${suf}.ttf`);
              }
              addCandidate('verdana.ttf');
            }

            let polygons: any[] | null = null;
            let usedFontUrl: string | null = null;
            for (const url of candidates) {
              try {
                polygons = await convertTextShapeToPolygons(libShape, url, 0.1);
                if (polygons && polygons.length) {
                  // success
                  usedFontUrl = url;
                  console.info('Text conversion: used font', url);
                  break;
                }
              } catch (e) {
                // try next candidate
                console.warn('Font load/convert failed for', url, e);
                polygons = null;
              }
            }
            if (!usedFontUrl) console.warn('Text conversion: no font candidate succeeded for', libShape.fontFamily);
            // flatten into an array of polylines (outer then holes)
            const dxfPolylines: Array<Array<{ x: number; y: number }>> = [];
            if (polygons) {
              for (const p of polygons) {
                if (p.outer && p.outer.length) dxfPolylines.push(p.outer.map((pt) => ({ x: pt.x, y: pt.y })));
                if (p.holes && p.holes.length) {
                  for (const h of p.holes) {
                    if (h && h.length) dxfPolylines.push(h.map((pt) => ({ x: pt.x, y: pt.y })));
                  }
                }
              }
            }

            if (dxfPolylines.length) {
              items.push({
                name: s.name || s.id,
                type: 'text',
                cutType: s.cutType,
                x: s.x || 0,
                y: s.y || 0,
                rotateDeg: s.rotateDeg || 0,
                scale: s.scale || 1,
                depthMM: s.depthMM || 0,
                widthMM: s.widthMM || 0,
                heightMM: s.heightMM || 0,
                dxfPaths: dxfPolylines,
                // debugging: which font URL was used (may be null if fallback occurred)
                _fontUrl: usedFontUrl,
                posXYRot: [0, 0, 0],
              });
            } else {
              // fallback: still emit a text descriptor so server-side converter can attempt conversion
              items.push({ name: s.name || s.id, type: 'text', text: s.text || s.name || '', fontSize: s.fontSizeMM || 15, posXYRot: [cx, cy, rot] });
            }
          } catch (err) {
            console.error('text conversion failed for', s.id, err);
            // fall back to original behavior so server-side pipeline can handle it
            items.push({ name: s.name || s.id, type: 'text', text: s.text || s.name || '', fontSize: s.fontSizeMM || 15, posXYRot: [cx, cy, rot] });
          }
          continue;
        }

        if (polylines.length) {
          items.push({
            name: s.name || s.id,
            type: s.type || 'poly',
            cutType: s.cutType || null,
            x: s.x || 0,
            y: s.y || 0,
            rotateDeg: s.rotateDeg || 0,
            scale: s.scale || 1,
            depthMM: s.depthMM || 0,
            widthMM: s.widthMM || 0,
            heightMM: s.heightMM || 0,
            polylines,
            posXYRot: [0, 0, 0],
          });
        }
      }

      // Include full project (with `board`) so server preserves UI values
      const payload = { projectName: project.name, project: project, items };
      const r = await fetch('http://localhost:5000/export-dxfs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) {
        alert('Export DXFs failed: ' + (j && j.error ? j.error : r.statusText));
        return false;
      }
      if (j && j.ok) {
        if (!silent) alert('DXF files written to project processing_output/');
      } else {
        if (!silent) alert('Export DXFs completed with unknown result; check server logs.');
      }
      return true;
    } catch (e) {
      console.error('output dxfs failed', e);
      alert('Output DXFs failed: ' + (e && (e as Error).message ? (e as Error).message : String(e)));
      return false;
    }
  }

  async function generateScad() {
    try {
      // Ensure DXFs are exported first and completed (server writes GSM files used by SCAD generation)
      const exported = await exportDxfs(true);
      if (exported === false) {
        // export failed or user was alerted; abort SCAD generation
        return;
      }
      const res = await fetch('http://localhost:5000/export-scad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName: project.name }) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        alert('Generate SCAD request failed: ' + (txt || res.statusText));
        return;
      }
      const j = await res.json().catch(() => null);
      alert('Generate SCAD requested' + (j && j.message ? (': ' + j.message) : ''));
    } catch (e) {
      console.warn('Generate SCAD request failed', e);
      alert('Generate SCAD: could not contact backend (no /export-scad endpoint).');
    }
  }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
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
        try { input.value = ""; } catch (err) { /* ignore */ }
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
  // `append` toggles membership for multi-select (ctrl/meta click)
  function selectItem(id: "board" | string, append = false) {
    if (id === "board") {
      setSelectedItem("board");
      setSelectedItems([]);
      setEditFields({});
      return;
    }
    const s = project.shapes.find((sh) => sh.id === id) || null;
    setSelectedItem(id);
    if (append) {
      setSelectedItems((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        return [...prev, id];
      });
    } else {
      setSelectedItems([id]);
    }
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
              selectedItems={selectedItems}
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
            <RenderCanvas projectName={project.name} />
          )}
        </main>
        {/* Export controls removed — Output DXF's is now available in the Inspector panel */}

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
          exportDxfs={exportDxfs}
          generateScad={generateScad}
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
