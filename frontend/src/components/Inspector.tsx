import React from "react";
import type {
  BoardConfig,
  ToolShape,
  CutType,
  ScoopType,
  ShapeType,
} from "../types";
import { FONT_OPTIONS } from "../types";

interface InspectorProps {
  board: BoardConfig;
  selectedItem: "board" | string;
  selectedShape: ToolShape | null;
  editFields: Record<string, string>;
  setEditFields: (f: Record<string, string>) => void;
  commitEditField: (key: string) => void;
  updateShape: (id: string, partial: Partial<ToolShape>, opts?: { skipHistory?: boolean }) => void;
  updateBoard: (partial: Partial<BoardConfig>) => void;
  deleteShape: (id: string) => void;
  textInputRef: React.RefObject<HTMLInputElement | null>;
  activeTab?: "trace" | "canvas" | "render";
  processImageAgain?: (params: { threshold?: number; offset?: number; token?: number; resolution?: number }) => void;
  traceParams?: { threshold: number; offset: number; token: number; resolution: number };
  setTraceParams?: (p: { threshold: number; offset: number; token: number; resolution: number }) => void;
  transferPolylines?: () => void;
  hasPendingPolylines?: boolean;
  editingActive?: boolean;
  unitsMode?: "mm" | "inches";
  // Actions handed down from App
  exportDxfs?: () => void;
  generateScad?: () => void;
  editorControls?: any;
}

export default function Inspector({
  board,
  selectedItem,
  selectedShape,
  editFields,
  setEditFields,
  commitEditField,
  updateShape,
  updateBoard,
  deleteShape,
  textInputRef,
  activeTab = "canvas",
  processImageAgain,
  traceParams,
  setTraceParams,
  transferPolylines,
  hasPendingPolylines = false,
  editingActive = false,
  editorControls = null,
  exportDxfs,
  generateScad,
  unitsMode = "inches",
}: InspectorProps) {
  // Limit the inspector to two known font files for now: Verdana and ARLRDBD (Arial Rounded MT Bold)
  const [availableFonts] = React.useState<string[] | null>([
    'verdana.ttf',
    'ARLRDBD.TTF',
  ]);
  // When the selected shape has a fontFile registered, ensure the page has a matching @font-face
  React.useEffect(() => {
    if (!selectedShape) return;
    const fname = selectedShape.fontFile as string | undefined;
    if (!fname) return;
    const base = fname.replace(/\.[^.]+$/, '');
    const family = `GSM-${base}`;
    const styleId = `gsm-font-${base}`;
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      const fontUrl = `http://localhost:5000/fonts/${fname}`;
      const rules = `@font-face { font-family: '${family}'; src: url('${fontUrl}') format('truetype'); font-weight: 400; font-style: normal; }\n`;
      style.appendChild(document.createTextNode(rules));
      document.head.appendChild(style);
    }
    // Don't clobber buffered edit fields here — `selectItem` initializes
    // the buffered `editFields` when a shape is selected. Only register
    // the @font-face so the inspector select can render correctly.
  }, [selectedShape, setEditFields]);
  // Keep track of which inspector field (if any) the user is actively editing.
  const [focusedField, setFocusedField] = React.useState<string | null>(null);

  const useInches = unitsMode === "inches";
  const unitLabel = useInches ? "inches" : "mm";
  const toDisplay = (mm: number) => (useInches ? mm / 25.4 : mm);
  const fromDisplay = (val: number) => (useInches ? val * 25.4 : val);
  const formatDisplay = (n: number, decimals = 1) => (useInches ? n.toFixed(3) : n.toFixed(decimals));
  // Round values to the UI step: in mm we keep tenths (0.1), in inches use per-field step
  const roundToStep = (n: number, stepDisplay: number) => {
    if (!isFinite(stepDisplay) || stepDisplay <= 0) return n;
    const factor = 1 / stepDisplay;
    return Math.round(n * factor) / factor;
  };
  const formatBoardLabel = (mm: number) => {
    if (useInches) return `${(mm / 25.4).toFixed(2)} inches`;
    return `${Math.round(mm)}mm`;
  };
  const unitSizeLabel = useInches ? `${(board.cellSizeMM / 25.4).toFixed(3)} inches` : `${board.cellSizeMM} mm`;

  const isStepperInput = (native?: InputEvent) => {
    if (!native) return false;
    const t = native.inputType;
    // Spinner clicks and arrow increments often surface as insertReplacementText or deleteContentBackward
    return t === 'insertReplacementText' || t === 'deleteContentBackward' || t === 'deleteContentForward';
  };
  const stepperPointerRef = React.useRef(false);

  function buildNumberField(config: {
    editKey: string;
    getValue: () => number;
    commitValue: (n: number) => void;
    format?: (n: number) => string;
    transform?: (n: number) => number;
  }) {
    const formatter = config.format ?? ((n: number) => `${n}`);
    const getInitial = () => formatter(config.getValue());

    const applyCommit = (raw: string) => {
      const parsed = parseFloat(raw);
      if (Number.isNaN(parsed)) {
        const fallback = getInitial();
        setEditFields((prev) => ({ ...prev, [config.editKey]: fallback }));
        return fallback;
      }
      const next = config.transform ? config.transform(parsed) : parsed;
      config.commitValue(next);
      const formatted = formatter(next);
      setEditFields((prev) => ({ ...prev, [config.editKey]: formatted }));
      return formatted;
    };

    const revert = () => {
      const fallback = getInitial();
      setEditFields((prev) => ({ ...prev, [config.editKey]: fallback }));
      return fallback;
    };

    const commitIfStepper = (val: string, native?: InputEvent) => {
      if (stepperPointerRef.current || isStepperInput(native)) {
        applyCommit(val);
        stepperPointerRef.current = false;
        return true;
      }
      return false;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setEditFields((prev) => ({ ...prev, [config.editKey]: val }));
      commitIfStepper(val, e.nativeEvent as InputEvent | undefined);
    };

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      const val = (e.target as HTMLInputElement).value;
      commitIfStepper(val, (e as unknown as React.ChangeEvent<HTMLInputElement>).nativeEvent as InputEvent | undefined);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocusedField(null);
      applyCommit(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        applyCommit(e.currentTarget.value);
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'Escape') {
        revert();
        setFocusedField(null);
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        requestAnimationFrame(() => applyCommit(e.currentTarget.value));
      }
    };

    const handleFocus = () => {
      setFocusedField(config.editKey);
      if (editFields[config.editKey] === undefined) {
        setEditFields((prev) => ({ ...prev, [config.editKey]: getInitial() }));
      }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const spinnerZonePx = 22; // heuristic width of native spinner area
      if (e.clientX >= rect.right - spinnerZonePx) {
        stepperPointerRef.current = true;
      }
    };

    return {
      value: editFields[config.editKey] ?? getInitial(),
      onChange: handleChange,
      onInput: handleInput,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onPointerDown: handlePointerDown,
    };
  }

  // When the selected shape's key properties change externally (for example
  // when the user drags or rotates the shape), and the inspector field is
  // not currently being edited, clear the edit buffer so the inspector shows
  // the live values. If a field is focused we don't clear so the user's
  // in-progress edit isn't disrupted.
  React.useEffect(() => {
    if (!selectedShape) {
      setEditFields({});
      return;
    }
    if (focusedField) return;
    // Clearing the editFields causes inputs to render the live values again.
    setEditFields({});
    // Depend on the snapshot so this effect runs when those values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedField, selectedShape ? JSON.stringify({
    x: selectedShape.x,
    y: selectedShape.y,
    rotateDeg: selectedShape.rotateDeg,
    scale: selectedShape.scale,
    depthMM: selectedShape.depthMM,
    widthMM: selectedShape.widthMM,
    heightMM: selectedShape.heightMM,
    fontSizeMM: selectedShape.fontSizeMM,
    cutType: selectedShape.cutType,
    splitToSections: selectedShape.splitToSections,
    sectionDepths: selectedShape.sectionDepths,
    sectionWidths: selectedShape.sectionWidths,
  }) : null]);
  // If we're in trace tab, show trace-specific controls in the inspector
  if (activeTab === "trace") {
    if (editingActive) {
      // Show editor controls in the inspector when a photo is being edited
      // `editorControls` will be provided by App (registered from TraceCapture)
      // editorControls passed from App (registered by TraceCapture)
      const editor = (editorControls && editorControls.getState) ? editorControls : null;
      const brushSize = editor?.getState?.().brushSize ?? 28;
      const currentColor = editor?.getState?.().color ?? '#000000';
      const mode = editor?.getState?.().mode ?? 'select';
      const toolButtonStyle = (active: boolean): React.CSSProperties => ({ padding: '6px 8px', border: active ? '2px solid #0074D9' : '1px solid #ccc', background: active ? '#e8f3ff' : '#f8f8f8', borderRadius: 6, minWidth: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' });
      return (
        <aside className="panel panel-right">
          <h2>Photo Editor</h2>
          <div className="field">
            <label>Brush Size</label>
            <input type="range" min={4} max={200} value={brushSize} onChange={(e) => editor?.setBrushSize?.(Number(e.target.value))} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <div onClick={() => { editor?.setColor?.('#000000'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ width: Math.max(10, Math.round(brushSize * 0.4)), height: Math.max(10, Math.round(brushSize * 0.4)), background: '#000', borderRadius: '50%', border: currentColor === '#000000' ? '2px solid #0074D9' : undefined }} />
                <small>Black</small>
              </div>
              <div onClick={() => { editor?.setColor?.('#ffffff'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ width: Math.max(10, Math.round(brushSize * 0.4)), height: Math.max(10, Math.round(brushSize * 0.4)), background: '#fff', borderRadius: '50%', border: currentColor === '#ffffff' ? '2px solid #0074D9' : '1px solid #000' }} />
                <small>White</small>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action-text-button" style={toolButtonStyle(mode === 'pointer')} onClick={() => editor?.setMode?.('pointer')} title="Pointer" aria-label="Pointer" aria-pressed={mode === 'pointer'}>
                <svg aria-hidden="true" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 2 7 18 2-7 7-2Z" />
                </svg>
              </button>
              <button className="action-text-button" style={toolButtonStyle(mode === 'marquee')} onClick={() => editor?.setMode?.('marquee')} title="Marquee" aria-label="Marquee" aria-pressed={mode === 'marquee'}>
                <div style={{ width: 20, height: 14, boxSizing: 'border-box', border: '2px dashed #000', display: 'inline-block' }} />
              </button>
              <button className="action-text-button" style={toolButtonStyle(mode === 'crop')} onClick={() => editor?.cropSelection?.()} title="Crop" aria-label="Crop" aria-pressed={mode === 'crop'}>
                <svg
                  aria-hidden="true"
                  width={24}
                  height={24}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 3v11a3 3 0 0 0 3 3h11" />
                  <path d="M17 21V10a3 3 0 0 0-3-3H3" />
                </svg>
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action-text-button" style={toolButtonStyle(mode === 'brush')} onClick={() => editor?.setMode?.('brush')} title="Brush" aria-label="Brush" aria-pressed={mode === 'brush'}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 19 7-7 3 3-7 7-3-3Z" />
                  <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5Z" />
                </svg>
              </button>
              <button className="action-text-button" style={toolButtonStyle(mode === 'rectangle')} onClick={() => editor?.setMode?.('rectangle')} title="Rectangle" aria-label="Rectangle" aria-pressed={mode === 'rectangle'}>
                <div style={{ width: 18, height: 14, border: `2px solid ${currentColor}`, background: currentColor }} />
              </button>
              <button className="action-text-button" style={toolButtonStyle(mode === 'circle')} onClick={() => editor?.setMode?.('circle')} title="Circle" aria-label="Circle" aria-pressed={mode === 'circle'}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${currentColor}`, background: currentColor }} />
              </button>
            </div>
          </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action-text-button" onClick={() => editor?.deleteSelection?.()}>Delete</button>
            <button className="action-text-button" onClick={() => {
              try {
                const live = (window as any).__editorControls || editor;
                live?.save?.();
              } catch (e) { console.error('Inspector.save error', e); }
            }}>Save</button>
            <button className="action-text-button" onClick={() => editor?.cancel?.()}>Cancel</button>
          </div>
        </aside>
      );
    }
    // trace inputs are lifted into App state via props
    const threshold = traceParams?.threshold ?? 145;
    const offset = traceParams?.offset ?? 0.1; // inches
    const tokenSize = traceParams?.token ?? 3.0; // inches
    const resolution = traceParams?.resolution ?? 20;

    return (
      <aside className="panel panel-right">
        <h2>Trace Inspector</h2>
        <div className="field">
          <label>Threshold (0-255)</label>
          <input type="number" min={0} max={255} value={threshold} onChange={(e) => setTraceParams?.({ threshold: parseInt(e.target.value || '0'), offset: offset, token: tokenSize, resolution })} />
        </div>
        <div className="field">
          <label>Offset (inches)</label>
          <input type="number" step="0.01" value={offset} onChange={(e) => setTraceParams?.({ threshold, offset: parseFloat(e.target.value || '0'), token: tokenSize, resolution })} />
        </div>
        <div className="field">
          <label>Token Size</label>
          <input type="number" step="0.1" value={tokenSize} onChange={(e) => setTraceParams?.({ threshold, offset, token: parseFloat(e.target.value || '0'), resolution })} />
        </div>
        <div className="field">
          <label>Resolution</label>
          <input type="number" step="1" value={resolution} onChange={(e) => setTraceParams?.({ threshold, offset, token: tokenSize, resolution: parseInt(e.target.value || '0') })} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="action-text-button"
              onClick={() => processImageAgain?.({ threshold, offset, token: tokenSize, resolution })}
              title="Process Image Again"
            >
              Process Image Again
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="action-text-button"
              onClick={() => transferPolylines?.()}
              title="Transfer traced polylines to the canvas as shapes"
              disabled={!hasPendingPolylines}
            >
              Transfer to Canvas
            </button>
          </div>
          {!hasPendingPolylines && (
            <div style={{ color: '#888', fontSize: '0.9rem', marginTop: 6 }}>No traced geometry to transfer</div>
          )}
        </div>
      </aside>
    );
  }
  return (
    <aside className="panel panel-right">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="action-text-button" onClick={() => exportDxfs?.()}>
          Output DXF's
        </button>
        <button className="action-text-button" onClick={() => generateScad?.()}>
          Generate STL
        </button>
      </div>
      <h2>Inspector</h2>

      {selectedItem === "board" && (
        <>
          <h3>Board Size</h3>
          <div className="board-controls">
            <div className="field">
              <label>{`Width (units) - ${formatBoardLabel((board.gridX || 0) * (board.cellSizeMM || 0))}`}</label>
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={board.gridX}
                onChange={(e) =>
                  updateBoard({
                    gridX: Math.max(0.1, parseFloat(e.target.value) || 0.1),
                  })
                }
              />
            </div>
            <div className="field">
              <label>{`Depth (units) - ${formatBoardLabel((board.gridY || 0) * (board.cellSizeMM || 0))}`}</label>
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={board.gridY}
                onChange={(e) =>
                  updateBoard({
                    gridY: Math.max(0.1, parseFloat(e.target.value) || 0.1),
                  })
                }
              />
            </div>
            <div className="field">
              {/* Cell size intentionally hidden in inspector per request */}
            </div>
            <div className="field">
              <label>{`Height (7mm units) - ${formatBoardLabel((board.height7Units || 0) * 7)}`}</label>
              <input
                type="number"
                step={0.1}
                min={0}
                value={board.height7Units ?? 0}
                onChange={(e) =>
                  updateBoard({
                    height7Units: Math.max(0, parseFloat(e.target.value) || 0),
                  })
                }
              />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="chamferEnabled"
                checked={board.chamferEnabled ?? true}
                onChange={(e) => updateBoard({ chamferEnabled: e.target.checked })}
              />
              <label htmlFor="chamferEnabled" style={{ marginBottom: 0 }}>Add Chamfer</label>
            </div>
            {(board.chamferEnabled ?? true) && (
              <div className="field">
                <label>{`Chamfer Height (${unitLabel})`}</label>
                <input
                  type="number"
                  step={useInches ? 0.001 : 0.1}
                  min={0}
                  value={toDisplay(board.chamferHeight ?? 2)}
                  onChange={(e) => updateBoard({ chamferHeight: Math.max(0, fromDisplay(parseFloat(e.target.value) || 0)) })}
                />
              </div>
            )}
            <small>1 unit = {unitSizeLabel}</small>
          </div>
        </>
      )}
      {selectedItem !== "board" && !selectedShape && <p>No item selected</p>}

      {selectedShape && selectedItem !== "board" && (
          <>
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={selectedShape.name}
              onChange={(e) =>
                updateShape(selectedShape.id, {
                  name: e.target.value,
                })
              }
            />
          </div>

          <div className="field">
            <label>Type</label>
            <select
              value={selectedShape.type}
              onChange={(e) => {
                const newType = e.target.value as ShapeType;
                if (newType === "rect") {
                  const defaultDim = 20;
                  updateShape(selectedShape.id, {
                    type: "rect",
                    widthMM: selectedShape.widthMM ?? defaultDim,
                    heightMM: selectedShape.heightMM ?? defaultDim,
                    scoop: "none",
                  });
                } else if (newType === "oval") {
                  const defaultDim = 20;
                  updateShape(selectedShape.id, {
                    type: "oval",
                    widthMM: selectedShape.widthMM ?? defaultDim,
                    heightMM: selectedShape.heightMM ?? defaultDim,
                  });
                } else {
                  updateShape(selectedShape.id, { type: newType as ShapeType });
                }
              }}
            >
              <option value="rect">Rectangle</option>
              <option value="oval">Circle/Oval</option>
              <option value="text">Text</option>
              <option value="dxf">DXF</option>
            </select>
          </div>

          {selectedShape.type === "rect" && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="field" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="cornerRadiusEnabled"
                  checked={selectedShape.cornerRadiusEnabled ?? false}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    if (enabled) {
                      updateShape(selectedShape.id, { cornerRadiusEnabled: true, cornerRadiusMM: selectedShape.cornerRadiusMM ?? 2 });
                      const displayRadius = toDisplay(selectedShape.cornerRadiusMM ?? 2);
                      setEditFields({ ...editFields, cornerRadius: formatDisplay(displayRadius, 1) });
                    } else {
                      updateShape(selectedShape.id, { cornerRadiusEnabled: false });
                      setEditFields({ ...editFields, cornerRadius: undefined });
                    }
                  }}
                  style={{ width: 'auto', margin: 0 }}
                />
                <label htmlFor="cornerRadiusEnabled" style={{ marginBottom: 0 }}>Corner Radius</label>
              </div>

              <div className="field" style={{ flex: 1, minWidth: 0 }}>
                <label>{`radius (${unitLabel})`}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  disabled={!(selectedShape.cornerRadiusEnabled ?? false)}
                  {...buildNumberField({
                    editKey: 'cornerRadius',
                    getValue: () => toDisplay(selectedShape.cornerRadiusMM ?? 2),
                    format: (n) => formatDisplay(n, 1),
                    transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { cornerRadiusMM: fromDisplay(n) }); },
                  })}
                />
              </div>
            </div>
          )}

          <div className="field">
            <label>Extrude Type</label>
            <select
              value={selectedShape.cutType ?? "Cut"}
              onChange={(e) => {
                const v = e.target.value as CutType;
                if (v === "Raised") {
                  updateShape(selectedShape.id, { cutType: v, depthMM: 0.6 });
                  setEditFields({ ...editFields, cutType: v, depth: (0.6).toFixed(1) });
                } else if (v === "Cut") {
                  updateShape(selectedShape.id, { cutType: v, depthMM: 15 });
                  setEditFields({ ...editFields, cutType: v, depth: (15).toFixed(1) });
                } else if (v === "Blocker") {
                  const boardHeightUnits = board.height7Units ?? 6;
                  const blockerDepth = Math.max(0, boardHeightUnits - 1) * 7;
                  updateShape(selectedShape.id, { cutType: v, depthMM: blockerDepth });
                  setEditFields({ ...editFields, cutType: v, depth: blockerDepth.toFixed(1) });
                } else {
                  updateShape(selectedShape.id, { cutType: v });
                  setEditFields({ ...editFields, cutType: v });
                }
              }}
            >
              <option value="Cut">Cut</option>
              <option value="Blocker">Blocker</option>
              <option value="Raised">Raised</option>
            </select>
          </div>

          {selectedShape.type === "text" && (
            <>
              <div className="field">
                <label>Text</label>
                <input
                  ref={textInputRef}
                  type="text"
                  value={editFields.text ?? (selectedShape.text ?? selectedShape.name)}
                  onChange={(e) => setEditFields({ ...editFields, text: e.target.value })}
                  onBlur={() => updateShape(selectedShape.id, { text: editFields.text ?? selectedShape.text ?? selectedShape.name })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>

              <div className="field">
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    type="button"
                    className={"toggle-btn" + (selectedShape.fontBold ? " active" : "")}
                    onClick={() => updateShape(selectedShape.id, { fontBold: !selectedShape.fontBold })}
                    title="Bold"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className={"toggle-btn" + (selectedShape.fontItalic ? " active" : "")}
                    onClick={() => updateShape(selectedShape.id, { fontItalic: !selectedShape.fontItalic })}
                    title="Italic"
                  >
                    <i>I</i>
                  </button>
                  <button
                    type="button"
                    className={"toggle-btn" + (selectedShape.fontUnderline ? " active" : "")}
                    onClick={() => updateShape(selectedShape.id, { fontUnderline: !selectedShape.fontUnderline })}
                    title="Underline"
                  >
                    <span style={{ textDecoration: "underline" }}>U</span>
                  </button>
                </div>

                <label>Font</label>
                <select
                  value={editFields.font ?? (selectedShape.fontName ?? "Nunito, Arial, Helvetica, sans-serif")}
                  onChange={(e) => {
                    const v = e.target.value;
                    // If the inspector has populated availableFonts, the option value
                    // will be a filename (e.g. 'verdana.ttf'). In that case we want to
                    // register a @font-face for display and store both a CSS family
                    // (in fontName) and the actual filename (in fontFile) for export.
                    if (availableFonts && availableFonts.includes(v)) {
                      const fname = v;
                      const base = fname.replace(/\.[^.]+$/, '');
                      const family = `GSM-${base}`;
                      // create (or reuse) a style tag to define the font-family mapping
                      const styleId = `gsm-font-${base}`;
                      if (!document.getElementById(styleId)) {
                        const style = document.createElement('style');
                        style.id = styleId;
                        // base face (normal) - point to backend fonts endpoint so browser can fetch the TTF
                        const fontUrl = `http://localhost:5000/fonts/${fname}`;
                        let rules = `@font-face { font-family: '${family}'; src: url('${fontUrl}') format('truetype'); font-weight: 400; font-style: normal; }\n`;
                        // if bold/italic variants present, try to register them too (common suffixes)
                        const tryNames = [base + 'b', base + 'B', base + 'Bold', base + 'bold', base + 'i', base + 'I', base + 'Italic', base + 'italic', base + '-bold', base + '-italic'];
                        for (const cand of tryNames) {
                          if (availableFonts.includes(cand + '.ttf')) {
                            const url = `/fonts/${cand}.ttf`;
                            if (/i/i.test(cand)) {
                              rules += `@font-face { font-family: '${family}'; src: url('${url}') format('truetype'); font-weight: 400; font-style: italic; }\n`;
                            } else {
                              rules += `@font-face { font-family: '${family}'; src: url('${url}') format('truetype'); font-weight: 700; font-style: normal; }\n`;
                            }
                          }
                        }
                        style.appendChild(document.createTextNode(rules));
                        document.head.appendChild(style);
                      }
                      // store filename in the edit field so the select's value matches
                      setEditFields({ ...editFields, font: fname });
                      updateShape(selectedShape.id, { fontName: family, fontFile: fname });
                    } else {
                      setEditFields({ ...editFields, font: v });
                      updateShape(selectedShape.id, { fontName: v });
                    }
                  }}
                  onBlur={() => {
                    const val = editFields.font ?? selectedShape.fontName ?? '';
                    if (availableFonts && availableFonts.includes(val)) {
                      const fname = val;
                      const base = fname.replace(/\.[^.]+$/, '');
                      const family = `GSM-${base}`;
                      updateShape(selectedShape.id, { fontName: family, fontFile: fname });
                    } else {
                      updateShape(selectedShape.id, { fontName: val });
                    }
                  }}
                >
                  {availableFonts && availableFonts.length > 0 ? (
                    availableFonts.map((fname) => (
                      <option key={fname} value={fname}>{fname.replace(/\.[^.]+$/, '')}</option>
                    ))
                  ) : (
                    FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="field">
                <label>{`Font size (${unitLabel})`}</label>
                <input
                  type="number"
                  step={useInches ? 0.02 : 0.1}
                  {...buildNumberField({
                    editKey: 'fontSize',
                    getValue: () => toDisplay(selectedShape.fontSizeMM ?? 15),
                    format: (n) => formatDisplay(n, 1),
                    transform: (n) => roundToStep(n, useInches ? 0.02 : 0.1),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { fontSizeMM: fromDisplay(n) }); },
                  })}
                />
              </div>

              <div className="field">
                <label>{`Depth (${unitLabel})`}</label>
                <input
                  type="number"
                  step={0.1}
                  {...buildNumberField({
                    editKey: 'depth',
                    getValue: () => toDisplay(selectedShape.depthMM ?? 0.6),
                    format: (n) => formatDisplay(n, 1),
                    transform: (n) => roundToStep(n, useInches ? 0.1 : 0.1),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { depthMM: fromDisplay(n) }); },
                  })}
                  style={{ width: "100%" }}
                  disabled={(selectedShape.cutType ?? "Cut") === "Blocker" || (selectedShape.splitToSections ?? false)}
                />
              </div>
              <div className="field">
                <label>Rotate (deg)</label>
                <input
                  type="number"
                  step="1"
                  {...buildNumberField({
                    editKey: 'rotate',
                    getValue: () => selectedShape.rotateDeg ?? 0,
                    format: (n) => n.toFixed(1),
                    transform: (n) => Math.round(n),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { rotateDeg: n }); },
                  })}
                  style={{ width: "100%" }}
                />
              </div>

              {/* Split to Sections - for Text Cut type shapes */}
              {(selectedShape.cutType ?? "Cut") === "Cut" && (
                <>
                  <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      id="splitToSectionsText"
                      checked={selectedShape.splitToSections ?? false}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        if (enabled) {
                          const depth = selectedShape.depthMM ?? 15;
                          updateShape(selectedShape.id, {
                            splitToSections: true,
                            sectionDepths: [depth, Math.round(depth * 0.67), Math.round(depth * 0.33)],
                            sectionWidths: [20, 0],
                            sectionRotation: 0,
                          });
                        } else {
                          updateShape(selectedShape.id, { splitToSections: false });
                        }
                      }}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <label htmlFor="splitToSectionsText" style={{ marginBottom: 0 }}>Split to Sections</label>
                  </div>

                  {selectedShape.splitToSections && (
                    <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                      <div className="field">
                        <label>{`Section Depths (${unitLabel})`}</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth0',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[0] ?? 20),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[0] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 1 (innermost)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth1',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[1] ?? 15),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[1] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 2 (middle)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth2',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[2] ?? 10),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[2] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 3 (outermost)"
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                      </div>

                      <div className="field">
                        <label>{`Center Island / Offset (${unitLabel})`}</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionWidth0',
                              getValue: () => toDisplay(selectedShape.sectionWidths?.[0] ?? 20),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[0] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title={`Center island width (${unitLabel})`}
                          />
                          <input
                            type="number"
                            step="1"
                            min="-9999"
                            {...buildNumberField({
                              editKey: 'sectionWidth1',
                              getValue: () => toDisplay(selectedShape.sectionWidths?.[1] ?? 0),
                              format: (n) => n.toString(),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[1] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title={`Offset of center island from center (${unitLabel}). Positive shifts right.`}
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                      </div>

                      <div className="field">
                        <label>Section Rotation (deg)</label>
                        <input
                          type="number"
                          step="1"
                          {...buildNumberField({
                            editKey: 'sectionRotation',
                            getValue: () => selectedShape.sectionRotation ?? 0,
                            format: (n) => n.toFixed(1),
                            transform: (n) => Math.round(n * 10) / 10,
                            commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { sectionRotation: n }); },
                          })}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>{`X (${unitLabel})`}</label>
                <input
                type="number"
                step={useInches ? 0.05 : 0.1}
                {...buildNumberField({
                  editKey: 'x',
                  getValue: () => toDisplay(selectedShape.x ?? 0),
                  format: (n) => formatDisplay(n, 1),
                  transform: (n) => roundToStep(n, useInches ? 0.05 : 0.1),
                  commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { x: fromDisplay(n) }); },
                })}
                style={{ width: "100%" }}
              />
            </div>

            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>{`Y (${unitLabel})`}</label>
                <input
                type="number"
                step={useInches ? 0.05 : 0.1}
                {...buildNumberField({
                  editKey: 'y',
                  getValue: () => toDisplay(selectedShape.y ?? 0),
                  format: (n) => formatDisplay(n, 1),
                  transform: (n) => roundToStep(n, useInches ? 0.05 : 0.1),
                  commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { y: fromDisplay(n) }); },
                })}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {selectedShape.type === "dxf" ? (
            <>
              <div className="field">
                <label>Rotate (deg)</label>
                <input
                  type="number"
                  step="1"
                  {...buildNumberField({
                    editKey: 'rotate',
                    getValue: () => selectedShape.rotateDeg ?? 0,
                    format: (n) => n.toFixed(1),
                    transform: (n) => Math.round(n),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { rotateDeg: n }); },
                  })}
                      style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>Scale</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                  {...buildNumberField({
                    editKey: 'scale',
                    getValue: () => selectedShape.scale ?? 1,
                    format: (n) => n.toFixed(1),
                    transform: (n) => Math.max(0.1, Math.round(n * 10) / 10),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { scale: n }); },
                  })}
                      style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>{`Depth (${unitLabel})`}</label>
                <input
                  type="number"
                  step={useInches ? 0.001 : 0.1}
                  {...buildNumberField({
                    editKey: 'depth',
                    getValue: () => toDisplay(selectedShape.depthMM ?? 0.6),
                    format: (n) => formatDisplay(n, 1),
                    transform: (n) => roundForUnits(n, 1),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { depthMM: fromDisplay(n) }); },
                  })}
                      style={{ width: "100%" }}
                    disabled={(selectedShape.cutType ?? "Cut") === "Blocker" || (selectedShape.splitToSections ?? false)}
                />
              </div>

              {/* Split to Sections - for DXF Cut type shapes */}
              {(selectedShape.cutType ?? "Cut") === "Cut" && (
                <>
                  <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      id="splitToSectionsDxf"
                      checked={selectedShape.splitToSections ?? false}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        if (enabled) {
                          const depth = selectedShape.depthMM ?? 15;
                          updateShape(selectedShape.id, {
                            splitToSections: true,
                            sectionDepths: [depth, Math.round(depth * 0.67), Math.round(depth * 0.33)],
                            sectionWidths: [20, 0],
                            sectionRotation: 0,
                          });
                        } else {
                          updateShape(selectedShape.id, { splitToSections: false });
                        }
                      }}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <label htmlFor="splitToSectionsDxf" style={{ marginBottom: 0 }}>Split to Sections</label>
                  </div>

                  {selectedShape.splitToSections && (
                    <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                      <div className="field">
                        <label>{`Section Depths (${unitLabel})`}</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth0',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[0] ?? 20),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[0] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 1 (innermost)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth1',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[1] ?? 15),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[1] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 2 (middle)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionDepth2',
                              getValue: () => toDisplay(selectedShape.sectionDepths?.[2] ?? 10),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[2] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title="Depth 3 (outermost)"
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                      </div>

                      <div className="field">
                        <label>{`Center Island / Offset (${unitLabel})`}</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            {...buildNumberField({
                              editKey: 'sectionWidth0',
                              getValue: () => toDisplay(selectedShape.sectionWidths?.[0] ?? 20),
                              format: (n) => n.toString(),
                              transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[0] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title={`Center island width (${unitLabel})`}
                          />
                          <input
                            type="number"
                            step="1"
                            min="-9999"
                            {...buildNumberField({
                              editKey: 'sectionWidth1',
                              getValue: () => toDisplay(selectedShape.sectionWidths?.[1] ?? 0),
                              format: (n) => n.toString(),
                              commitValue: (n) => {
                                if (!selectedShape) return;
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[1] = fromDisplay(n);
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              },
                            })}
                            style={{ width: '100%' }}
                            title={`Offset of center island from center (${unitLabel}). Positive shifts right.`}
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                      </div>

                      <div className="field">
                        <label>Section Rotation (deg)</label>
                        <input
                          type="number"
                          step="1"
                          {...buildNumberField({
                            editKey: 'sectionRotation',
                            getValue: () => selectedShape.sectionRotation ?? 0,
                            format: (n) => n.toFixed(1),
                            transform: (n) => Math.round(n * 10) / 10,
                            commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { sectionRotation: n }); },
                          })}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : selectedShape.type === "text" ? null : (
            <>
              {(selectedShape.type === "rect" || selectedShape.type === "oval") && (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>{`Width (${unitLabel})`}</label>
                      <input
                        type="number"
                        step={useInches ? 0.05 : 0.1}
                        {...buildNumberField({
                          editKey: 'width',
                          getValue: () => toDisplay(selectedShape.widthMM ?? 0),
                          format: (n) => formatDisplay(n, 1),
                          transform: (n) => Math.max(0, roundToStep(n, useInches ? 0.05 : 0.1)),
                          commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { widthMM: fromDisplay(n) }); },
                        })}
                      />
                    </div>

                    <div className="field" style={{ flex: 1 }}>
                      <label>{`Height (${unitLabel})`}</label>
                      <input
                        type="number"
                        step={useInches ? 0.05 : 0.1}
                        {...buildNumberField({
                          editKey: 'height',
                          getValue: () => toDisplay(selectedShape.heightMM ?? 0),
                          format: (n) => formatDisplay(n, 1),
                          transform: (n) => Math.max(0, roundToStep(n, useInches ? 0.05 : 0.1)),
                          commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { heightMM: fromDisplay(n) }); },
                        })}
                      />
                    </div>
                  </div>
                </>
              )}

              {selectedShape.type === "rect" && (
                <div className="field">
                  <label>Scoop</label>
                  <select
                    value={(selectedShape as ToolShape).scoop ?? "none"}
                    onChange={(e) =>
                      updateShape(selectedShape.id, {
                        scoop: e.target.value as ScoopType,
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="shallow">Shallow</option>
                    <option value="deep">Deep</option>
                  </select>
                </div>
              )}

              { /* radius removed: oval uses width/height only */ }
              <div className="field">
                <label>Rotate (deg)</label>
                <input
                  type="number"
                  step="1"
                  {...buildNumberField({
                    editKey: 'rotate',
                    getValue: () => selectedShape.rotateDeg ?? 0,
                    format: (n) => n.toFixed(1),
                    transform: (n) => Math.round(n),
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { rotateDeg: n }); },
                  })}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>{`Depth (${unitLabel})`}</label>
                <input
                  type="number"
                  step="0.1"
                  {...buildNumberField({
                    editKey: 'depth',
                    getValue: () => toDisplay(selectedShape.depthMM ?? 0.6),
                    format: (n) => formatDisplay(n, 1),
                    transform: (n) => Math.round(n * 10) / 10,
                    commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { depthMM: fromDisplay(n) }); },
                  })}
                  style={{ width: "100%" }}
                  disabled={(selectedShape.cutType ?? "Cut") === "Blocker" || (selectedShape.splitToSections ?? false)}
                />
              </div>

              {/* Split to Sections - only for Cut type shapes */}
              {(selectedShape.cutType ?? "Cut") === "Cut" && (
                <>
                  <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      id="splitToSections"
                      checked={selectedShape.splitToSections ?? false}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        // Initialize default section values when enabling
                        if (enabled) {
                          const depth = selectedShape.depthMM ?? 15;
                          updateShape(selectedShape.id, {
                            splitToSections: true,
                            sectionDepths: [depth, Math.round(depth * 0.67), Math.round(depth * 0.33)],
                            sectionWidths: [20, 0],
                            sectionRotation: 0,
                          });
                        } else {
                          updateShape(selectedShape.id, { splitToSections: false });
                        }
                      }}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <label htmlFor="splitToSections" style={{ marginBottom: 0 }}>Split to Sections</label>
                  </div>

                  {selectedShape.splitToSections && (
                    <>
                      <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                        <div className="field">
                          <label>{`Section Depths (${unitLabel})`}</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              {...buildNumberField({
                                editKey: 'sectionDepth0',
                                getValue: () => toDisplay(selectedShape.sectionDepths?.[0] ?? 20),
                                format: (n) => n.toString(),
                                transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                                commitValue: (n) => {
                                  if (!selectedShape) return;
                                  const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                  depths[0] = fromDisplay(n);
                                  updateShape(selectedShape.id, { sectionDepths: depths });
                                },
                              })}
                              style={{ width: '100%' }}
                              title="Depth 1 (innermost)"
                            />
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              {...buildNumberField({
                                editKey: 'sectionDepth1',
                                getValue: () => toDisplay(selectedShape.sectionDepths?.[1] ?? 15),
                                format: (n) => n.toString(),
                                transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                                commitValue: (n) => {
                                  if (!selectedShape) return;
                                  const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                  depths[1] = fromDisplay(n);
                                  updateShape(selectedShape.id, { sectionDepths: depths });
                                },
                              })}
                              style={{ width: '100%' }}
                              title="Depth 2 (middle)"
                            />
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              {...buildNumberField({
                                editKey: 'sectionDepth2',
                                getValue: () => toDisplay(selectedShape.sectionDepths?.[2] ?? 10),
                                format: (n) => n.toString(),
                                transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                                commitValue: (n) => {
                                  if (!selectedShape) return;
                                  const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                  depths[2] = fromDisplay(n);
                                  updateShape(selectedShape.id, { sectionDepths: depths });
                                },
                              })}
                              style={{ width: '100%' }}
                              title="Depth 3 (outermost)"
                            />
                          </div>
                          <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                        </div>

                        <div className="field">
                          <label>{`Center Island / Offset (${unitLabel})`}</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              {...buildNumberField({
                                editKey: 'sectionWidth0',
                                getValue: () => toDisplay(selectedShape.sectionWidths?.[0] ?? 20),
                                format: (n) => n.toString(),
                                transform: (n) => Math.max(0, Math.round(n * 10) / 10),
                                commitValue: (n) => {
                                  if (!selectedShape) return;
                                  const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                  widths[0] = fromDisplay(n);
                                  updateShape(selectedShape.id, { sectionWidths: widths });
                                },
                              })}
                              style={{ width: '100%' }}
                              title={`Center island width (${unitLabel})`}
                            />
                            <input
                              type="number"
                              step="1"
                              min="-9999"
                              {...buildNumberField({
                                editKey: 'sectionWidth1',
                                getValue: () => toDisplay(selectedShape.sectionWidths?.[1] ?? 0),
                                format: (n) => n.toString(),
                                commitValue: (n) => {
                                  if (!selectedShape) return;
                                  const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                  widths[1] = fromDisplay(n);
                                  updateShape(selectedShape.id, { sectionWidths: widths });
                                },
                              })}
                              style={{ width: '100%' }}
                              title={`Offset of center island from center (${unitLabel}). Positive shifts right.`}
                            />
                          </div>
                          <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                        </div>

                        <div className="field">
                          <label>Section Rotation (deg)</label>
                          <input
                            type="number"
                            step="1"
                            {...buildNumberField({
                              editKey: 'sectionRotation',
                              getValue: () => selectedShape.sectionRotation ?? 0,
                              format: (n) => n.toFixed(1),
                              transform: (n) => Math.round(n * 10) / 10,
                              commitValue: (n) => { if (selectedShape) updateShape(selectedShape.id, { sectionRotation: n }); },
                            })}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          <div
            style={{
              paddingTop: 12,
              borderTop: "1px solid rgba(255,255,255,0.04)",
              marginTop: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="action-text-button"
                onClick={() => {
                  if (!selectedShape) return;
                  // If the shape has vectorized paths, reflect them across the
                  // shape-local bounding-box center so the visual geometry is
                  // actually mirrored (not just translated). Otherwise fall
                  // back to mirroring by moving the shape center across board X.
                  const sp: any = selectedShape as any;
                  if (sp.dxfPaths && Array.isArray(sp.dxfPaths) && sp.dxfPaths.length) {
                    // Collect all points to compute local bbox
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const path of sp.dxfPaths) {
                      if (!path) continue;
                      for (const p of path) {
                        const px = Number(p.x || 0);
                        const py = Number(p.y || 0);
                        if (px < minX) minX = px;
                        if (px > maxX) maxX = px;
                        if (py < minY) minY = py;
                        if (py > maxY) maxY = py;
                      }
                    }
                    if (!isFinite(minX)) return;
                    const cx = (minX + maxX) / 2;
                    // Reflect each point across cx
                    const newPaths = sp.dxfPaths.map((path: any[]) => {
                      if (!path) return path;
                      return path.map((p: any) => ({ x: Math.round((2 * cx - Number(p.x || 0)) * 10) / 10, y: Math.round(Number(p.y || 0) * 10) / 10 }));
                    });
                    updateShape(selectedShape.id, { dxfPaths: newPaths });
                    return;
                  }

                  // Fallback: mirror by moving the shape center across board center X
                  const centerX = (board.gridX * (board.cellSizeMM ?? 42)) / 2;
                  const newX = Math.round((2 * centerX - (selectedShape.x ?? 0)) * 10) / 10;
                  updateShape(selectedShape.id, { x: newX });
                }}
                title="Mirror selected shape across the board vertical (X) axis"
              >
                Mirror X
              </button>
              <button
                className="action-text-button"
                onClick={() => {
                  if (!selectedShape) return;
                  const sp: any = selectedShape as any;
                  if (sp.dxfPaths && Array.isArray(sp.dxfPaths) && sp.dxfPaths.length) {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const path of sp.dxfPaths) {
                      if (!path) continue;
                      for (const p of path) {
                        const px = Number(p.x || 0);
                        const py = Number(p.y || 0);
                        if (px < minX) minX = px;
                        if (px > maxX) maxX = px;
                        if (py < minY) minY = py;
                        if (py > maxY) maxY = py;
                      }
                    }
                    if (!isFinite(minY)) return;
                    const cy = (minY + maxY) / 2;
                    const newPaths = sp.dxfPaths.map((path: any[]) => {
                      if (!path) return path;
                      return path.map((p: any) => ({ x: Math.round(Number(p.x || 0) * 10) / 10, y: Math.round((2 * cy - Number(p.y || 0)) * 10) / 10 }));
                    });
                    updateShape(selectedShape.id, { dxfPaths: newPaths });
                    return;
                  }

                  // Fallback: mirror by moving the shape center across board center Y
                  const centerY = (board.gridY * (board.cellSizeMM ?? 42)) / 2;
                  const newY = Math.round((2 * centerY - (selectedShape.y ?? 0)) * 10) / 10;
                  updateShape(selectedShape.id, { y: newY });
                }}
                title="Mirror selected shape across the board horizontal (Y) axis"
              >
                Mirror Y
              </button>
            </div>
            <button
              className="delete-shape-button"
              onClick={() => selectedShape && deleteShape(selectedShape.id)}
              style={{
                background: "#880000",
                color: "white",
                border: "none",
                padding: "8px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Delete Shape
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
