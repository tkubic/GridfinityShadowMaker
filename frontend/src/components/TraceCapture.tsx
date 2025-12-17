import React, { useEffect, useRef, useState } from "react";
import TraceCanvas from "./TraceCanvas";

// Minimal typing for OpenCV.js
declare global {
  interface Window {
    cv?: any;
  }
}

const backendUrl = "http://localhost:5000";
let openCvLoading: Promise<void> | null = null;

async function ensureOpenCv() {
  if (window.cv && (window.cv as any).Mat) {
    if (typeof (window.cv as any).onRuntimeInitialized === "function") {
      await Promise.resolve();
    }
    return;
  }
  if (openCvLoading) return openCvLoading;
  openCvLoading = new Promise<void>((resolve, reject) => {
    // Use the Emscripten Module hook pattern: set Module.onRuntimeInitialized
    // before loading the script so OpenCV can call it when ready.
    try {
      (window as any).Module = (window as any).Module || {};
      (window as any).Module.onRuntimeInitialized = () => {
        // ensure cv is available
        if (window.cv && (window.cv as any).Mat) resolve();
        else resolve();
      };
    } catch (err) {
      // ignore
    }
    const script = document.createElement("script");
    // pin to a stable release; fall back to docs latest if network blocked
    script.src = "https://docs.opencv.org/4.7.0/opencv.js";
    script.async = true;
    script.onerror = (err) => {
      openCvLoading = null;
      reject(err);
    };
    document.body.appendChild(script);
  });
  return openCvLoading;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to convert blob"));
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

type PhotoItem = {
  name: string;
  edited: boolean;
  mtimeMs: number;
  size: number;
  url: string;
};

type Calibration = {
  camera_matrix: number[][];
  distortion_coefficients: number[] | number[][];
};

type EditorState = { filename: string; dataUrl: string } | null;
type EditorMode = "brush" | "crop" | "marquee" | "rectangle" | "circle" | "pointer";
type RectShape = {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
  color: "#000000" | "#ffffff";
};
type CircleShape = {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle?: number;
  color: "#000000" | "#ffffff";
};
type StrokeShape = {
  id: string;
  color: "#000000" | "#ffffff";
  size: number;
  points: { x: number; y: number }[];
};

type PhotoEditorProps = {
  state: EditorState;
  // third parameter indicates whether the editor has tracked edits
  onSave: (dataUrl: string, filename: string, editsMade: boolean) => void;
  onCancel: () => void;
  onRegister?: (controls: any | null) => void;
};

function PhotoEditor({ state, onSave, onCancel, onRegister }: PhotoEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [brushSize, setBrushSize] = useState(28);
  const [mode, setMode] = useState<EditorMode>("marquee");
  const [brushPreview, setBrushPreview] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const [painting, setPainting] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // liveRect is the in-progress rectangle while dragging; cropRect is the finalized selection
  const [liveRect, setLiveRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [rectLive, setRectLive] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [circleStart, setCircleStart] = useState<{ x: number; y: number } | null>(null);
  const [circleLive, setCircleLive] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [rectShapes, setRectShapes] = useState<RectShape[]>([]);
  const [circleShapes, setCircleShapes] = useState<CircleShape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<StrokeShape[]>([]);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [drawOrder, setDrawOrder] = useState<{ type: 'rect' | 'circle' | 'stroke'; id: string }[]>([]);
  // aspect ratio is implicitly tracked via canvas width/height and display sizing
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const displayedScaleRef = useRef<number>(1);
  const [canvasStyle, setCanvasStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [color, setColor] = useState<"#000000" | "#ffffff">('#000000');
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null);
  const [editsMade, setEditsMade] = useState(false);
  const resizingRef = useRef<null | { corner: string; startClientX: number; startClientY: number; origRect: any }>(null);
  const shapeDragRef = useRef<null | { id: string; startX: number; startY: number; startCx: number; startCy: number }>(null);
  const shapeResizeRef = useRef<null | { id: string; corner: string; startShape: RectShape }>(null);
  const shapeRotateRef = useRef<null | { id: string; startAngle: number; startPointerAngle: number; startShape: RectShape }>(null);
  const circleDragRef = useRef<null | { id: string; startX: number; startY: number; startCx: number; startCy: number }>(null);
  const circleResizeRef = useRef<null | { id: string; corner: string; startShape: CircleShape }>(null);
  const circleRotateRef = useRef<null | { id: string; startAngle: number; startPointerAngle: number; startShape: CircleShape }>(null);
  const shapeIdRef = useRef<number>(1);
  const lastPointerIdRef = useRef<number | null>(null);
  const strokeDragRef = useRef<null | { id: string; startX: number; startY: number; startPoints: { x: number; y: number }[] }>(null);
  const currentStrokeRef = useRef<StrokeShape | null>(null);
  const lastFinalizedStrokeRef = useRef<StrokeShape | null>(null);
  const baseImageRef = useRef<ImageData | null>(null);
  const modeRef = useRef<EditorMode>('marquee');
  const paintingRef = useRef(false);

  useEffect(() => {
    if (!state) return;
    // default to selection when a new image is opened for editing
    setMode('marquee');
    setBrushPreview(null);
    setEditsMade(false);
    const img = new Image();
    img.src = state.dataUrl;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // set internal pixel buffer to image natural size
      canvas.width = img.width;
      canvas.height = img.height;
      // no-op: display sizing handled by updateDisplaySize
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      try { baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch {}
      // compute display size to fit into wrapper while preserving aspect
      window.requestAnimationFrame(() => {
        updateDisplaySize(img.width, img.height);
      });
    };
  }, [state]);

  useEffect(() => {
    function onResize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      updateDisplaySize(canvas.width, canvas.height);
    }
    window.addEventListener('resize', onResize);
    // ensure pointerup anywhere clears resizing state (handles pointer capture edge-cases)
    function globalPointerMove(ev: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // stroke drag
      if (strokeDragRef.current) {
        const drag = strokeDragRef.current;
        const pt = clientToCanvas(ev);
        const dx = pt.x - drag.startX;
        const dy = pt.y - drag.startY;
        setStrokes((prev) => prev.map((s) => s.id === drag.id ? { ...s, points: drag.startPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : s));
        return;
      }

      // circle drag
      if (circleDragRef.current) {
        const drag = circleDragRef.current;
        const pt = clientToCanvas(ev);
        const dx = pt.x - drag.startX;
        const dy = pt.y - drag.startY;
        setCircleShapes((prev) => prev.map((s) => s.id === drag.id ? { ...s, cx: drag.startCx + dx, cy: drag.startCy + dy } : s));
        setEditsMade(true);
        return;
      }

      // circle resize (rotation-aware)
      if (circleResizeRef.current) {
        const resize = circleResizeRef.current as any;
        const start = resize.startShape as CircleShape;
        const pt = clientToCanvas(ev);
        const angle = start.angle || 0;
        const rotated = rotateAround(pt, { x: start.cx, y: start.cy }, -angle);
        const local = { x: rotated.x - start.cx, y: rotated.y - start.cy }; // local coordinates relative to center
        let left = -start.rx;
        let right = start.rx;
        let top = -start.ry;
        let bottom = start.ry;
        const MIN_SIDE = 4;
        if (resize.corner === 'nw') { left = Math.min(local.x, right - MIN_SIDE); top = Math.min(local.y, bottom - MIN_SIDE); }
        if (resize.corner === 'ne') { right = Math.max(local.x, left + MIN_SIDE); top = Math.min(local.y, bottom - MIN_SIDE); }
        if (resize.corner === 'sw') { left = Math.min(local.x, right - MIN_SIDE); bottom = Math.max(local.y, top + MIN_SIDE); }
        if (resize.corner === 'se') { right = Math.max(local.x, left + MIN_SIDE); bottom = Math.max(local.y, top + MIN_SIDE); }
        const newRx = (right - left) / 2;
        const newRy = (bottom - top) / 2;
        const centerLocalX = (left + right) / 2;
        const centerLocalY = (top + bottom) / 2;
        const centerCanvas = rotateAround({ x: start.cx + centerLocalX, y: start.cy + centerLocalY }, { x: start.cx, y: start.cy }, angle);
        setCircleShapes((prev) => prev.map((s) => s.id === resize.id ? { ...s, rx: Math.max(1, newRx), ry: Math.max(1, newRy), cx: centerCanvas.x, cy: centerCanvas.y } : s));
        setEditsMade(true);
        return;
      }

      // circle rotate
      if (circleRotateRef.current) {
        const rot = circleRotateRef.current;
        const pt = clientToCanvas(ev);
        const angleNow = Math.atan2(pt.y - rot.startShape.cy, pt.x - rot.startShape.cx);
        const delta = angleNow - rot.startPointerAngle;
        const nextAngle = rot.startAngle + delta;
        setCircleShapes((prev) => prev.map((s) => s.id === rot.id ? { ...s, angle: nextAngle } : s));
        setEditsMade(true);
        return;
      }

      // shape drag
      if (shapeDragRef.current) {
        const drag = shapeDragRef.current;
        const pt = clientToCanvas(ev);
        const dx = pt.x - drag.startX;
        const dy = pt.y - drag.startY;
        setRectShapes((prev) => prev.map((s) => s.id === drag.id ? { ...s, cx: drag.startCx + dx, cy: drag.startCy + dy } : s));
        setEditsMade(true);
        return;
      }

      // shape resize
      if (shapeResizeRef.current) {
        const resize = shapeResizeRef.current;
        const shape = resize.startShape;
        const local = canvasToLocal(clientToCanvas(ev), shape);
        let left = -shape.width / 2;
        let right = shape.width / 2;
        let top = -shape.height / 2;
        let bottom = shape.height / 2;
        const MIN_SIDE = 4;
        if (resize.corner === 'nw') { left = Math.min(local.x, right - MIN_SIDE); top = Math.min(local.y, bottom - MIN_SIDE); }
        if (resize.corner === 'ne') { right = Math.max(local.x, left + MIN_SIDE); top = Math.min(local.y, bottom - MIN_SIDE); }
        if (resize.corner === 'sw') { left = Math.min(local.x, right - MIN_SIDE); bottom = Math.max(local.y, top + MIN_SIDE); }
        if (resize.corner === 'se') { right = Math.max(local.x, left + MIN_SIDE); bottom = Math.max(local.y, top + MIN_SIDE); }
        const newW = right - left;
        const newH = bottom - top;
        const centerLocal = { x: (left + right) / 2, y: (top + bottom) / 2 };
        const centerCanvas = rotateAround({ x: shape.cx + centerLocal.x, y: shape.cy + centerLocal.y }, { x: shape.cx, y: shape.cy }, shape.angle);
        setRectShapes((prev) => prev.map((s) => s.id === resize.id ? { ...s, width: newW, height: newH, cx: centerCanvas.x, cy: centerCanvas.y } : s));
        setEditsMade(true);
        return;
      }

      // shape rotate
      if (shapeRotateRef.current) {
        const rot = shapeRotateRef.current;
        const pt = clientToCanvas(ev);
        const angleNow = Math.atan2(pt.y - rot.startShape.cy, pt.x - rot.startShape.cx);
        const delta = angleNow - rot.startPointerAngle;
        const nextAngle = rot.startAngle + delta;
        setRectShapes((prev) => prev.map((s) => s.id === rot.id ? { ...s, angle: nextAngle } : s));
        setEditsMade(true);
        return;
      }

      // if resizing via crop handle, process here
      if (resizingRef.current) {
        const r = resizingRef.current;
        const canvasRect = canvas.getBoundingClientRect();
        const dxClient = ev.clientX - r.startClientX;
        const dyClient = ev.clientY - r.startClientY;
        let newRect = { ...r.origRect };
        const clientToCanvasDX = (dxClient / canvasRect.width) * canvas.width;
        const clientToCanvasDY = (dyClient / canvasRect.height) * canvas.height;
        if (r.corner === 'nw') { newRect.x0 = Math.max(0, Math.min(canvas.width, r.origRect.x0 + clientToCanvasDX)); newRect.y0 = Math.max(0, Math.min(canvas.height, r.origRect.y0 + clientToCanvasDY)); }
        if (r.corner === 'ne') { newRect.x1 = Math.max(0, Math.min(canvas.width, r.origRect.x1 + clientToCanvasDX)); newRect.y0 = Math.max(0, Math.min(canvas.height, r.origRect.y0 + clientToCanvasDY)); }
        if (r.corner === 'sw') { newRect.x0 = Math.max(0, Math.min(canvas.width, r.origRect.x0 + clientToCanvasDX)); newRect.y1 = Math.max(0, Math.min(canvas.height, r.origRect.y1 + clientToCanvasDY)); }
        if (r.corner === 'se') { newRect.x1 = Math.max(0, Math.min(canvas.width, r.origRect.x1 + clientToCanvasDX)); newRect.y1 = Math.max(0, Math.min(canvas.height, r.origRect.y1 + clientToCanvasDY)); }
        setCropRect(newRect);
        setLiveRect(null);
        updateCropOverlay(newRect);
        return;
      }

      // marquee/crop drag
      if (cropStart && (modeRef.current === 'marquee' || modeRef.current === 'crop')) {
        const rect = canvas.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
        const live = { x0: cropStart.x, y0: cropStart.y, x1: x, y1: y };
        setLiveRect(live);
        updateCropOverlay(live);
      }

      // rectangle preview drag
      if (rectStart && modeRef.current === 'rectangle') {
        const rect = canvas.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
        const live = { x0: rectStart.x, y0: rectStart.y, x1: x, y1: y };
        setRectLive(live);
        updateCropOverlay(live);
      }
    }

    function globalPointerUp() {
      if (paintingRef.current && modeRef.current === 'brush') {
        const stroke = currentStrokeRef.current;
        if (stroke && stroke.points.length) {
          redrawCanvas(stroke);
          setStrokes((prev) => [...prev, stroke]);
          setDrawOrder((prev) => [...prev, { type: 'stroke', id: stroke.id }]);
          setEditsMade(true);
          // remember the last finalized stroke so controls.save can export it synchronously
          try { lastFinalizedStrokeRef.current = stroke; } catch {}
        }
        currentStrokeRef.current = null;
        setPainting(false);
      }
      // finalize any shape interactions first
      shapeDragRef.current = null;
      shapeResizeRef.current = null;
      shapeRotateRef.current = null;
      strokeDragRef.current = null;
      circleDragRef.current = null;
      circleResizeRef.current = null;
      circleRotateRef.current = null;

      // finalize any in-progress actions
      if (rectStart && rectLive && modeRef.current === 'rectangle') {
        const x0 = Math.max(0, Math.min(rectLive.x0, rectLive.x1));
        const y0 = Math.max(0, Math.min(rectLive.y0, rectLive.y1));
        const x1 = Math.min((canvasRef.current?.width || 0), Math.max(rectLive.x0, rectLive.x1));
        const y1 = Math.min((canvasRef.current?.height || 0), Math.max(rectLive.y0, rectLive.y1));
        const MIN_RECT = 8;
          if ((x1 - x0) >= MIN_RECT && (y1 - y0) >= MIN_RECT) {
          const w = x1 - x0;
          const h = y1 - y0;
          const id = `rect-${shapeIdRef.current++}`;
            setRectShapes((prev) => [...prev, { id, cx: x0 + w / 2, cy: y0 + h / 2, width: w, height: h, angle: 0, color }]);
            setEditsMade(true);
          setDrawOrder((prev) => [...prev, { type: 'rect', id }]);
          setSelectedShapeId(id);
        }
        setOverlayStyle(null);
      }
      if (cropStart) {
        if (liveRect) {
          const x0 = Math.max(0, Math.min(liveRect.x0, liveRect.x1));
          const y0 = Math.max(0, Math.min(liveRect.y0, liveRect.y1));
          const x1 = Math.min((canvasRef.current?.width || 0), Math.max(liveRect.x0, liveRect.x1));
          const y1 = Math.min((canvasRef.current?.height || 0), Math.max(liveRect.y0, liveRect.y1));
          const rect = { x0, y0, x1, y1 };
          setCropRect(rect);
          updateCropOverlay(rect);
        } else {
          setCropRect(null);
          setOverlayStyle(null);
          }
      }
      resizingRef.current = null;
      setPainting(false);
      setCropStart(null);
      setRectStart(null);
      setLiveRect(null);
      setRectLive(null);
      setBrushPreview(null);
      try { if (canvasRef.current && lastPointerIdRef.current != null) (canvasRef.current as any).releasePointerCapture?.(lastPointerIdRef.current); } catch {}
      lastPointerIdRef.current = null;
    }

    window.addEventListener('pointermove', globalPointerMove);
    window.addEventListener('pointerup', globalPointerUp);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', globalPointerMove);
      window.removeEventListener('pointerup', globalPointerUp);
    };
  }, []);

  // Clear preview when brush size changes so the next move recalculates the indicator
  useEffect(() => {
    setBrushPreview(null);
  }, [brushSize]);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { paintingRef.current = painting; }, [painting]);
  useEffect(() => { redrawCanvas(); }, [strokes, rectShapes, circleShapes, drawOrder, selectedStrokeId, selectedCircleId]);
  useEffect(() => { if (selectedShapeId && !rectShapes.some((s) => s.id === selectedShapeId)) setSelectedShapeId(null); }, [rectShapes, selectedShapeId]);
  useEffect(() => { if (selectedCircleId && !circleShapes.some((s) => s.id === selectedCircleId)) setSelectedCircleId(null); }, [circleShapes, selectedCircleId]);
  useEffect(() => { if (selectedStrokeId && !strokes.some((s) => s.id === selectedStrokeId)) setSelectedStrokeId(null); }, [strokes, selectedStrokeId]);
  useEffect(() => {
    if (mode === 'crop' && cropRect) {
      applyCrop({ x: cropRect.x0, y: cropRect.y0 }, { x: cropRect.x1, y: cropRect.y1 });
      setMode('marquee');
    }
  }, [mode, cropRect]);
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && (selectedShapeId || selectedCircleId || selectedStrokeId)) {
        ev.preventDefault();
        deleteSelection();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedShapeId, selectedCircleId, selectedStrokeId]);

  // register editor controls with parent via `onRegister` prop
  const controls = React.useMemo(() => ({
    setBrushSize: (s: number) => setBrushSize(s),
    setColor: (c: "#000000" | "#ffffff") => { setColor(c); },
    setMode: (m: string) => setMode(m as any),
    getState: () => ({ brushSize, color, mode, cropRect }),
    cropSelection: () => {
      if (cropRect) {
        applyCrop({ x: cropRect.x0, y: cropRect.y0 }, { x: cropRect.x1, y: cropRect.y1 });
        setMode('marquee');
        return true;
      }
      setMode('crop');
      return false;
    },
    deleteSelection: () => deleteSelection(),
    applyCrop: () => {
      if (!cropRect) return;
      applyCrop({ x: cropRect.x0, y: cropRect.y0 }, { x: cropRect.x1, y: cropRect.y1 });
    },
    save: () => {
      // finalize save
      const doSave = (attempt = 0) => {
        const MAX = 20; // ~2s retry window
        if (!state || !canvasRef.current) {
          if (attempt < MAX) {
            setTimeout(() => doSave(attempt + 1), 100);
            return;
          } else {
            console.warn('[PhotoEditor.controls] save giving up; editor not ready');
            return;
          }
        }
        // finalize any in-progress brush stroke so Save captures it
        if (paintingRef.current && currentStrokeRef.current) {
          const stroke = currentStrokeRef.current;
          if (stroke.points.length) {
            // draw the stroke immediately onto the canvas so we can export synchronously
            redrawCanvas(stroke);
            // also enqueue into state so it persists for future edits
            setStrokes((prev) => [...prev, stroke]);
            setDrawOrder((prev) => [...prev, { type: 'stroke', id: stroke.id }]);
            setEditsMade(true);
            // export immediately from the canvas to avoid waiting for React state to flush
            try {
              if (canvasRef.current && state) {
                const url = canvasRef.current.toDataURL('image/png');
                onSave(url, state.filename, true);
                // we've already performed the save/export; stop further save handling
                currentStrokeRef.current = null;
                setPainting(false);
                return;
              }
            } catch (err) {
              // fall through to normal save path on error
              console.warn('[PhotoEditor.controls] immediate stroke export failed', err);
            }
          }
          currentStrokeRef.current = null;
          setPainting(false);
        }
        // finalize any in-progress rectangle so Save captures it immediately
        if (rectStart && rectLive && modeRef.current === 'rectangle') {
          const x0 = Math.max(0, Math.min(rectLive.x0, rectLive.x1));
          const y0 = Math.max(0, Math.min(rectLive.y0, rectLive.y1));
          const x1 = Math.min((canvasRef.current?.width || 0), Math.max(rectLive.x0, rectLive.x1));
          const y1 = Math.min((canvasRef.current?.height || 0), Math.max(rectLive.y0, rectLive.y1));
          const MIN_RECT = 8;
          if ((x1 - x0) >= MIN_RECT && (y1 - y0) >= MIN_RECT) {
            const w = x1 - x0;
            const h = y1 - y0;
            const id = `rect-${shapeIdRef.current++}`;
            setRectShapes((prev) => [...prev, { id, cx: x0 + w / 2, cy: y0 + h / 2, width: w, height: h, angle: 0, color }]);
            setEditsMade(true);
            setDrawOrder((prev) => [...prev, { type: 'rect', id }]);
            setSelectedShapeId(id);
          }
          setOverlayStyle(null);
          setRectStart(null);
          setRectLive(null);
        }
        // finalize any in-progress circle so Save captures it immediately
        if (circleStart && circleLive && modeRef.current === 'circle') {
          const w = Math.abs(circleLive.x1 - circleLive.x0);
          const h = Math.abs(circleLive.y1 - circleLive.y0);
          const MIN_SIDE = 4;
          if (w >= MIN_SIDE && h >= MIN_SIDE) {
            const id = `circle-${shapeIdRef.current++}`;
            const cxCenter = (circleLive.x0 + circleLive.x1) / 2;
            const cyCenter = (circleLive.y0 + circleLive.y1) / 2;
            setCircleShapes((prev) => [...prev, { id, cx: cxCenter, cy: cyCenter, rx: w / 2, ry: h / 2, angle: 0, color }]);
            setEditsMade(true);
            setDrawOrder((prev) => [...prev, { type: 'circle', id }]);
            setSelectedCircleId(id);
          }
          setOverlayStyle(null);
          setCircleStart(null);
          setCircleLive(null);
        }
        // if a stroke was just finalized (pointerup) it may not be present in state yet;
        // export it synchronously from the canvas so the Save action captures it
        if (lastFinalizedStrokeRef.current) {
          try {
            const stroke = lastFinalizedStrokeRef.current;
            // ensure the canvas contains the stroke
            redrawCanvas(stroke);
            if (canvasRef.current && state) {
              const url = canvasRef.current.toDataURL('image/png');
              // clear the ref to avoid double-saving
              lastFinalizedStrokeRef.current = null;
              onSave(url, state.filename, true);
              return;
            }
          } catch (err) {
            console.warn('[PhotoEditor.controls] immediate finalized-stroke export failed', err);
          }
        }
        handleSave(true);
      };
      doSave();
    },
    cancel: () => onCancel(),
    clearSelection: () => { setCropRect(null); setOverlayStyle(null); setCropStart(null); setLiveRect(null); setSelectedCircleId(null); setSelectedShapeId(null); setSelectedStrokeId(null); }
  }), [brushSize, color, mode, cropRect, selectedShapeId, selectedCircleId, selectedStrokeId, state]);

  useEffect(() => {
    if (typeof (onRegister as any) !== 'function') return;
    try { (onRegister as any)(controls); } catch { /* ignore */ }
    return () => { try { (onRegister as any)(null); } catch { /* ignore */ } };
  }, [controls, onRegister]);

  function updateDisplaySize(naturalW: number, naturalH: number) {
    const wrap = wrapperRef.current;
    if (!wrap || !naturalW || !naturalH) return;
    const availW = wrap.clientWidth || wrap.offsetWidth || window.innerWidth;
    const availH = wrap.clientHeight || wrap.offsetHeight || Math.max(window.innerHeight * 0.5, 400);
    // choose scale so image fits horizontally or vertically (whichever limits)
    const scale = Math.min(availW / naturalW, availH / naturalH);
    const dispW = Math.max(1, Math.round(naturalW * scale));
    const dispH = Math.max(1, Math.round(naturalH * scale));
    displayedScaleRef.current = scale;
    setCanvasStyle({ width: `${dispW}px`, height: `${dispH}px` });
  }

  function clientToCanvas(ev: PointerEvent | React.PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * (canvas.width || 1);
    const y = ((ev.clientY - rect.top) / rect.height) * (canvas.height || 1);
    return { x, y };
  }

  function rotateAround(pt: { x: number; y: number }, center: { x: number; y: number }, angle: number) {
    const dx = pt.x - center.x;
    const dy = pt.y - center.y;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return { x: center.x + dx * cosA - dy * sinA, y: center.y + dx * sinA + dy * cosA };
  }

  function canvasToLocal(pt: { x: number; y: number }, shape: RectShape) {
    const rotated = rotateAround(pt, { x: shape.cx, y: shape.cy }, -shape.angle);
    return { x: rotated.x - shape.cx, y: rotated.y - shape.cy };
  }

  function localToCanvas(local: { x: number; y: number }, shape: RectShape) {
    const rotated = rotateAround({ x: shape.cx + local.x, y: shape.cy + local.y }, { x: shape.cx, y: shape.cy }, shape.angle);
    return rotated;
  }

  function hitTestRect(pt: { x: number; y: number }, shape: RectShape) {
    const local = canvasToLocal(pt, shape);
    return Math.abs(local.x) <= shape.width / 2 && Math.abs(local.y) <= shape.height / 2;
  }

  function pointToSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    const proj = { x: a.x + t * vx, y: a.y + t * vy };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  }

  function hitTestStroke(pt: { x: number; y: number }, stroke: StrokeShape) {
    if (!stroke.points.length) return false;
    const tol = stroke.size / 2 + 6;
    for (let i = 1; i < stroke.points.length; i++) {
      const d = pointToSegmentDistance(pt, stroke.points[i - 1], stroke.points[i]);
      if (d <= tol) return true;
    }
    return false;
  }

  function pickTopShape(pt: { x: number; y: number }) {
    for (let i = drawOrder.length - 1; i >= 0; i--) {
      const item = drawOrder[i];
      if (item.type === 'rect') {
        const shape = rectShapes.find((s) => s.id === item.id);
        if (shape && hitTestRect(pt, shape)) return item;
      } else if (item.type === 'circle') {
        const c = circleShapes.find((s) => s.id === item.id);
        if (c && hitTestCircle(pt, c)) return item;
      } else {
        const stroke = strokes.find((s) => s.id === item.id);
        if (stroke && hitTestStroke(pt, stroke)) return item;
      }
    }
    return null;
  }

  function hitTestCircle(pt: { x: number; y: number }, c: CircleShape) {
    const dx = pt.x - c.cx;
    const dy = pt.y - c.cy;
    if (!c.rx || !c.ry) return false;
    const nx = dx / c.rx;
    const ny = dy / c.ry;
    return (nx * nx + ny * ny) <= 1 + 0.06; // small tolerance
  }

  function shapeDisplayStyle(shape: RectShape) {
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!canvas || !wrap || !canvas.width || !canvas.height) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scale = canvasRect.width / canvas.width;
    const w = shape.width * scale;
    const h = shape.height * scale;
    const cx = shape.cx * scale + (canvasRect.left - wrapRect.left);
    const cy = shape.cy * scale + (canvasRect.top - wrapRect.top);
    const left = cx - w / 2;
    const top = cy - h / 2;
    const angleDeg = (shape.angle * 180) / Math.PI;
    return {
      position: 'absolute' as const,
      width: `${w}px`,
      height: `${h}px`,
      left: `${left}px`,
      top: `${top}px`,
      transform: `rotate(${angleDeg}deg)`,
      transformOrigin: 'center center',
    } as React.CSSProperties;
  }

  function renderRectOnto(ctx: CanvasRenderingContext2D, s: RectShape) {
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(s.angle);
    ctx.fillStyle = s.color;
    ctx.fillRect(-s.width / 2, -s.height / 2, s.width, s.height);
    ctx.restore();
  }

  function renderCircleOnto(ctx: CanvasRenderingContext2D, c: CircleShape) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = c.color;
    const angle = c.angle || 0;
    if (ctx.ellipse) {
      ctx.ellipse(c.cx, c.cy, c.rx, c.ry, angle, 0, Math.PI * 2);
    } else {
      // fallback: draw circle using rx as radius (rotation ignored)
      ctx.arc(c.cx, c.cy, Math.max(c.rx, c.ry), 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  function renderStrokeOnto(ctx: CanvasRenderingContext2D, stroke: StrokeShape, opts?: { highlight?: boolean }) {
    if (!stroke.points.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (opts?.highlight) {
      ctx.strokeStyle = '#0074D9';
      ctx.lineWidth = stroke.size + 6;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redrawCanvas(extraStroke?: StrokeShape | null) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (baseImageRef.current) {
      ctx.putImageData(baseImageRef.current, 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const rectMap = new Map(rectShapes.map((r) => [r.id, r] as const));
    const circleMap = new Map(circleShapes.map((r) => [r.id, r] as const));
    const strokeMap = new Map(strokes.map((s) => [s.id, s] as const));
    drawOrder.forEach((item) => {
      if (item.type === 'rect') {
        const r = rectMap.get(item.id);
        if (r) renderRectOnto(ctx, r);
      } else if (item.type === 'circle') {
        const c = circleMap.get(item.id);
        if (c) renderCircleOnto(ctx, c);
      } else {
        const s = strokeMap.get(item.id);
        if (s) renderStrokeOnto(ctx, s);
      }
    });
    if (extraStroke) renderStrokeOnto(ctx, extraStroke);
    if (selectedStrokeId) {
      const s = strokeMap.get(selectedStrokeId);
      if (s) renderStrokeOnto(ctx, s, { highlight: true });
    }
  }

  function beginShapeDrag(ev: React.PointerEvent, shape: RectShape) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    const pt = clientToCanvas(ev.nativeEvent || (ev as any));
    shapeDragRef.current = { id: shape.id, startX: pt.x, startY: pt.y, startCx: shape.cx, startCy: shape.cy };
    setSelectedShapeId(shape.id);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function beginCircleDrag(ev: React.PointerEvent, shape: CircleShape) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    const pt = clientToCanvas(ev.nativeEvent || (ev as any));
    circleDragRef.current = { id: shape.id, startX: pt.x, startY: pt.y, startCx: shape.cx, startCy: shape.cy };
    setSelectedCircleId(shape.id);
    setSelectedShapeId(null);
    setSelectedStrokeId(null);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function beginCircleResize(ev: React.PointerEvent, shape: CircleShape, corner: string) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    circleResizeRef.current = { id: shape.id, corner, startShape: { ...shape } };
    setSelectedCircleId(shape.id);
    setSelectedShapeId(null);
    setSelectedStrokeId(null);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function beginCircleRotate(ev: React.PointerEvent, shape: CircleShape) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    const pt = clientToCanvas(ev.nativeEvent || (ev as any));
    const startPointerAngle = Math.atan2(pt.y - shape.cy, pt.x - shape.cx);
    const startAngle = shape.angle || 0;
    circleRotateRef.current = { id: shape.id, startAngle, startPointerAngle, startShape: { ...shape } };
    setSelectedCircleId(shape.id);
    setSelectedShapeId(null);
    setSelectedStrokeId(null);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function beginShapeResize(ev: React.PointerEvent, shape: RectShape, corner: string) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    shapeResizeRef.current = { id: shape.id, corner, startShape: { ...shape } };
    setSelectedShapeId(shape.id);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function beginShapeRotate(ev: React.PointerEvent, shape: RectShape) {
    if (mode !== 'pointer') return;
    ev.preventDefault();
    ev.stopPropagation();
    const pt = clientToCanvas(ev.nativeEvent || (ev as any));
    const startPointerAngle = Math.atan2(pt.y - shape.cy, pt.x - shape.cx);
    shapeRotateRef.current = { id: shape.id, startAngle: shape.angle, startPointerAngle, startShape: { ...shape } };
    setSelectedShapeId(shape.id);
    try { canvasRef.current?.setPointerCapture?.(ev.pointerId); lastPointerIdRef.current = ev.pointerId; } catch {}
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * (canvasRef.current?.width || 1);
    const y = ((e.clientY - rect.top) / rect.height) * (canvasRef.current?.height || 1);
    return { x, y };
  }

  // restore simple pointer-leave behavior: stop painting and clear brush preview only
  function handlePointerLeave() {
    setPainting(false);
    setBrushPreview(null);
  }

  function updateBrushPreview(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'brush') { setBrushPreview(null); return; }
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!canvas || !wrap) return;
    const rect = canvas.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scale = rect.width / (canvas.width || 1);
    const radius = Math.max(2, (brushSize / 2) * scale);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setBrushPreview({ x: x + rect.left - wrapRect.left, y: y + rect.top - wrapRect.top, diameter: radius * 2 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state) return;
    updateBrushPreview(e);
    const pos = pointerPos(e);
    if (mode === "brush") {
      setPainting(true);
      const stroke: StrokeShape = { id: `stroke-${shapeIdRef.current++}`, color, size: brushSize, points: [pos] };
      currentStrokeRef.current = stroke;
      redrawCanvas(stroke);
    } else if (mode === 'rectangle') {
      setRectStart(pos);
      setRectLive({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
      try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
    } else if (mode === 'circle') {
      setCircleStart(pos);
      setCircleLive({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
      try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
    } else if (mode === 'marquee' || mode === 'crop') {
      // begin selection and capture pointer so we continue receiving moves
      setCropStart(pos);
      try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
    } else {
      const hit = pickTopShape(pos);
      setSelectedShapeId(hit?.type === 'rect' ? hit.id : null);
      setSelectedCircleId(hit?.type === 'circle' ? hit.id : null);
      setSelectedStrokeId(hit?.type === 'stroke' ? hit.id : null);
      if (hit?.type === 'rect') {
        const shape = rectShapes.find((s) => s.id === hit.id);
        if (shape) {
          shapeDragRef.current = { id: shape.id, startX: pos.x, startY: pos.y, startCx: shape.cx, startCy: shape.cy };
          try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
        }
      } else if (hit?.type === 'circle') {
        const shape = circleShapes.find((s) => s.id === hit.id);
        if (shape) {
          circleDragRef.current = { id: shape.id, startX: pos.x, startY: pos.y, startCx: shape.cx, startCy: shape.cy };
          try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
        }
      } else if (hit?.type === 'stroke') {
        const stroke = strokes.find((s) => s.id === hit.id);
        if (stroke) {
          strokeDragRef.current = { id: stroke.id, startX: pos.x, startY: pos.y, startPoints: stroke.points.map((p) => ({ ...p })) };
          try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
        }
      } else {
        setSelectedShapeId(null);
        setSelectedCircleId(null);
        setSelectedStrokeId(null);
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state) return;
    updateBrushPreview(e);
    if (mode === "brush" && painting) {
      const pos = pointerPos(e);
      const stroke = currentStrokeRef.current;
      if (stroke) {
        stroke.points.push(pos);
        redrawCanvas(stroke);
      }
      return;
    }
    if (mode === 'rectangle' && rectStart) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const live = { x0: rectStart.x, y0: rectStart.y, x1: x, y1: y };
      setRectLive(live);
      updateCropOverlay(live);
      return;
    }

    if (mode === 'circle' && circleStart) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const live = { x0: circleStart.x, y0: circleStart.y, x1: x, y1: y };
      setCircleLive(live);
      updateCropOverlay(live);
      return;
    }
    // while dragging a selection, update the liveRect immediately (so user sees the box while dragging)
    if (cropStart && (mode === 'marquee' || mode === 'crop')) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const live = { x0: cropStart.x, y0: cropStart.y, x1: x, y1: y };
      setLiveRect(live);
      // update overlay position immediately
      updateCropOverlay(live);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state) return;

    if (mode === 'brush') {
      const stroke = currentStrokeRef.current;
      if (stroke && stroke.points.length) {
        redrawCanvas(stroke);
        setStrokes((prev) => [...prev, stroke]);
        setDrawOrder((prev) => [...prev, { type: 'stroke', id: stroke.id }]);
        setEditsMade(true);
        try { lastFinalizedStrokeRef.current = stroke; } catch {}
        currentStrokeRef.current = null;
      } else {
        currentStrokeRef.current = null;
      }
      setPainting(false);
      try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
      return;
    }

    if (mode === 'rectangle' && rectStart) {
      const end = pointerPos(e);
      const x0 = Math.max(0, Math.min(rectStart.x, end.x));
      const y0 = Math.max(0, Math.min(rectStart.y, end.y));
      const x1 = Math.min((canvasRef.current?.width || 0), Math.max(rectStart.x, end.x));
      const y1 = Math.min((canvasRef.current?.height || 0), Math.max(rectStart.y, end.y));
      const MIN_RECT = 8;
      if ((x1 - x0) >= MIN_RECT && (y1 - y0) >= MIN_RECT) {
        const w = x1 - x0;
        const h = y1 - y0;
        const id = `rect-${shapeIdRef.current++}`;
        setRectShapes((prev) => [...prev, { id, cx: x0 + w / 2, cy: y0 + h / 2, width: w, height: h, angle: 0, color }]);
        setDrawOrder((prev) => [...prev, { type: 'rect', id }]);
        setSelectedShapeId(id);
        setSelectedCircleId(null);
        setSelectedStrokeId(null);
      }
      setRectStart(null);
      setRectLive(null);
      setOverlayStyle(null);
      try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
      return;
    }

    if (mode === 'circle' && circleStart) {
      const end = pointerPos(e);
      const x0 = Math.max(0, Math.min(circleStart.x, end.x));
      const y0 = Math.max(0, Math.min(circleStart.y, end.y));
      const x1 = Math.min((canvasRef.current?.width || 0), Math.max(circleStart.x, end.x));
      const y1 = Math.min((canvasRef.current?.height || 0), Math.max(circleStart.y, end.y));
      const w = x1 - x0;
      const h = y1 - y0;
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      const MIN_R = 4;
      if (rx >= MIN_R && ry >= MIN_R) {
        const cx = x0 + w / 2;
        const cy = y0 + h / 2;
        const id = `circle-${shapeIdRef.current++}`;
        setCircleShapes((prev) => [...prev, { id, cx, cy, rx, ry, color }]);
        setEditsMade(true);
        setDrawOrder((prev) => [...prev, { type: 'circle', id }]);
        setSelectedCircleId(id);
        setSelectedShapeId(null);
        setSelectedStrokeId(null);
      }
      setCircleStart(null);
      setCircleLive(null);
      setOverlayStyle(null);
      try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
      return;
    }

    if (cropStart && (mode === 'marquee' || mode === 'crop')) {
      const end = pointerPos(e);
      const dx = Math.abs(end.x - cropStart.x);
      const dy = Math.abs(end.y - cropStart.y);
      const MIN_CROP = 8; // canvas pixels
      if (dx < MIN_CROP || dy < MIN_CROP) {
        setCropStart(null);
        setCropRect(null);
        setLiveRect(null);
        try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
        return;
      }
      const x0 = Math.max(0, Math.min(cropStart.x, end.x));
      const y0 = Math.max(0, Math.min(cropStart.y, end.y));
      const x1 = Math.min((canvasRef.current?.width || 0), Math.max(cropStart.x, end.x));
      const y1 = Math.min((canvasRef.current?.height || 0), Math.max(cropStart.y, end.y));
      const rect = { x0, y0, x1, y1 };
      setCropRect(rect);
      updateCropOverlay(rect);
      setCropStart(null);
      setLiveRect(null);
      try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
    }
  }

  function fillRect(rect: { x0: number; y0: number; x1: number; y1: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const x = Math.max(0, Math.min(rect.x0, rect.x1));
    const y = Math.max(0, Math.min(rect.y0, rect.y1));
    const w = Math.abs(rect.x1 - rect.x0);
    const h = Math.abs(rect.y1 - rect.y0);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function applyCrop(a: { x: number; y: number }, b: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const x0 = Math.max(0, Math.min(a.x, b.x));
      const y0 = Math.max(0, Math.min(a.y, b.y));
      const x1 = Math.min(canvas.width, Math.max(a.x, b.x));
      const y1 = Math.min(canvas.height, Math.max(a.y, b.y));
      const w = Math.max(0, x1 - x0);
      const h = Math.max(0, y1 - y0);
      const MIN_CROP = 8; // pixels
      if (w < MIN_CROP || h < MIN_CROP) {
        console.warn('Crop aborted: selection too small', { w, h });
        setCropRect(null);
        setCropStart(null);
        setLiveRect(null);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = ctx.getImageData(x0, y0, w, h);
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(imgData, 0, 0);
      try { baseImageRef.current = ctx.getImageData(0, 0, w, h); } catch {}
      // update displayed size to reflect new aspect
      updateDisplaySize(w, h);
      const shiftedShapes = rectShapes
        .map((s) => ({ ...s, cx: s.cx - x0, cy: s.cy - y0 }))
        .filter((s) => s.cx >= 0 && s.cx <= w && s.cy >= 0 && s.cy <= h);
      setRectShapes(shiftedShapes);
      const shiftedCircles = circleShapes
        .map((c) => ({ ...c, cx: c.cx - x0, cy: c.cy - y0 }))
        .filter((c) => c.cx >= 0 && c.cx <= w && c.cy >= 0 && c.cy <= h);
      setCircleShapes(shiftedCircles);
      const shiftedStrokes = strokes
        .map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x - x0, y: p.y - y0 })) }))
        .filter((s) => s.points.some((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h));
      setStrokes(shiftedStrokes);
      const validIds = new Set([...shiftedShapes.map((s) => s.id), ...shiftedCircles.map((s) => s.id), ...shiftedStrokes.map((s) => s.id)]);
      setDrawOrder((prev) => prev.filter((item) => validIds.has(item.id)));
      setSelectedShapeId((id) => shiftedShapes.some((s) => s.id === id) ? id : null);
      setSelectedStrokeId((id) => shiftedStrokes.some((s) => s.id === id) ? id : null);
      setSelectedCircleId((id) => shiftedCircles.some((s) => s.id === id) ? id : null);
      // updateDisplaySize already adjusted displayed size; no aspect state needed
      setCropRect(null);
      setCropStart(null);
      setLiveRect(null);
      setOverlayStyle(null);
      setEditsMade(true);
    } catch (err) {
      console.error('applyCrop failed', err);
      setCropRect(null);
      setCropStart(null);
      setLiveRect(null);
      setOverlayStyle(null);
    }
  }

  function updateCropOverlay(rect: { x0: number; y0: number; x1: number; y1: number } | null) {
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!rect || !canvas || !wrap) { setOverlayStyle(null); return; }
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const left = canvasRect.left - wrapRect.left;
    const top = canvasRect.top - wrapRect.top;
    const scaleW = canvasRect.width / canvas.width;
    const scaleH = canvasRect.height / canvas.height;
    const x = Math.min(rect.x0, rect.x1) * scaleW + left;
    const y = Math.min(rect.y0, rect.y1) * scaleH + top;
    const w = Math.abs(rect.x1 - rect.x0) * scaleW;
    const h = Math.abs(rect.y1 - rect.y0) * scaleH;
    setOverlayStyle({ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  // compute overlay style on-the-fly (used so liveRect will render immediately
  // even if overlayStyle state hasn't been set yet)
  function computeOverlayStyle(rect: { x0: number; y0: number; x1: number; y1: number } | null) {
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!rect || !canvas || !wrap) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const left = canvasRect.left - wrapRect.left;
    const top = canvasRect.top - wrapRect.top;
    const scaleW = canvasRect.width / canvas.width;
    const scaleH = canvasRect.height / canvas.height;
    const x = Math.min(rect.x0, rect.x1) * scaleW + left;
    const y = Math.min(rect.y0, rect.y1) * scaleH + top;
    const w = Math.abs(rect.x1 - rect.x0) * scaleW;
    const h = Math.abs(rect.y1 - rect.y0) * scaleH;
    return { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` } as React.CSSProperties;
  }

  function deleteSelection() {
    const targetStroke = selectedStrokeId;
    const targetRect = selectedShapeId;
    const targetCircle = selectedCircleId;
    if (!targetStroke && !targetRect && !targetCircle) return;
    setRectShapes((prev) => prev.filter((s) => s.id !== targetRect));
    setCircleShapes((prev) => prev.filter((s) => s.id !== targetCircle));
    setStrokes((prev) => prev.filter((s) => s.id !== targetStroke));
    setDrawOrder((prev) => prev.filter((item) => {
      if (item.type === 'rect') return item.id !== targetRect;
      if (item.type === 'circle') return item.id !== targetCircle;
      return item.id !== targetStroke;
    }));
    setSelectedShapeId(null);
    setSelectedCircleId(null);
    setSelectedStrokeId(null);
    setEditsMade(true);
    redrawCanvas();
  }

  function handleSave(forceEdits?: boolean) {
    if (!state || !canvasRef.current) return;
    redrawCanvas();
    const url = canvasRef.current.toDataURL("image/png");
    onSave(url, state.filename, typeof forceEdits === 'boolean' ? forceEdits : editsMade);
  }

  if (!state) {
    return (
      <div className="editor-placeholder">
        <div>No photo selected</div>
        <div style={{ color: "#666", fontSize: 12 }}>Capture a photo, then edit it here.</div>
      </div>
    );
  }

  return (
    <div className="editor-container">
      <div className="editor-stage" ref={wrapperRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}
        onPointerDown={(e) => {
          // clicking outside the overlay cancels the current selection
          if (!cropRect) return;
          const wrap = wrapperRef.current;
          const canvas = canvasRef.current;
          if (!wrap || !canvas) return;
          const overlayRect = overlayStyle ? {
            left: parseFloat(String(overlayStyle.left).replace('px','')) + (wrap.getBoundingClientRect().left || 0),
            top: parseFloat(String(overlayStyle.top).replace('px','')) + (wrap.getBoundingClientRect().top || 0),
            width: parseFloat(String(overlayStyle.width).replace('px','')),
            height: parseFloat(String(overlayStyle.height).replace('px','')),
          } : null;
          const cx = (e as React.PointerEvent).clientX;
          const cy = (e as React.PointerEvent).clientY;
          if (!overlayRect) return;
          if (cx < overlayRect.left || cx > overlayRect.left + overlayRect.width || cy < overlayRect.top || cy > overlayRect.top + overlayRect.height) {
            setCropRect(null);
            setOverlayStyle(null);
          }
        }}
      >
          <canvas
          ref={canvasRef}
          className="editor-canvas"
          style={canvasStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
        {brushPreview && mode === 'brush' && (
          <div
            style={{
              position: 'absolute',
              left: `${brushPreview.x - brushPreview.diameter / 2}px`,
              top: `${brushPreview.y - brushPreview.diameter / 2}px`,
              width: `${brushPreview.diameter}px`,
              height: `${brushPreview.diameter}px`,
              border: '1px solid rgba(0,0,0,0.65)',
              borderRadius: '50%',
              pointerEvents: 'none',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.4)'
            }}
          />
        )}
        {((rectLive || liveRect || cropRect || circleLive) && canvasRef.current) && (() => {
          const currentRect = rectLive || liveRect || cropRect || circleLive;
          const currentStyle = computeOverlayStyle(currentRect);
          if (!currentStyle) return null;
          const isRectPreview = !!rectLive && !cropRect;
          const isCirclePreview = !!circleLive && !cropRect;
          const borderColor = isRectPreview || isCirclePreview ? 'transparent' : '#555';
          const overlayBg = isRectPreview || isCirclePreview ? color : 'rgba(0,0,0,0.05)';
          const pointerEvents = isRectPreview || isCirclePreview ? 'none' : 'auto';
          return (
            <div
              className="crop-overlay"
              style={{ position: 'absolute', boxSizing: 'border-box', border: `2px ${isRectPreview || isCirclePreview ? 'solid' : 'dashed'} ${borderColor}`, background: overlayBg, pointerEvents, zIndex: isRectPreview || isCirclePreview ? 5 : 1, ...(currentStyle || {}), borderRadius: isCirclePreview ? '50%' : undefined }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                const corner = target.dataset?.corner;
                if (corner && cropRect) {
                  resizingRef.current = { corner, startClientX: e.clientX, startClientY: e.clientY, origRect: { ...cropRect } };
                  try { canvasRef.current?.setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
                  e.stopPropagation();
                }
              }}
            >
              {cropRect && (
                <>
                  <div data-corner="nw" style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} />
                  <div data-corner="ne" style={{ position: 'absolute', right: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} />
                  <div data-corner="sw" style={{ position: 'absolute', left: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} />
                  <div data-corner="se" style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} />
                </>
              )}
            </div>
          );
        })()}
        {circleShapes.map((shape) => {
          const canvas = canvasRef.current;
          const wrap = wrapperRef.current;
          if (!canvas || !wrap) return null;
          const canvasRect = canvas.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();
          const scale = canvasRect.width / canvas.width;
          const w = shape.rx * 2 * scale;
          const h = shape.ry * 2 * scale;
          const cx = shape.cx * scale + (canvasRect.left - wrapRect.left);
          const cy = shape.cy * scale + (canvasRect.top - wrapRect.top);
          const left = cx - w / 2;
          const top = cy - h / 2;
          const orderIndex = drawOrder.findIndex((d) => d.type === 'circle' && d.id === shape.id);
          const z = orderIndex >= 0 ? 10 + orderIndex : 2;
          const selected = shape.id === selectedCircleId;
          const angleDeg = ((shape.angle || 0) * 180) / Math.PI;
          return (
            <div
              key={shape.id}
              style={{
                position: 'absolute',
                width: `${w}px`,
                height: `${h}px`,
                left: `${left}px`,
                top: `${top}px`,
                borderRadius: '50%',
                transform: `rotate(${angleDeg}deg)`,
                transformOrigin: 'center center',
                boxSizing: 'border-box',
                border: selected ? '2px solid #0074D9' : '2px solid transparent',
                background: 'transparent',
                boxShadow: selected ? '0 0 0 1px rgba(0,116,217,0.8)' : undefined,
                pointerEvents: selected && mode === 'pointer' ? 'auto' : 'none',
                cursor: mode === 'pointer' ? 'move' : 'default',
                zIndex: z,
              }}
              onPointerDown={(ev) => beginCircleDrag(ev, shape)}
            >
              {selected && mode === 'pointer' && (
                <>
                  <div data-rotate="true" style={{ position: 'absolute', left: '50%', top: -28, width: 14, height: 14, marginLeft: -7, borderRadius: '50%', background: '#fff', border: '1px solid #000', cursor: 'grab' }} onPointerDown={(ev) => beginCircleRotate(ev, shape)} />
                  <div data-corner="nw" style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} onPointerDown={(ev) => beginCircleResize(ev, shape, 'nw')} />
                  <div data-corner="ne" style={{ position: 'absolute', right: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} onPointerDown={(ev) => beginCircleResize(ev, shape, 'ne')} />
                  <div data-corner="sw" style={{ position: 'absolute', left: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} onPointerDown={(ev) => beginCircleResize(ev, shape, 'sw')} />
                  <div data-corner="se" style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} onPointerDown={(ev) => beginCircleResize(ev, shape, 'se')} />
                </>
              )}
            </div>
          );
        })}

        {rectShapes.map((shape) => {
          const style = shapeDisplayStyle(shape);
          if (!style) return null;
          const selected = shape.id === selectedShapeId;
          const orderIndex = drawOrder.findIndex((d) => d.type === 'rect' && d.id === shape.id);
          const z = orderIndex >= 0 ? 10 + orderIndex : 2;
          const borderColor = selected ? '#0074D9' : 'transparent';
          return (
            <div
              key={shape.id}
              style={{
                ...style,
                boxSizing: 'border-box',
                border: `2px solid ${borderColor}`,
                background: 'transparent',
                boxShadow: selected ? '0 0 0 1px rgba(0,116,217,0.8)' : undefined,
                pointerEvents: selected && mode === 'pointer' ? 'auto' : 'none',
                cursor: mode === 'pointer' ? 'move' : 'default',
                zIndex: z,
              }}
              onPointerDown={(ev) => beginShapeDrag(ev, shape)}
            >
              {selected && mode === 'pointer' && (
                <>
                  <div data-corner="nw" style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} onPointerDown={(ev) => beginShapeResize(ev, shape, 'nw')} />
                  <div data-corner="ne" style={{ position: 'absolute', right: -6, top: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} onPointerDown={(ev) => beginShapeResize(ev, shape, 'ne')} />
                  <div data-corner="sw" style={{ position: 'absolute', left: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nesw-resize' }} onPointerDown={(ev) => beginShapeResize(ev, shape, 'sw')} />
                  <div data-corner="se" style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '1px solid #000', borderRadius: 2, cursor: 'nwse-resize' }} onPointerDown={(ev) => beginShapeResize(ev, shape, 'se')} />
                  <div data-rotate="true" style={{ position: 'absolute', left: '50%', top: -28, width: 14, height: 14, marginLeft: -7, borderRadius: '50%', background: '#fff', border: '1px solid #000', cursor: 'grab' }} onPointerDown={(ev) => beginShapeRotate(ev, shape)} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TraceCaptureProps = {
  projectName: string;
  processedImages?: { original?: string | null; traced?: string | null; offset?: string | null } | null;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  onImageFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  calibrationInputRef: React.RefObject<HTMLInputElement | null>;
  onEditorActiveChange?: (active: boolean) => void;
  onEditorRegister?: (controls: any | null) => void;
};

export default function TraceCapture({ projectName, processedImages, panelRef, imageInputRef, onImageFile, calibrationInputRef, onEditorActiveChange, onEditorRegister }: TraceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const matsRef = useRef<{ mtx: any; dist: any } | null>(null);
  const calibrationRef = useRef<Calibration | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [captureName, setCaptureName] = useState("");
  const [photoList, setPhotoList] = useState<PhotoItem[]>([]);
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  // notify parent when the editor opens/closes
  useEffect(() => {
    try { onEditorActiveChange?.(!!editorState); } catch { /* ignore */ }
  }, [editorState, onEditorActiveChange]);
  const [busyCapture, setBusyCapture] = useState(false);
  const [busyList, setBusyList] = useState(false);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCalib, setUploadingCalib] = useState(false);
  const editingActive = loadingEditor || !!editorState;
  const streamRef = useRef<MediaStream | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // If editor/other views take over, stop the camera preview and reset selection
  useEffect(() => {
    if (editingActive && showCameraPreview) {
      stopCameraPreview();
    }
  }, [editingActive, showCameraPreview]);

  // Load OpenCV and calibration once
  useEffect(() => {
    ensureOpenCv()
      .then(() => setCvReady(true))
      .catch(() => setCvReady(false));
    fetchCalibration();
  }, []);

  async function fetchCalibration() {
    try {
      const r = await fetch(`${backendUrl}/api/photos/calibration`);
      const j = r.ok ? await r.json() : null;
      if (j && j.camera_matrix && j.distortion_coefficients) {
        calibrationRef.current = j as Calibration;
      }
    } catch { /* ignore */ }
  }

  // Request camera permission helper
  async function requestCameraPermission() {
    setStreamError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
      // re-run device enumeration after permission
      const devs = await navigator.mediaDevices.enumerateDevices();
      setDevices(devs.filter((d) => d.kind === 'videoinput'));
      setStreamError(null);
    } catch (e: any) {
      setStreamError(e?.message || String(e));
    }
  }

  // Prepare calibration mats when cv is ready
  useEffect(() => {
    if (!cvReady || !window.cv || !calibrationRef.current) return;
    const cv = window.cv;
    const cal = calibrationRef.current;
    const distVal = cal.distortion_coefficients || [];
    const flatDist = Array.isArray(distVal) && Array.isArray((distVal as any)[0])
      ? (distVal as number[][]).flat()
      : (distVal as number[]);
    const mtx = cv.matFromArray(3, 3, cv.CV_64F, new Float64Array(((cal.camera_matrix || []) as number[][]).flat()));
    const dist = cv.matFromArray(1, flatDist.length, cv.CV_64F, new Float64Array(flatDist));
    matsRef.current = { mtx, dist };
    return () => {
      try { matsRef.current?.mtx?.delete(); } catch { /* ignore */ }
      try { matsRef.current?.dist?.delete(); } catch { /* ignore */ }
      matsRef.current = null;
    };
  }, [cvReady, projectName]);

  // Keep camera preview sized to fit within the viewport while preserving aspect ratio
  useEffect(() => {
    function updatePreviewSize() {
      if (!showCameraPreview) return;
      const parent = previewWrapRef.current?.parentElement;
      const maxW = Math.max(240, (parent?.clientWidth ?? window.innerWidth) - 16);
      const maxH = Math.max(240, window.innerHeight - 180);
      const widthByHeight = (maxH * 4) / 3;
      const width = Math.min(maxW, widthByHeight);
      const height = Math.round((width * 3) / 4);
      setPreviewSize({ width, height });
    }
    updatePreviewSize();
    window.addEventListener('resize', updatePreviewSize);
    return () => window.removeEventListener('resize', updatePreviewSize);
  }, [showCameraPreview]);

  function stopCameraPreview() {
    setShowCameraPreview(false);
    setSelectedDeviceId(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch { /* ignore */ }
  }

  // Start/stop video stream when device or preview visibility changes (no default selection)
  useEffect(() => {
    async function start() {
      try {
        setStreamError(null);
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          setStreamError('WebRTC APIs not available. Ensure the app is served over https or localhost and your browser supports navigator.mediaDevices.');
          setDevices([]);
          return;
        }

        // First try to enumerate devices
        let devs = await navigator.mediaDevices.enumerateDevices();
            // enumerateDevices initial
        let videoInputs = devs.filter((d) => d.kind === 'videoinput');

        // Some browsers return no device list until getUserMedia permission is granted.
        // If none found, attempt a lightweight permission request to reveal devices.
        if (videoInputs.length === 0) {
          try {
            // No videoinput found; requesting temporary getUserMedia to prompt permission and reveal devices
            const probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            probeStream.getTracks().forEach((t) => t.stop());
            devs = await navigator.mediaDevices.enumerateDevices();
            // enumerateDevices after permission probe
            videoInputs = devs.filter((d) => d.kind === 'videoinput');
          } catch (err: any) {
            console.warn('Permission probe failed:', err);
            // If permission was denied or failed, expose the message so the user can act
            setStreamError(err?.message || 'Camera permission denied or not available');
          }
        }

        setDevices(videoInputs);

        // If user hasn't selected a device or preview is hidden, do not auto-start streaming
        if (!selectedDeviceId || !showCameraPreview) return;

        const constraints: MediaStreamConstraints = {
          video: { deviceId: { exact: selectedDeviceId }, width: { ideal: 4000 }, height: { ideal: 3000 } },
          audio: false,
        };

        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
        } catch (e: any) {
          console.error('getUserMedia for selected device failed', e);
          setStreamError(e?.message || 'Unable to access camera for selected device');
        }
      } catch (e: any) {
        console.error('Error starting video stream:', e);
        setStreamError(e?.message || 'Unable to access camera');
      }
    }
    start();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [selectedDeviceId, showCameraPreview]);

  // Draw preview (undistort if available)
  useEffect(() => {
    if (!showCameraPreview) return;
    let rafId: number | null = null;
    function drawFrame() {
      const video = videoRef.current;
      const rawCanvas = rawCanvasRef.current;
      const displayCanvas = displayCanvasRef.current;
      // schedule next frame always so we keep polling for the video becoming ready
      rafId = window.requestAnimationFrame(drawFrame);
      if (!video || !rawCanvas || !displayCanvas) return;
      let vw = video.videoWidth;
      let vh = video.videoHeight;
      // if the video isn't ready yet, fall back to the display canvas size so we can
      // continue drawing frames until metadata is available
      if (!vw || !vh) {
        const rect = displayCanvas.getBoundingClientRect();
        vw = Math.max(1, Math.round(rect.width));
        vh = Math.max(1, Math.round(rect.height));
      }
      const targetW = vw || 1;
      const targetH = vh || 1;
      rawCanvas.width = targetW;
      rawCanvas.height = targetH;
      displayCanvas.width = targetW;
      displayCanvas.height = targetH;
      // use willReadFrequently when we call getImageData via OpenCV to improve performance
      const rawCtx = rawCanvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
      const dispCtx = displayCanvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!rawCtx || !dispCtx) return;
      rawCtx.drawImage(video as CanvasImageSource, 0, 0, targetW, targetH);
      if (cvReady && window.cv && matsRef.current) {
        try {
          const src = window.cv.imread(rawCanvas);
          const dst = new window.cv.Mat();
          window.cv.undistort(src, dst, matsRef.current.mtx, matsRef.current.dist);
          window.cv.imshow(displayCanvas, dst);
          src.delete();
          dst.delete();
        } catch (e) {
          dispCtx.drawImage(rawCanvas, 0, 0);
        }
      } else {
        dispCtx.drawImage(rawCanvas, 0, 0);
      }
      // raf is already scheduled at top
    }
    // start loop
    rafId = window.requestAnimationFrame(drawFrame);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [cvReady, showCameraPreview]);

  async function refreshList() {
    try {
      setBusyList(true);
      const resp = await fetch(`${backendUrl}/api/photos/list?project=${encodeURIComponent(projectName)}`);
      const j = await resp.json();
      const allImages = (j.items || []).filter((p: PhotoItem) => typeof p.name === "string" && /\.(png|jpe?g)$/i.test(p.name));
      setPhotoList(allImages);
    } catch (e) {
      console.error("list photos failed", e);
    } finally {
      setBusyList(false);
    }
  }

  useEffect(() => {
    refreshList();
  }, [projectName]);

  async function handleCapture() {
    if (!displayCanvasRef.current) return;
    setBusyCapture(true);
    try {
      const dataUrl = displayCanvasRef.current.toDataURL("image/png");
      const resp = await fetch(`${backendUrl}/api/photos/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, name: captureName, dataUrl }),
      });
      const j = await resp.json();
      if (!resp.ok || j.error) {
        alert(`Capture failed: ${j.error || resp.statusText}`);
      } else {
        setCaptureName("");
        refreshList();
      }
    } catch (e: any) {
      alert(`Capture failed: ${e?.message || e}`);
    } finally {
      setBusyCapture(false);
    }
  }

  async function openForEdit(item: PhotoItem) {
    try {
      stopCameraPreview();
      setLoadingEditor(true);
      let filename = item.name;
      // No longer rename or mark files when opening for edit — use the original filename as provided
      const imgResp = await fetch(`${backendUrl}/api/photos/raw?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(filename)}`);
      if (!imgResp.ok) throw new Error("Could not load image for edit");
      const blob = await imgResp.blob();
      const dataUrl = await blobToDataUrl(blob);
      setEditorState({ filename, dataUrl });
    } catch (e: any) {
      alert(`Open edit failed: ${e?.message || e}`);
    } finally {
      setLoadingEditor(false);
    }
  }

  // Load an image from server and feed it into the same image pipeline as the file input
  async function loadImageFromPhoto(item: PhotoItem) {
    try {
      stopCameraPreview();
      // ensure any open editor is closed so the processed preview becomes visible
      setEditorState(null);
      setLoadingEditor(false);
      const resp = await fetch(`${backendUrl}/api/photos/raw?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(item.name)}`);
      if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
      const blob = await resp.blob();
      const file = new File([blob], item.name, { type: blob.type || 'image/png' });
      // synthesize a ChangeEvent-like object expected by onImageFile
      const fakeEvent = {
        target: { files: [file] },
        currentTarget: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      try {
        onImageFile(fakeEvent);
      } catch (e) {
        // fallback: trigger the file input and set files there if possible
        try {
          const dt = new DataTransfer();
          dt.items.add(file as any);
          if (imageInputRef.current) {
            (imageInputRef.current as HTMLInputElement).files = dt.files;
            // dispatch change event
            const ev = new Event('change', { bubbles: true });
            imageInputRef.current.dispatchEvent(ev);
          }
        } catch (err) {
          console.error('Load fallback failed', err);
          alert('Could not load image into pipeline.');
        }
      }
    } catch (e: any) {
      alert(`Load failed: ${e?.message || e}`);
    }
  }

  async function handleSaveEdited(dataUrl: string, filename: string, editorEditsMade?: boolean) {
    try {
      // handleSaveEdited called
      // if nothing changed (no tracked edits), just close editor
      if (!editorEditsMade) {
        setEditorState(null);
        setLoadingEditor(false);
        return;
      }
      const resp = await fetch(`${backendUrl}/api/photos/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, filename, dataUrl }),
      });
      const j = await resp.json();
      if (!resp.ok || j.error) {
        alert(`Save failed: ${j.error || resp.statusText}`);
      } else {
        // close editor and ensure processed preview is shown
        setEditorState(null);
        setLoadingEditor(false);
        refreshList();
      }
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`);
    }
  }

  async function handleUploadCalibration(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingCalib(true);
    try {
      const fd = new FormData();
      fd.append('calibration', file);
      const resp = await fetch(`${backendUrl}/api/photos/calibration-upload`, { method: 'POST', body: fd });
      const ct = resp.headers.get('content-type') || '';
      let j: any = null;
      if (ct.includes('application/json')) {
        j = await resp.json();
      } else {
        const text = await resp.text();
        try { j = JSON.parse(text); } catch { j = { error: text || resp.statusText }; }
      }
      if (!resp.ok || (j && j.error)) {
        const detail = (j && (j.error || j.detail)) || resp.statusText;
        alert(`Calibration upload failed: ${detail}`);
      } else {
        await fetchCalibration();
        alert('Calibration uploaded');
      }
    } catch (err: any) {
      alert(`Calibration upload failed: ${err?.message || err}`);
    } finally {
      setUploadingCalib(false);
      try { e.target.value = ''; } catch { /* ignore */ }
    }
  }

  return (
    <div className="trace-workspace" ref={panelRef}>
      <div className="capture-column">
        <div className="capture-card">
          <div style={{ marginBottom: 8 }}>
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onImageFile} />
            <input ref={calibrationInputRef} type="file" accept=".pkl,.json" style={{ display: "none" }} onChange={handleUploadCalibration} />
          </div>
          <div className="section-header" style={{ marginBottom: 8 }}>Capture photo</div>
          <div className="capture-actions">
          </div>
          <div className="capture-controls">
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Camera
              <select
                value={selectedDeviceId || ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setSelectedDeviceId(val);
                  setShowCameraPreview(!!val);
                  if (val) {
                    setEditorState(null);
                    setLoadingEditor(false);
                  }
                }}
                style={{ flex: 1 }}
              >
                <option value="">Select a camera…</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', fontSize: 11 }}>
              <button
                onClick={requestCameraPermission}
                style={{ padding: '2px 6px', fontSize: 11, height: 24 }}
                title="Temporarily request camera permission"
              >
                Request
              </button>
              <button
                className="action-text-button"
                style={{ padding: '2px 6px', fontSize: 11, height: 24 }}
                onClick={() => calibrationInputRef.current?.click()}
                disabled={uploadingCalib}
              >
                Load calibration
              </button>
              <div style={{ color: '#666', fontSize: 11, flex: 1 }}>Click to request camera permission if cameras don't appear.</div>
            </div>
            {streamError && <div className="error-text">{streamError}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="text"
                placeholder="Photo name"
                value={captureName}
                onChange={(e) => setCaptureName(e.target.value)}
                ref={nameInputRef}
                style={{ flex: 1 }}
              />
            </div>
            <button onClick={handleCapture} disabled={busyCapture || !captureName.trim() || !selectedDeviceId}>
              {busyCapture ? "Saving..." : "Capture Photo"}
            </button>
          </div>
        </div>
          <div className="capture-card">
          <div className="section-header" style={{ marginBottom: 8 }}>Captured photos</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={refreshList} disabled={busyList}>Refresh</button>
            <button onClick={() => { stopCameraPreview(); setEditorState(null); setLoadingEditor(false); imageInputRef.current?.click(); }}>Load Image</button>
          </div>
          <div className="photo-list">
            {busyList && <div>Loading...</div>}
            {!busyList && !photoList.length && <div style={{ color: "#666" }}>No photos yet</div>}
            {photoList.map((p) => (
              <div key={p.name} className="photo-row">
                <div>
                  <div className="photo-name">{p.name}</div>
                  <div className="photo-meta">{p.edited ? "edited" : "raw"} · {(p.size / 1024).toFixed(1)} KB</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => openForEdit(p)}>Edit</button>
                  <button onClick={() => loadImageFromPhoto(p)}>Load</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="editor-column">
        {showCameraPreview && selectedDeviceId && (
          <div className="capture-card">
            <div className="section-header" style={{ marginBottom: 8 }}>Camera preview</div>
            <div
              className="preview-wrap"
              ref={previewWrapRef}
              style={{
                height: previewSize.height ? `${previewSize.height}px` : 'auto',
                width: previewSize.width ? `${previewSize.width}px` : '100%',
                maxWidth: '100%',
                margin: '6px auto',
              }}
            >
              <video ref={videoRef} className="capture-video" muted playsInline />
              <canvas ref={displayCanvasRef} className="capture-canvas" />
            </div>
          </div>
        )}
        {!showCameraPreview && editingActive && (
          <div className="capture-card">
            <div className="section-header" style={{ marginBottom: 8 }}>{editorState?.filename || 'Edit photo'}</div>
            {loadingEditor && <div>Loading image…</div>}
            <PhotoEditor
              state={editorState}
              onSave={handleSaveEdited}
              onCancel={() => setEditorState(null)}
              onRegister={onEditorRegister}
            />
          </div>
        )}
        {!showCameraPreview && !editingActive && (
          <div className="capture-card">
            <div className="section-header" style={{ marginBottom: 8 }}>Processed preview</div>
            <TraceCanvas images={processedImages || undefined} />
          </div>
        )}
      </div>
      <canvas ref={rawCanvasRef} style={{ display: "none" }} />
    </div>
  );
}
