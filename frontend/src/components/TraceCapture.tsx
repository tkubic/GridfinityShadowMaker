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

type PhotoEditorProps = {
  state: EditorState;
  onSave: (dataUrl: string, filename: string) => void;
  onCancel: () => void;
  onRegister?: (controls: any | null) => void;
};

function PhotoEditor({ state, onSave, onCancel, onRegister }: PhotoEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [brushSize, setBrushSize] = useState(28);
  const [mode, setMode] = useState<"brush" | "crop" | "select">("select");
  const [brushPreview, setBrushPreview] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const [painting, setPainting] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // liveRect is the in-progress rectangle while dragging; cropRect is the finalized selection
  const [liveRect, setLiveRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // aspect ratio is implicitly tracked via canvas width/height and display sizing
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const displayedScaleRef = useRef<number>(1);
  const [canvasStyle, setCanvasStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [color, setColor] = useState<"#000000" | "#ffffff">('#000000');
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null);
  const resizingRef = useRef<null | { corner: string; startClientX: number; startClientY: number; origRect: any }>(null);
  const lastPointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state) return;
    // default to selection when a new image is opened for editing
    setMode('select');
    setBrushPreview(null);
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
      // if resizing via corner handle, process here
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
        // when resizing, this is a finalized change (user is interacting with handles)
        setLiveRect(null);
        updateCropOverlay(newRect);
        return;
      }
      // if a selection drag is in progress (cropStart), update live
      if (cropStart && (mode === 'select' || mode === 'crop')) {
        const rect = canvas.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
        const live = { x0: cropStart.x, y0: cropStart.y, x1: x, y1: y };
        setLiveRect(live);
        updateCropOverlay(live);
      }
    }

    function globalPointerUp() {
      // finalize any in-progress actions
      if (cropStart) {
        // finalize using the last liveRect (updated during pointermove)
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
      setLiveRect(null);
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

  // register editor controls with parent via `onRegister` prop
  useEffect(() => {
    if (typeof (onRegister as any) !== 'function') return;
    const controls = {
      setBrushSize: (s: number) => setBrushSize(s),
      // selecting a color should also automatically switch to brush mode
      setColor: (c: "#000000" | "#ffffff") => { setColor(c); setMode('brush'); },
      setMode: (m: string) => setMode(m as any),
      getState: () => ({ brushSize, color, mode, cropRect }),
      applyCrop: () => {
        if (!cropRect) return;
        applyCrop({ x: cropRect.x0, y: cropRect.y0 }, { x: cropRect.x1, y: cropRect.y1 });
      },
      save: () => handleSave(),
      cancel: () => onCancel(),
      clearSelection: () => { setCropRect(null); setOverlayStyle(null); setCropStart(null); setLiveRect(null); }
    };
    try { (onRegister as any)(controls); } catch { /* ignore */ }
    return () => { try { (onRegister as any)(null); } catch { /* ignore */ } };
  }, [brushSize, color, mode, cropRect, onRegister]);

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

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * (canvasRef.current?.width || 1);
    const y = ((e.clientY - rect.top) / rect.height) * (canvasRef.current?.height || 1);
    return { x, y };
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
      paintAt(pos.x, pos.y);
    } else {
      // begin selection and capture pointer so we continue receiving moves
      setCropStart(pos);
      try { (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state) return;
    updateBrushPreview(e);
    if (mode === "brush" && painting) {
      const pos = pointerPos(e);
      paintAt(pos.x, pos.y);
      return;
    }
    // while dragging a selection, update the liveRect immediately (so user sees the box while dragging)
    if (cropStart && (mode === 'select' || mode === 'crop')) {
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
    if (mode === "brush") {
    // capture the pointer so we continue receiving move/up events
    try { (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
    }
    if (cropStart) {
      const end = pointerPos(e);
      const dx = Math.abs(end.x - cropStart.x);
      const dy = Math.abs(end.y - cropStart.y);
      const MIN_CROP = 8; // canvas pixels
      if (dx < MIN_CROP || dy < MIN_CROP) {
        // abort tiny selections
        setCropStart(null);
        setCropRect(null);
        setLiveRect(null);
        try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
        return;
      }
      // finalize selection but do not apply crop yet — show overlay with handles
      const x0 = Math.max(0, Math.min(cropStart.x, end.x));
      const y0 = Math.max(0, Math.min(cropStart.y, end.y));
      const x1 = Math.min((canvasRef.current?.width || 0), Math.max(cropStart.x, end.x));
      const y1 = Math.min((canvasRef.current?.height || 0), Math.max(cropStart.y, end.y));
      const rect = { x0, y0, x1, y1 };
      setCropRect(rect);
      updateCropOverlay(rect);
      setCropStart(null);
      setLiveRect(null);
      // release pointer capture
      try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId); } catch {}
    }
  }

  function paintAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
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
      // update displayed size to reflect new aspect
      updateDisplaySize(w, h);
      // updateDisplaySize already adjusted displayed size; no aspect state needed
      setCropRect(null);
      setCropStart(null);
      setLiveRect(null);
      setOverlayStyle(null);
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

  function handleSave() {
    if (!state || !canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    onSave(url, state.filename);
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
          onPointerLeave={() => { setPainting(false); setBrushPreview(null); }}
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
        {((liveRect || cropRect) && canvasRef.current) && (() => {
          const currentRect = liveRect || cropRect;
          const currentStyle = computeOverlayStyle(currentRect);
          if (!currentStyle) return null;
          return (
            <div
              className="crop-overlay"
              style={{ position: 'absolute', boxSizing: 'border-box', border: '2px dashed #555', background: 'rgba(0,0,0,0.05)', pointerEvents: 'auto', ...(currentStyle || {}) }}
              onPointerDown={(e) => {
                // allow resizing from corner handles via child elements
                const target = e.target as HTMLElement;
                const corner = target.dataset?.corner;
                if (corner && cropRect) {
                  resizingRef.current = { corner, startClientX: e.clientX, startClientY: e.clientY, origRect: { ...cropRect } };
                  // capture pointer so we continue receiving move/up even if pointer leaves overlay
                  try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); lastPointerIdRef.current = e.pointerId; } catch {}
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

  // Start/stop video stream when device changes (no default selection)
  useEffect(() => {
    let currentStream: MediaStream | null = null;
    async function start() {
      try {
        setStreamError(null);
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs.filter((d) => d.kind === "videoinput"));
        if (!selectedDeviceId) return; // do not auto-start; user must pick a camera

        const constraints: MediaStreamConstraints = {
          video: { deviceId: { exact: selectedDeviceId }, width: { ideal: 4000 }, height: { ideal: 3000 } },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        setStreamError(e?.message || "Unable to access camera");
      }
    }
    start();
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [selectedDeviceId]);

  // Draw preview (undistort if available)
  useEffect(() => {
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
  }, [cvReady]);

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
      setLoadingEditor(true);
      let filename = item.name;
      if (filename.startsWith("_")) {
        const resp = await fetch(`${backendUrl}/api/photos/mark-edited`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: projectName, filename }),
        });
        const j = await resp.json();
        if (resp.ok && j.filename) {
          filename = j.filename;
          refreshList();
        } else if (!resp.ok) {
          alert(`Edit failed: ${j.error || resp.statusText}`);
          setLoadingEditor(false);
          return;
        }
      }
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

  async function handleSaveEdited(dataUrl: string, filename: string) {
    try {
      const resp = await fetch(`${backendUrl}/api/photos/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectName, filename, dataUrl }),
      });
      const j = await resp.json();
      if (!resp.ok || j.error) {
        alert(`Save failed: ${j.error || resp.statusText}`);
      } else {
        setEditorState(null);
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
            <button onClick={() => imageInputRef.current?.click()}>Load Image</button>
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
                onChange={(e) => setSelectedDeviceId(e.target.value || null)}
                style={{ flex: 1 }}
              >
                <option value="">Select a camera…</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                ))}
              </select>
            </label>
            {streamError && <div className="error-text">{streamError}</div>}
            <div className="preview-wrap">
              <video ref={videoRef} className="capture-video" muted playsInline />
              <canvas ref={displayCanvasRef} className="capture-canvas" />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <button className="action-text-button" style={{ padding: '2px 6px', fontSize: 12 }} onClick={() => calibrationInputRef.current?.click()} disabled={uploadingCalib}>
                Load calibration
              </button>
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
              {busyCapture ? "Saving..." : "Capture & Save"}
            </button>
          </div>
        </div>
        <div className="capture-card">
          <div className="section-header" style={{ marginBottom: 8 }}>Captured photos</div>
          <button style={{ marginBottom: 8 }} onClick={refreshList} disabled={busyList}>Refresh</button>
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
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="editor-column">
        {editingActive && (
          <div className="capture-card">
            <div className="section-header" style={{ marginBottom: 8 }}>Edit photo</div>
            {loadingEditor && <div>Loading image…</div>}
            <PhotoEditor
              state={editorState}
              onSave={handleSaveEdited}
              onCancel={() => setEditorState(null)}
              onRegister={onEditorRegister}
            />
          </div>
        )}
        {!editingActive && (
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
