import React, { useState, useRef } from "react";
import "./App.css";
import type { BoardConfig, CutType, ToolShape, Project } from "./types";
import Header from "./components/Header";
import LeftPanel from "./components/LeftPanel";
import Canvas from "./components/Canvas";
import Inspector from "./components/Inspector";
import TraceCapture from "./components/TraceCapture";
import RenderCanvas from "./components/RenderCanvas";
import { parseDxf } from "./utils/dxf";
import { showToast } from './utils/toast';
import { convertTextShapeToPolygons, type TextShape, type Point } from "./lib/textToPolylines";
// Set to `true` to enable verbose history logging for debugging
const LOG_HISTORY = false;
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
      chamferEnabled: true,
      chamferHeight: 2,
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

  // Active tab (trace / canvas / render)
  const [activeTab, setActiveTab] = useState<"trace" | "canvas" | "render">("canvas");

  // Undo/redo stacks for canvas actions
  const UNDO_LIMIT = 100;
  const [undoStack, setUndoStack] = useState<Project[]>([]);
  const [redoStack, setRedoStack] = useState<Project[]>([]);
  const undoStackRef = useRef<Project[]>([]);
  const redoStackRef = useRef<Project[]>([]);
  const historyOpInFlightRef = useRef(false);
  const lastHistoryHashRef = useRef<string | null>(null);
  const lastUndoTsRef = useRef(0);
  const lastRedoTsRef = useRef(0);
  const isApplyingHistoryRef = useRef(false);
  const activeTabRef = useRef<"trace" | "canvas" | "render">("canvas");

  React.useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  React.useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);
  React.useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);

  const { board, shapes } = project;

  // Refs and state for measuring and adjusting SVG text size so mm->px mapping is accurate
  // removed measurement refs — using direct mm->px scale for font sizing

  // Keep a ref to the latest project so async callbacks (vectorize) can read
  // the most-recent shape values (x,y,rotateDeg,origin) instead of using
  // potentially-stale closures captured at render time.
  const projectRef = useRef(project);
  React.useEffect(() => { projectRef.current = project; }, [project]);

  // Utility: deep-clone the current project for undo/redo snapshots
  const snapshotProject = React.useCallback((): Project => {
    return JSON.parse(JSON.stringify(projectRef.current)) as Project;
  }, []);

  // Push the current project onto the undo stack (canvas tab only)
  const pushHistoryCheckpoint = React.useCallback((label?: string) => {
    if (isApplyingHistoryRef.current) return;
    if (activeTabRef.current !== "canvas") return;
    const snap = snapshotProject();
    try {
      const hash = JSON.stringify(snap);
      if (hash === lastHistoryHashRef.current) {
        return;
      }
      lastHistoryHashRef.current = hash;
    } catch {
      // if hashing fails, continue to push
    }
    setUndoStack((prev) => {
      const next = [...prev, snap];
      const trimmed = next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
      if (LOG_HISTORY) console.info('history:push', { label: label ?? 'checkpoint', undoSizeBefore: prev.length, undoSizeAfter: trimmed.length, redoSizeBefore: redoStackRef.current.length, activeTab: activeTabRef.current });
      return trimmed;
    });
    setRedoStack((prev) => {
      if (prev.length && LOG_HISTORY) console.info('history:clearRedo', { label: label ?? 'checkpoint', cleared: prev.length });
      return [];
    });
  }, [snapshotProject]);

  const undo = React.useCallback(() => {
    if (activeTabRef.current !== "canvas") return;
    const now = Date.now();
    if (now - lastUndoTsRef.current < 50) {
      console.info('history:undo:skip-throttle');
      return;
    }
    lastUndoTsRef.current = now;
    if (historyOpInFlightRef.current) {
      console.info('history:undo:skip-inflight');
      return;
    }
    if (!undoStackRef.current.length) return;
    historyOpInFlightRef.current = true;

    const prevProject = undoStackRef.current[undoStackRef.current.length - 1];
    const currSnapshot = snapshotProject();
    // mutate refs first
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    const nextRedo = [...redoStackRef.current, currSnapshot];
    redoStackRef.current = nextRedo.length > UNDO_LIMIT ? nextRedo.slice(nextRedo.length - UNDO_LIMIT) : nextRedo;

    // apply state once
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    isApplyingHistoryRef.current = true;
    setProject(prevProject);
    try { lastHistoryHashRef.current = JSON.stringify(prevProject); } catch {}
    setSelectedItem("board");
    setSelectedItems([]);
    setEditFields({});
    setDraggingId(null);
    setDragOffset(null);
    setTimeout(() => { isApplyingHistoryRef.current = false; }, 0);
    if (LOG_HISTORY) console.info('history:undo', {
      undoSizeBefore: undoStackRef.current.length + 1,
      undoSizeAfter: undoStackRef.current.length,
      redoSizeAfter: redoStackRef.current.length,
    });
    historyOpInFlightRef.current = false;
  }, [snapshotProject]);

  const redo = React.useCallback(() => {
    if (activeTabRef.current !== "canvas") return;
    const now = Date.now();
    if (now - lastRedoTsRef.current < 50) {
      console.info('history:redo:skip-throttle');
      return;
    }
    lastRedoTsRef.current = now;
    if (historyOpInFlightRef.current) {
      console.info('history:redo:skip-inflight');
      return;
    }
    if (!redoStackRef.current.length) return;
    historyOpInFlightRef.current = true;

    const nextProject = redoStackRef.current[redoStackRef.current.length - 1];
    const currSnapshot = snapshotProject();
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    const nextUndo = [...undoStackRef.current, currSnapshot];
    undoStackRef.current = nextUndo.length > UNDO_LIMIT ? nextUndo.slice(nextUndo.length - UNDO_LIMIT) : nextUndo;

    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    isApplyingHistoryRef.current = true;
    setProject(nextProject);
    try { lastHistoryHashRef.current = JSON.stringify(nextProject); } catch {}
    setSelectedItem("board");
    setSelectedItems([]);
    setEditFields({});
    setDraggingId(null);
    setDragOffset(null);
    setTimeout(() => { isApplyingHistoryRef.current = false; }, 0);
    if (LOG_HISTORY) console.info('history:redo', {
      redoSizeBefore: redoStackRef.current.length + 1,
      redoSizeAfter: redoStackRef.current.length,
      undoSizeAfter: undoStackRef.current.length,
    });
    historyOpInFlightRef.current = false;
  }, [snapshotProject]);

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

  function updateShape(id: string, partial: Partial<ToolShape>, opts?: { skipHistory?: boolean }) {
    // Only record history when a meaningful change occurs
    const current = projectRef.current.shapes.find((s) => s.id === id);
    if (!current) return;
    let hasDiff = false;
    for (const [k, v] of Object.entries(partial)) {
      const curVal = (current as any)[k];
      const nextVal = v as any;
      const isObject = typeof nextVal === 'object';
      const equal = isObject ? JSON.stringify(curVal) === JSON.stringify(nextVal) : curVal === nextVal;
      if (!equal) { hasDiff = true; break; }
    }
    if (!hasDiff) {
      return;
    }

    if (!opts?.skipHistory) pushHistoryCheckpoint('updateShape');

    // Apply the partial update and, if the update touches text/font properties,
    // attempt to re-vectorize the text into `dxfPaths` so the canvas contains
    // exact vector geometry immediately.
    setProject((prev) => {
      const next = {
        ...prev,
        shapes: prev.shapes.map((s) => (s.id === id ? { ...s, ...partial } : s)),
      } as typeof project;
      return next;
    });

    // If the updated shape is a text shape and the partial touches any of the
    // properties that affect glyph outlines, re-vectorize.
    const vectKeys = ["text", "fontSizeMM", "fontFile", "fontName", "fontBold", "fontItalic"];
    const touched = Object.keys(partial).some((k) => vectKeys.includes(k));
    if (touched) {
      // After updating state, run vectorization against the most-recent
      // snapshot of the shape (read via projectRef) so we don't use stale
      // closure values that could reset position or rotation.
      const s0 = project.shapes.find((sh) => sh.id === id);
      const merged = s0 ? ({ ...s0, ...partial } as ToolShape) : null;
      if (merged && merged.type === 'text') {
        console.info('updateShape: scheduling vectorizeTextShape for', { id: merged.id });
        setTimeout(() => void vectorizeTextShapeById(merged.id), 0);
      }
    }
  }

  // Vectorize a text shape in-place: convert glyphs -> polygons and store
  // the resulting polylines in `dxfPaths` on the same ToolShape entry so the
  // Canvas renders the exact vectors while the shape remains type 'text'.
  // This variant reads the current shape from `projectRef` to ensure we use
  // the up-to-date `rotateDeg`, `x`, and `y` values when redrawing.
  async function vectorizeTextShapeById(id: string) {
    const sCurr = projectRef.current.shapes.find((sh) => sh.id === id) as ToolShape | undefined;
    if (!sCurr || sCurr.type !== 'text') return;
    const s = sCurr;
    try {
      const fontFileVal = (s as unknown as { fontFile?: string }).fontFile;
      console.info('vectorizeTextShape: start', { id: s.id, x: s.x, y: s.y, origin: s.origin, hasDxf: !!(s.dxfPaths && s.dxfPaths.length), text: s.text, fontSizeMM: s.fontSizeMM, fontFile: fontFileVal });
      const content = s.text ?? s.name ?? '';
      const fontFile = fontFileVal as string | undefined;
      const fontUrl = fontFile && (fontFile.startsWith('http://') || fontFile.startsWith('https://')) ? fontFile : (fontFile ? `http://localhost:5000/fonts/${fontFile}` : 'http://localhost:5000/fonts/verdana.ttf');
      const fontStyle = (s.fontBold ? 'bold' : s.fontItalic ? 'italic' : 'normal') as 'normal' | 'bold' | 'italic';
      const alignVal = (s.textAlign as 'left' | 'center' | 'right') || 'center';
      const valignVal = (s.textValign as 'top' | 'middle' | 'bottom' | 'baseline') || 'baseline';

      const libShape: TextShape = {
        id: s.id,
        kind: 'text',
        content,
        fontFamily: (s.fontName && typeof s.fontName === 'string') ? s.fontName.split(',')[0].trim() : 'Verdana',
        fontStyle,
        heightMm: ((s.fontSizeMM ?? s.heightMM ?? 15) * FONT_SIZE_CORRECTION),
        positionMm: { x: s.x ?? 0, y: s.y ?? 0 },
        // Request unrotated polygons from the converter so we can apply
        // the shape's rotation consistently at render time. Some font
        // conversion backends apply rotation sign conventions differently
        // which causes visual mismatches; generating unrotated geometry and
        // rotating it in the Canvas keeps behavior deterministic.
        rotationDeg: 0,
        align: alignVal,
        valign: valignVal,
      };

      const polygons = await convertTextShapeToPolygons(libShape, fontUrl, 0.1);
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
      console.info('vectorizeTextShape: polygon bbox/centroid', { id: s.id, minX, minY, maxX, maxY, cx, cy });

      // Normalize dxfPaths relative to the polygon centroid. Using a
      // consistent centroid-relative basis avoids flips between anchor vs
      // centroid interpretations and keeps visual placement stable when the
      // Canvas interprets `x,y` as the displayed center.
      const isFirstVectorize = !(s.dxfPaths && s.dxfPaths.length);
      // Keep origin stable: prefer the existing stored origin if present,
      // otherwise default to 'anchor' to avoid flipping between anchor/centroid
      // interpretations when vectorizing multiple times.
      const effectiveOrigin: 'centroid' | 'anchor' = (s.origin as 'centroid' | 'anchor') ?? 'anchor';
      // Warn if a shape claims centroid origin but its stored x,y do not
      // match the computed centroid — keep effectiveOrigin for fallback
      if (effectiveOrigin === 'centroid') {
        const sx = s.x ?? 0;
        const sy = s.y ?? 0;
        const dx = Math.abs(sx - cx);
        const dy = Math.abs(sy - cy);
        if (dx > 0.5 || dy > 0.5) {
          console.warn('vectorizeTextShape: origin centroid mismatch detected; preserving existing origin and normalizing dxfPaths to centroid', { id: s.id, sx, sy, cx, cy, dx, dy });
        }
      }

      // Use the polygon centroid as the canonical base for stored dxfPaths.
      // This keeps stored coordinates consistent (centroid-relative) and
      // matches the behavior used when importing DXFs or creating text.
      const baseX = cx;
      const baseY = cy;

      const dxfPaths: Array<Array<{ x: number; y: number }>> = [];
      for (const p of polygons) {
        if (p.outer && p.outer.length) dxfPaths.push(p.outer.map((pt: Point) => ({ x: Math.round((pt.x - baseX) * 10) / 10, y: Math.round((pt.y - baseY) * 10) / 10 })));
        if (p.holes && p.holes.length) for (const h of p.holes) if (h && h.length) dxfPaths.push(h.map((pt: Point) => ({ x: Math.round((pt.x - baseX) * 10) / 10, y: Math.round((pt.y - baseY) * 10) / 10 })));
      }

      const widthMM = isFinite(minX) ? Math.round((maxX - minX) * 10) / 10 : (s.widthMM ?? 0);
      const heightMM = isFinite(minY) ? Math.round((maxY - minY) * 10) / 10 : (s.heightMM ?? 0);

      console.info('vectorizeTextShape: applying dxfPaths (keeping existing x/y to preserve anchor)', { id: s.id, isFirstVectorize, baseX, baseY, widthMM, heightMM, dxfCount: dxfPaths.length, originBefore: s.origin });
      // Update dxfPaths/size but do NOT change `origin` here – preserving
      // the existing interpretation (anchor vs centroid) prevents the
      // on-canvas origin from flipping when vectorization runs later.
      setProject((prev) => {
        // prevShape removed (unused) to keep linter happy
        // If we detected an origin mismatch above, persist the 'anchor' origin
        // so future updates remain consistent and do not flip interpretation.
        // Persist the effectiveOrigin we calculated above so future updates
        // interpret `x,y` consistently and do not cause a visual jump.
        // Preserve existing x/y/rotateDeg from the stored shape in `prev` to
        // ensure visual placement and rotation are not reset when the UI
        // triggers a re-vectorization.
        const updatedShapes = prev.shapes.map((sh) => sh.id === s.id ? ({ ...sh, dxfPaths, widthMM, heightMM, origin: sh.origin ?? effectiveOrigin, x: sh.x, y: sh.y, rotateDeg: sh.rotateDeg }) : sh);
        // concise log: report update without dumping entire objects
        const afterOrigin = (updatedShapes.find(sh => sh.id === s.id) as ToolShape | undefined)?.origin;
        console.info('vectorizeTextShape: updated shape', { id: s.id, isFirstVectorize, baseX, baseY, widthMM, heightMM, dxfCount: dxfPaths.length, originBefore: s.origin, originAfter: afterOrigin });
        return { ...prev, shapes: updatedShapes };
      });
      console.info('vectorizeTextShape: applied update for', { id: s.id });
    } catch (err) {
      console.warn('vectorizeTextShape failed for', s.id, err);
    }
  }

  function updateBoard(partial: Partial<BoardConfig>) {
    // Skip history if the board would remain identical
    const current = projectRef.current.board;
    let hasDiff = false;
    for (const [k, v] of Object.entries(partial)) {
      const curVal = (current as any)[k];
      const nextVal = v as any;
      const isObject = typeof nextVal === 'object';
      const equal = isObject ? JSON.stringify(curVal) === JSON.stringify(nextVal) : curVal === nextVal;
      if (!equal) { hasDiff = true; break; }
    }
    if (!hasDiff) {
      console.info('updateBoard: no-op diff', { keys: Object.keys(partial) });
      return;
    }

    console.info('updateBoard: apply', { keys: Object.keys(partial) });

    pushHistoryCheckpoint('updateBoard');
    setProject((prev) => {
      const next = { ...prev, board: { ...prev.board, ...partial } } as typeof project;
      return next;
    });
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
    pushHistoryCheckpoint('addDefaultShape');
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
      const libShapeTyped: TextShape = libShape as unknown as TextShape;
      const polygons = await convertTextShapeToPolygons(libShapeTyped, defaultFontUrl, 0.1);
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
          if (p.outer && p.outer.length) dxfPaths.push(p.outer.map((pt: Point) => ({ x: pt.x - cx, y: pt.y - cy })));
          if (p.holes && p.holes.length) {
            for (const h of p.holes) {
              if (h && h.length) dxfPaths.push(h.map((pt: Point) => ({ x: pt.x - cx, y: pt.y - cy })));
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
          origin: 'centroid',
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
      origin: 'anchor',
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
    pushHistoryCheckpoint('deleteShape');
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
  const calibrationInputRef = useRef<HTMLInputElement | null>(null);
  const capturePanelRef = useRef<HTMLDivElement | null>(null);

  const [processedImages, setProcessedImages] = useState<{ original?: string | null; traced?: string | null; offset?: string | null; dxf?: { dxf_path?: string | null; gridx_size?: number; gridy_size?: number } | null; used_input?: string | null } | null>(null);
  const [editorActive, setEditorActive] = useState<boolean>(false);
  const [editorControls, setEditorControls] = useState<any | null>(null);

  // Pending polylines returned from the processing endpoint but not yet
  // transferred into the canvas. Each polyline is an array of points {x,y}
  // expressed in mm in the project coordinate space.
  const [pendingPolylines, setPendingPolylines] = useState<Array<Array<{ x: number; y: number }>> | null>(null);
  // Pending grid sizes returned from processing (optional). When Transfer
  // is pressed we'll apply these to the board's Width/Depth (gridX/gridY).
  const [pendingGrid, setPendingGrid] = useState<{ gridx?: number; gridy?: number } | null>(null);
  // Clipboard for copy/paste (stores shape-like objects without ids)
  const [clipboardShapes, setClipboardShapes] = useState<Array<Partial<ToolShape>> | null>(null);

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
        setUndoStack([]);
        setRedoStack([]);
        // reset selection and edit fields
        selectItem("board");
      } catch (err) {
        console.error("Failed to load GSM file:", err);
        alert("Failed to load project file. The file may be invalid.");
      }
    };
    reader.readAsText(file);
    // clear input so same file can be re-selected later
    try { input.value = ""; } catch { /* ignore */ }
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
      pushHistoryCheckpoint('import-dxf');
      setProject((prev) => ({ ...prev, shapes: [...prev.shapes, ...created] }));
      // select last imported shape
      selectItem(created[created.length - 1].id);
    }

    // allow re-selecting same file later
    try { input.value = ""; } catch { /* ignore */ }
  }

  // Export DXFs using the server endpoint. Extracted so Inspector can call it.
  async function exportDxfs(silent = false) {
    try {
      const items: Array<Record<string, unknown>> = [];
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
            const polylines = s.dxfPaths.map((path: Array<{ x: number; y: number }>) =>
              path.map((p: { x: number; y: number }) => {
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
        const cx = s.x || 0;
        const cy = s.y || 0;
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
            const polylines = s.dxfPaths.map((path: Array<{ x: number; y: number }>) =>
              path.map((p: { x: number; y: number }) => {
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
            const fontStyle = (s.fontBold ? 'bold' : s.fontItalic ? 'italic' : 'normal') as 'normal' | 'bold' | 'italic';
            const alignVal = (s.textAlign as 'left' | 'center' | 'right') || 'center';
            const valignVal = (s.textValign as 'top' | 'middle' | 'bottom' | 'baseline') || 'baseline';
            const libShape: TextShape = {
              id: s.id,
              kind: 'text',
              content: s.text || s.name || '',
              // fontFamily may be a CSS-like family string or a direct filename (e.g. 'verdana.ttf')
              fontFamily: (s.fontName && typeof s.fontName === 'string') ? s.fontName.split(',')[0].trim() : 'Verdana',
              fontStyle,
              // apply the same visual correction used by the canvas so DXF matches on-screen size
              heightMm: ((s.fontSizeMM || s.heightMM || 15) * FONT_SIZE_CORRECTION),
              positionMm: { x: cx, y: cy },
              rotationDeg: rot,
              align: alignVal,
              valign: valignVal,
            };

            // Attempt to load fonts by guessing likely TTF filenames derived from the
            // UI font family (try bold/italic variants), falling back to Verdana.
            const family = (libShape.fontFamily || 'verdana').replace(/['"]/g, '').trim();
            const candidates: string[] = [];
            const base = family.split(',')[0].trim();
            // If the inspector set an explicit font file on the shape, prefer it
            const fontFile = (s as unknown as { fontFile?: string }).fontFile as string | undefined;
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

            let polygons: Array<{ outer: Point[]; holes: Point[][] }> | null = null;
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
                if (p.outer && p.outer.length) dxfPolylines.push(p.outer.map((pt: Point) => ({ x: pt.x, y: pt.y })));
                if (p.holes && p.holes.length) {
                  for (const h of p.holes) {
                    if (h && h.length) dxfPolylines.push(h.map((pt: Point) => ({ x: pt.x, y: pt.y })));
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
      // Immediately show the user that generation was requested (non-blocking toast)
      showToast('Generate SCAD requested');
      // switch to the Render tab so the user sees the 3D preview
      setActiveTab('render');
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
      // Keep older alert for additional info from backend if desired
      if (j && j.message) alert(': ' + j.message);
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
        try {
          const pls = j.dxf && j.dxf.polylines ? j.dxf.polylines : null;
          setPendingPolylines(pls && Array.isArray(pls) ? pls : null);
          // capture optional grid sizes if provided by the processing meta
          const gx = j.dxf && (j.dxf.gridx_size ?? j.dxf.gridx);
          const gy = j.dxf && (j.dxf.gridy_size ?? j.dxf.gridy);
          if (typeof gx === 'number' || typeof gy === 'number') {
            setPendingGrid({ gridx: typeof gx === 'number' ? gx : undefined, gridy: typeof gy === 'number' ? gy : undefined });
          } else {
            setPendingGrid(null);
          }
        } catch (e) {
          setPendingPolylines(null);
          setPendingGrid(null);
        }
      })
      .catch((err) => {
        console.error('upload failed', err);
        alert('Upload failed: ' + err.message);
      })
      .finally(() => {
        try { input.value = ""; } catch { /* ignore */ }
      });
  }

  function captureImage() {
    setActiveTab('trace');
    try {
      capturePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* ignore */
    }
  }

  function transferPendingPolylines() {
    if (!pendingPolylines || !pendingPolylines.length) return;
    // Count shapes that existed on the canvas prior to this transfer
    const priorShapeCount = project.shapes.length;
    let nextCounter = shapeCounter;
    const created: any[] = [];
    for (let i = 0; i < pendingPolylines.length; i++) {
      const poly = pendingPolylines[i];
      if (!poly || !poly.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rel = poly.map((p: any) => ({ x: Math.round((p.x - cx) * 10) / 10, y: Math.round((p.y - cy) * 10) / 10 }));
      nextCounter += 1;
      const id = `shape-${nextCounter}`;
      const newShape = {
        id,
        type: 'dxf',
        name: `Trace-${nextCounter}`,
        x: Math.round(cx * 10) / 10,
        y: Math.round(cy * 10) / 10,
        scale: 1,
        dxfPaths: [rel],
        widthMM: Math.round((maxX - minX) * 10) / 10,
        heightMM: Math.round((maxY - minY) * 10) / 10,
        depthMM: 15,
        cutType: 'Cut',
      } as any;
      created.push(newShape);
    }
    if (created.length) {
      // Center the just-created group of shapes onto the canvas.
      try {
        // Compute axis-aligned bounding box of the new shapes (world mm coords)
        let minXAll = Infinity, minYAll = Infinity, maxXAll = -Infinity, maxYAll = -Infinity;
        for (const s of created) {
          const halfW = (s.widthMM ?? 0) / 2;
          const halfH = (s.heightMM ?? 0) / 2;
          const lx = (s.x ?? 0) - halfW;
          const rx = (s.x ?? 0) + halfW;
          const by = (s.y ?? 0) - halfH;
          const ty = (s.y ?? 0) + halfH;
          if (lx < minXAll) minXAll = lx;
          if (by < minYAll) minYAll = by;
          if (rx > maxXAll) maxXAll = rx;
          if (ty > maxYAll) maxYAll = ty;
        }
        if (isFinite(minXAll)) {
          const groupCenterX = (minXAll + maxXAll) / 2;
          const groupCenterY = (minYAll + maxYAll) / 2;
          // Determine effective board grid after transfer: if processing returned
          // grid sizes, they will be applied to the board. Use those values
          // now so centering uses the post-update canvas dimensions.
          const effGridX = (pendingGrid && typeof pendingGrid.gridx === 'number') ? pendingGrid.gridx : board.gridX;
          const effGridY = (pendingGrid && typeof pendingGrid.gridy === 'number') ? pendingGrid.gridy : board.gridY;
          const cellSize = board.cellSizeMM || 42;
          const worldWidth = effGridX * cellSize;
          const worldHeight = effGridY * cellSize;
          const canvasCenterX = worldWidth / 2;
          const canvasCenterY = worldHeight / 2;
          const dx = Math.round((canvasCenterX - groupCenterX) * 10) / 10;
          const dy = Math.round((canvasCenterY - groupCenterY) * 10) / 10;
          if (dx !== 0 || dy !== 0) {
            for (const s of created) {
              s.x = Math.round(((s.x ?? 0) + dx) * 10) / 10;
              s.y = Math.round(((s.y ?? 0) + dy) * 10) / 10;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to center transferred shapes', e);
      }

      pushHistoryCheckpoint('transfer-trace');
      setProject((prev) => ({ ...prev, shapes: [...prev.shapes, ...created] }));
      setShapeCounter(nextCounter);
    }
    // If processing returned grid sizes, apply them to the board Width/Depth
    if (pendingGrid) {
      const gx = typeof pendingGrid.gridx === 'number' ? pendingGrid.gridx : undefined;
      const gy = typeof pendingGrid.gridy === 'number' ? pendingGrid.gridy : undefined;
      if (typeof gx === 'number' || typeof gy === 'number') {
        // If there were existing shapes on the canvas BEFORE this transfer,
        // avoid shrinking the canvas — take the max per-dimension between
        // the current board size and the requested size. Otherwise accept
        // the requested size directly.
        const newGridX = (gx !== undefined)
          ? (priorShapeCount > 0 ? Math.max(board.gridX, gx) : gx)
          : undefined;
        const newGridY = (gy !== undefined)
          ? (priorShapeCount > 0 ? Math.max(board.gridY, gy) : gy)
          : undefined;
        const toSet: any = {};
        if (newGridX !== undefined) toSet.gridX = newGridX;
        if (newGridY !== undefined) toSet.gridY = newGridY;
        if (Object.keys(toSet).length) updateBoard(toSet);
      }
    }
    setPendingPolylines(null);
    setPendingGrid(null);
    // Switch to the 2D Canvas tab so the user sees the imported shapes
    setActiveTab('canvas');
  }

  // Copy selected shapes into an in-memory clipboard (Ctrl+C)
  function handleCopy() {
    try {
      // prefer multi-selection; fall back to single selectedItem
      const ids = selectedItems && selectedItems.length ? selectedItems : (selectedItem && selectedItem !== 'board' ? [selectedItem] : []);
      if (!ids || !ids.length) return;
      const copies: Array<Partial<ToolShape>> = [];
      for (const id of ids) {
        const s = project.shapes.find((sh) => sh.id === id);
        if (!s) continue;
        const clone = JSON.parse(JSON.stringify(s)) as any;
        delete clone.id;
        copies.push(clone as Partial<ToolShape>);
      }
      if (copies.length) {
        setClipboardShapes(copies);
        try { showToast && showToast(`Copied ${copies.length} shape${copies.length>1?'s':''}`); } catch {}
      }
    } catch (e) {
      console.error('Copy failed', e);
    }
  }

  // Paste shapes from clipboard (Ctrl+V) with a +5mm x/y offset
  function handlePaste() {
    try {
      if (!clipboardShapes || !clipboardShapes.length) return;
      let next = shapeCounter;
      const created: ToolShape[] = [];
      // collect existing names to avoid duplicates when naming pasted shapes
      const existingNames = new Set<string>(project.shapes.map((s) => s.name || ''));
      for (const base of clipboardShapes) {
        next += 1;
        const id = `shape-${next}`;
        const clone: any = JSON.parse(JSON.stringify(base));
        // default position to center if missing
        const baseX = (typeof clone.x === 'number') ? clone.x : (board.gridX * board.cellSizeMM) / 2;
        const baseY = (typeof clone.y === 'number') ? clone.y : (board.gridY * board.cellSizeMM) / 2;
        // Ensure pasted shape has a unique display name
        const originalName = (clone.name && String(clone.name)) || '';
        const baseName = originalName || `Shape-${next}`;
        let newName = baseName;
        if (existingNames.has(newName)) {
          let copyIndex = 1;
          let candidate = '';
          while (true) {
            candidate = `${baseName}-${copyIndex}`;
            if (!existingNames.has(candidate)) break;
            copyIndex += 1;
          }
          newName = candidate;
        }
        existingNames.add(newName);
        clone.name = newName;
        clone.id = id;
        clone.x = Math.round((baseX + 5) * 10) / 10;
        clone.y = Math.round((baseY + 5) * 10) / 10;
        created.push(clone as ToolShape);
      }
      if (created.length) {
        pushHistoryCheckpoint('paste');
        setProject((prev) => ({ ...prev, shapes: [...prev.shapes, ...created] }));
        setShapeCounter(next);
        // select pasted shapes
        const newIds = created.map((s) => s.id);
        setSelectedItems(newIds);
        setSelectedItem(newIds[newIds.length - 1]);
        try { showToast && showToast(`Pasted ${created.length} shape${created.length>1?'s':''}`); } catch {}
        // ensure user sees canvas
        setActiveTab('canvas');
      }
    } catch (e) {
      console.error('Paste failed', e);
    }
  }

  // Keyboard shortcuts: Ctrl+C / Ctrl+V for copy/paste. Ignore when typing in inputs.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
      if (isInput) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 'c') {
          e.preventDefault();
          handleCopy();
        } else if (k === 'v') {
          e.preventDefault();
          handlePaste();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clipboardShapes, project, selectedItem, selectedItems, shapeCounter, board]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y (or Cmd on mac) for undo/redo on Canvas tab
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
      if (isInput) return;
      if (activeTabRef.current !== 'canvas') return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        } else if (k === 'y') {
          e.preventDefault();
          redo();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

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
        onUndo={undo}
        onRedo={redo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
      />
      <input ref={gsmInputRef} type="file" accept=".gsm,application/json" style={{ display: 'none' }} onChange={handleGsmFile} />

      <div className="app-main">
        {/* Left Panel only on Canvas/Render tabs */}
        {activeTab !== "trace" && (
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
        )}

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
              pushHistoryCheckpoint={pushHistoryCheckpoint}
            />
          ) : activeTab === "trace" ? (
              <TraceCapture
                projectName={project.name}
                processedImages={processedImages}
                panelRef={capturePanelRef}
                imageInputRef={imageInputRef}
                onImageFile={handleImageFile}
                calibrationInputRef={calibrationInputRef}
                onEditorActiveChange={setEditorActive}
                onEditorRegister={setEditorControls}
              />
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
          editingActive={editorActive}
          editorControls={editorControls}
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
                try {
                  const pls = j.dxf && j.dxf.polylines ? j.dxf.polylines : null;
                    setPendingPolylines(pls && Array.isArray(pls) ? pls : null);
                    // capture optional grid sizes provided by the processing meta (same behavior as Load Image)
                    const gx = j.dxf && (j.dxf.gridx_size ?? j.dxf.gridx);
                    const gy = j.dxf && (j.dxf.gridy_size ?? j.dxf.gridy);
                    if (typeof gx === 'number' || typeof gy === 'number') {
                      setPendingGrid({ gridx: typeof gx === 'number' ? gx : undefined, gridy: typeof gy === 'number' ? gy : undefined });
                    } else {
                      setPendingGrid(null);
                    }
                } catch (e) {
                    setPendingPolylines(null);
                    setPendingGrid(null);
                }
              })
              .catch((err) => {
                console.error('reprocess failed', err);
                alert('Reprocess failed: ' + err.message);
              });
          }}
          traceParams={traceParams}
          setTraceParams={setTraceParams}
          transferPolylines={transferPendingPolylines}
          hasPendingPolylines={!!(pendingPolylines && pendingPolylines.length)}
        />
      </div>
    </div>
  );
}

export default App;
