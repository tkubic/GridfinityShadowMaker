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
      const editor = (editorControls && editorControls.getState) ? editorControls : (window as any).__editorControls || null;
      const brushSize = editor?.getState?.().brushSize ?? 28;
      const currentColor = editor?.getState?.().color ?? '#000000';
      return (
        <aside className="panel panel-right">
          <h2>Photo Editor</h2>
          <div className="field">
            <label>Brush Size</label>
            <input type="range" min={4} max={200} value={brushSize} onChange={(e) => editor?.setBrushSize?.(Number(e.target.value))} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <div onClick={() => { editor?.setColor?.('#000000'); editor?.setMode?.('brush'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ width: Math.max(10, Math.round(brushSize * 0.4)), height: Math.max(10, Math.round(brushSize * 0.4)), background: '#000', borderRadius: '50%', border: currentColor === '#000000' ? '2px solid #0074D9' : undefined }} />
                <small>Black</small>
              </div>
              <div onClick={() => { editor?.setColor?.('#ffffff'); editor?.setMode?.('brush'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ width: Math.max(10, Math.round(brushSize * 0.4)), height: Math.max(10, Math.round(brushSize * 0.4)), background: '#fff', borderRadius: '50%', border: currentColor === '#ffffff' ? '2px solid #0074D9' : '1px solid #000' }} />
                <small>White</small>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action-text-button" onClick={() => editor?.setMode?.('select')} title="Select" aria-label="Select">
              <div style={{ width: 20, height: 14, boxSizing: 'border-box', border: '2px dashed #000', display: 'inline-block' }} />
            </button>
            <button className="action-text-button" onClick={() => editor?.applyCrop?.()} title="Crop" aria-label="Crop">
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
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="action-text-button" onClick={() => editor?.save?.()}>Save</button>
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
              <label>Width (units)</label>
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
              <label>Depth (units)</label>
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
              <label>Height (7mm units)</label>
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
                <label>Chamfer Height (mm)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={board.chamferHeight ?? 2}
                  onChange={(e) => updateBoard({ chamferHeight: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
              </div>
            )}
            <small>1 unit = {board.cellSizeMM} mm</small>
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
                <label>Font size (mm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editFields.fontSize !== undefined ? editFields.fontSize : ((selectedShape.fontSizeMM ?? 15)).toFixed(1)}
                  onFocus={() => {
                    setFocusedField('fontSize');
                    if (editFields.fontSize === undefined) setEditFields({ ...editFields, fontSize: ((selectedShape.fontSizeMM ?? 15)).toFixed(1) });
                  }}
                  onChange={(e) => setEditFields({ ...editFields, fontSize: e.target.value })}
                  onBlur={() => { setFocusedField(null); commitEditField("fontSize"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("fontSize"); (e.target as HTMLInputElement).blur(); } }}
                />
              </div>

              <div className="field">
                <label>Depth (mm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editFields.depth !== undefined ? editFields.depth : ((selectedShape.depthMM ?? 0.6)).toFixed(1)}
                  onFocus={() => {
                    setFocusedField('depth');
                    if (editFields.depth === undefined) setEditFields({ ...editFields, depth: ((selectedShape.depthMM ?? 0.6)).toFixed(1) });
                  }}
                  onChange={(e) => setEditFields({ ...editFields, depth: e.target.value })}
                  onBlur={() => { setFocusedField(null); commitEditField("depth"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("depth"); (e.target as HTMLInputElement).blur(); } }}
                  style={{ width: "100%" }}
                  disabled={(selectedShape.cutType ?? "Cut") === "Blocker"}
                />
              </div>
              <div className="field">
                <label>Rotate (deg)</label>
                <input
                  type="number"
                  step="1"
                  value={editFields.rotate !== undefined ? editFields.rotate : ((selectedShape.rotateDeg ?? 0)).toFixed(1)}
                  onFocus={() => {
                    if (editFields.rotate === undefined) setEditFields({ ...editFields, rotate: ((selectedShape.rotateDeg ?? 0)).toFixed(1) });
                  }}
                  onChange={(e) => setEditFields({ ...editFields, rotate: e.target.value })}
                  onBlur={() => commitEditField("rotate")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("rotate"); }}
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
                        <label>Section Depths (mm)</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[0] ?? 20}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 1 (innermost)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[1] ?? 15}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[1] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 2 (middle)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[2] ?? 10}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[2] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 3 (outermost)"
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                      </div>

                      <div className="field">
                        <label>Center Island / Offset (mm)</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={selectedShape.sectionWidths?.[0] ?? 20}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                              widths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionWidths: widths });
                            }}
                            style={{ width: '100%' }}
                            title="Center island width (mm)"
                          />
                          <input
                            type="number"
                            step="1"
                            min="-9999"
                            value={selectedShape.sectionWidths?.[1] ?? 0}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                              widths[1] = parseFloat(e.target.value) || 0;
                              updateShape(selectedShape.id, { sectionWidths: widths });
                            }}
                            style={{ width: '100%' }}
                            title="Offset of center island from center (mm). Positive shifts right."
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                      </div>

                      <div className="field">
                        <label>Section Rotation (deg)</label>
                        <input
                          type="number"
                          step="1"
                          value={selectedShape.sectionRotation ?? 0}
                          onChange={(e) => updateShape(selectedShape.id, { sectionRotation: parseFloat(e.target.value) || 0 })}
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
              <label>X (mm)</label>
              <input
                type="number"
                step="0.1"
                value={editFields.x ?? (selectedShape.x ?? 0).toFixed(1)}
                onChange={(e) => setEditFields({ ...editFields, x: e.target.value })}
                onFocus={() => {
                  setFocusedField('x');
                  if (editFields.x === undefined) setEditFields({ ...editFields, x: (selectedShape.x ?? 0).toFixed(1) });
                }}
                style={{ width: "100%" }}
                onBlur={() => { setFocusedField(null); commitEditField("x"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("x"); (e.target as HTMLInputElement).blur(); } }}
              />
            </div>

            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>Y (mm)</label>
              <input
                type="number"
                step="0.1"
                value={editFields.y ?? (selectedShape.y ?? 0).toFixed(1)}
                onChange={(e) => setEditFields({ ...editFields, y: e.target.value })}
                onFocus={() => {
                  setFocusedField('y');
                  if (editFields.y === undefined) setEditFields({ ...editFields, y: (selectedShape.y ?? 0).toFixed(1) });
                }}
                style={{ width: "100%" }}
                onBlur={() => { setFocusedField(null); commitEditField("y"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("y"); (e.target as HTMLInputElement).blur(); } }}
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
                      value={editFields.rotate ?? ((selectedShape.rotateDeg ?? 0)).toFixed(1)}
                      onChange={(e) => setEditFields({ ...editFields, rotate: e.target.value })}
                      onFocus={() => {
                        setFocusedField('rotate');
                        if (editFields.rotate === undefined) setEditFields({ ...editFields, rotate: (selectedShape.rotateDeg ?? 0).toFixed(1) });
                      }}
                      onBlur={() => { setFocusedField(null); commitEditField("rotate"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("rotate"); (e.target as HTMLInputElement).blur(); } }}
                      style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>Scale</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                      value={editFields.scale ?? ((selectedShape.scale ?? 1)).toFixed(1)}
                      onChange={(e) => setEditFields({ ...editFields, scale: e.target.value })}
                      onFocus={() => {
                        setFocusedField('scale');
                        if (editFields.scale === undefined) setEditFields({ ...editFields, scale: (selectedShape.scale ?? 1).toFixed(1) });
                      }}
                      onBlur={() => { setFocusedField(null); commitEditField("scale"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("scale"); (e.target as HTMLInputElement).blur(); } }}
                      style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>Depth (mm)</label>
                <input
                  type="number"
                  step="0.1"
                      value={editFields.depth ?? ((selectedShape.depthMM ?? 0.6)).toFixed(1)}
                      onChange={(e) => setEditFields({ ...editFields, depth: e.target.value })}
                      onFocus={() => {
                        setFocusedField('depth');
                        if (editFields.depth === undefined) setEditFields({ ...editFields, depth: (selectedShape.depthMM ?? 0.6).toFixed(1) });
                      }}
                      onBlur={() => { setFocusedField(null); commitEditField("depth"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("depth"); (e.target as HTMLInputElement).blur(); } }}
                      style={{ width: "100%" }}
                  disabled={(selectedShape.cutType ?? "Cut") === "Blocker"}
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
                        <label>Section Depths (mm)</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[0] ?? 20}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 1 (innermost)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[1] ?? 15}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[1] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 2 (middle)"
                          />
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={selectedShape.sectionDepths?.[2] ?? 10}
                            onChange={(e) => {
                              const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                              depths[2] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionDepths: depths });
                            }}
                            style={{ width: '100%' }}
                            title="Depth 3 (outermost)"
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                      </div>

                      <div className="field">
                        <label>Center Island / Offset (mm)</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={selectedShape.sectionWidths?.[0] ?? 20}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                              widths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                              updateShape(selectedShape.id, { sectionWidths: widths });
                            }}
                            style={{ width: '100%' }}
                            title="Center island width (mm)"
                          />
                          <input
                            type="number"
                            step="1"
                            min="-9999"
                            value={selectedShape.sectionWidths?.[1] ?? 0}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                              widths[1] = parseFloat(e.target.value) || 0;
                              updateShape(selectedShape.id, { sectionWidths: widths });
                            }}
                            style={{ width: '100%' }}
                            title="Offset of center island from center (mm). Positive shifts right."
                          />
                        </div>
                        <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                      </div>

                      <div className="field">
                        <label>Section Rotation (deg)</label>
                        <input
                          type="number"
                          step="1"
                          value={selectedShape.sectionRotation ?? 0}
                          onChange={(e) => updateShape(selectedShape.id, { sectionRotation: parseFloat(e.target.value) || 0 })}
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
                      <label>Width (mm)</label>
                      <input
                        type="number"
                        value={editFields.width ?? (selectedShape.widthMM ?? 0).toString()}
                        onChange={(e) => setEditFields({ ...editFields, width: e.target.value })}
                        onFocus={() => {
                          setFocusedField('width');
                          if (editFields.width === undefined) setEditFields({ ...editFields, width: (selectedShape.widthMM ?? 0).toString() });
                        }}
                        onBlur={() => { setFocusedField(null); commitEditField("width"); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("width"); (e.target as HTMLInputElement).blur(); } }}
                      />
                    </div>

                    <div className="field" style={{ flex: 1 }}>
                      <label>Height (mm)</label>
                      <input
                        type="number"
                        value={editFields.height ?? (selectedShape.heightMM ?? 0).toString()}
                        onChange={(e) => setEditFields({ ...editFields, height: e.target.value })}
                        onFocus={() => {
                          setFocusedField('height');
                          if (editFields.height === undefined) setEditFields({ ...editFields, height: (selectedShape.heightMM ?? 0).toString() });
                        }}
                        onBlur={() => { setFocusedField(null); commitEditField("height"); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("height"); (e.target as HTMLInputElement).blur(); } }}
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
                  value={editFields.rotate ?? ((selectedShape.rotateDeg ?? 0)).toFixed(1)}
                  onChange={(e) => setEditFields({ ...editFields, rotate: e.target.value })}
                  onFocus={() => {
                    setFocusedField('rotate');
                    if (editFields.rotate === undefined) setEditFields({ ...editFields, rotate: ((selectedShape.rotateDeg ?? 0)).toFixed(1) });
                  }}
                  onBlur={() => { setFocusedField(null); commitEditField("rotate"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitEditField("rotate"); (e.target as HTMLInputElement).blur(); } }}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label>Depth (mm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editFields.depth ?? ((selectedShape.depthMM ?? 0.6)).toFixed(1)}
                  onChange={(e) => setEditFields({ ...editFields, depth: e.target.value })}
                  onBlur={() => commitEditField("depth")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("depth"); }}
                  style={{ width: "100%" }}
                  disabled={(selectedShape.cutType ?? "Cut") === "Blocker"}
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
                          <label>Section Depths (mm)</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={selectedShape.sectionDepths?.[0] ?? 20}
                              onChange={(e) => {
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              }}
                              style={{ width: '100%' }}
                              title="Depth 1 (innermost)"
                            />
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={selectedShape.sectionDepths?.[1] ?? 15}
                              onChange={(e) => {
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[1] = Math.max(0, parseFloat(e.target.value) || 0);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              }}
                              style={{ width: '100%' }}
                              title="Depth 2 (middle)"
                            />
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={selectedShape.sectionDepths?.[2] ?? 10}
                              onChange={(e) => {
                                const depths = [...(selectedShape.sectionDepths ?? [20, 15, 10])] as [number, number, number];
                                depths[2] = Math.max(0, parseFloat(e.target.value) || 0);
                                updateShape(selectedShape.id, { sectionDepths: depths });
                              }}
                              style={{ width: '100%' }}
                              title="Depth 3 (outermost)"
                            />
                          </div>
                          <small style={{ color: '#888', fontSize: '0.75rem' }}>Inner → Outer</small>
                        </div>

                        <div className="field">
                          <label>Center Island / Offset (mm)</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              value={selectedShape.sectionWidths?.[0] ?? 20}
                              onChange={(e) => {
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[0] = Math.max(0, parseFloat(e.target.value) || 0);
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              }}
                              style={{ width: '100%' }}
                              title="Center island width (mm)"
                            />
                            <input
                              type="number"
                              step="1"
                              min="-9999"
                              value={selectedShape.sectionWidths?.[1] ?? 0}
                              onChange={(e) => {
                                const widths = [...(selectedShape.sectionWidths ?? [20, 0])] as [number, number];
                                widths[1] = parseFloat(e.target.value) || 0;
                                updateShape(selectedShape.id, { sectionWidths: widths });
                              }}
                              style={{ width: '100%' }}
                              title="Offset of center island from center (mm). Positive shifts right."
                            />
                          </div>
                          <small style={{ color: '#888', fontSize: '0.75rem' }}>Center island width, then offset from center</small>
                        </div>

                        <div className="field">
                          <label>Section Rotation (deg)</label>
                          <input
                            type="number"
                            step="1"
                            value={selectedShape.sectionRotation ?? 0}
                            onChange={(e) => updateShape(selectedShape.id, { sectionRotation: parseFloat(e.target.value) || 0 })}
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
