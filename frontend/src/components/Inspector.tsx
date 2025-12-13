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
  updateShape: (id: string, partial: Partial<ToolShape>) => void;
  updateBoard: (partial: Partial<BoardConfig>) => void;
  deleteShape: (id: string) => void;
  textInputRef: React.RefObject<HTMLInputElement | null>;
  activeTab?: "trace" | "canvas" | "render";
  processImageAgain?: (params: { threshold?: number; offset?: number; token?: number; resolution?: number }) => void;
  traceParams?: { threshold: number; offset: number; token: number; resolution: number };
  setTraceParams?: (p: { threshold: number; offset: number; token: number; resolution: number }) => void;
  transferPolylines?: () => void;
  hasPendingPolylines?: boolean;
  // Actions handed down from App
  exportDxfs?: () => void;
  generateScad?: () => void;
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
  // If we're in trace tab, show trace-specific controls in the inspector
  if (activeTab === "trace") {
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
                      updateShape(selectedShape.id, { text: editFields.text ?? selectedShape.text ?? selectedShape.name });
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
                  value={editFields.fontSize ?? ((selectedShape.fontSizeMM ?? 15)).toFixed(1)}
                  onChange={(e) => setEditFields({ ...editFields, fontSize: e.target.value })}
                  onBlur={() => commitEditField("fontSize")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("fontSize"); }}
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
              <div className="field">
                <label>Rotate (deg)</label>
                <input
                  type="number"
                  step="1"
                  value={editFields.rotate ?? ((selectedShape.rotateDeg ?? 0)).toFixed(1)}
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
                            sectionWidths: [40, 20],
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
                            value={selectedShape.sectionWidths?.[0] ?? 40}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
                            value={selectedShape.sectionWidths?.[1] ?? 20}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
                style={{ width: "100%" }}
                onBlur={() => commitEditField("x")}
                onKeyDown={(e) => { if (e.key === "Enter") commitEditField("x"); }}
              />
            </div>

            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>Y (mm)</label>
              <input
                type="number"
                step="0.1"
                value={editFields.y ?? (selectedShape.y ?? 0).toFixed(1)}
                onChange={(e) => setEditFields({ ...editFields, y: e.target.value })}
                style={{ width: "100%" }}
                onBlur={() => commitEditField("y")}
                onKeyDown={(e) => { if (e.key === "Enter") commitEditField("y"); }}
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
                  onBlur={() => commitEditField("rotate")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("rotate"); }}
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
                  onBlur={() => commitEditField("scale")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("scale"); }}
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
                            sectionWidths: [40, 20],
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
                            value={selectedShape.sectionWidths?.[0] ?? 40}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
                            value={selectedShape.sectionWidths?.[1] ?? 20}
                            onChange={(e) => {
                              const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
                        onBlur={() => commitEditField("width")}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEditField("width"); }}
                      />
                    </div>

                    <div className="field" style={{ flex: 1 }}>
                      <label>Height (mm)</label>
                      <input
                        type="number"
                        value={editFields.height ?? (selectedShape.heightMM ?? 0).toString()}
                        onChange={(e) => setEditFields({ ...editFields, height: e.target.value })}
                        onBlur={() => commitEditField("height")}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEditField("height"); }}
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
                  onBlur={() => commitEditField("rotate")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEditField("rotate"); }}
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
                            sectionWidths: [40, 20],
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
                              value={selectedShape.sectionWidths?.[0] ?? 40}
                              onChange={(e) => {
                                const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
                              value={selectedShape.sectionWidths?.[1] ?? 20}
                              onChange={(e) => {
                                const widths = [...(selectedShape.sectionWidths ?? [40, 20])] as [number, number];
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
