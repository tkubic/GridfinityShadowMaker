import React from "react";
import type { ToolShape } from "../types";

type TabKey = "trace" | "canvas" | "render";

type Props = {
  activeTab: TabKey;
  shapes: ToolShape[];
  selectedItem: "board" | string;
  selectItem: (id: "board" | string) => void;
  addDefaultShape: () => void;
  addTextShape: () => void;
  dxfInputRef: React.RefObject<HTMLInputElement | null>;
  handleDxfFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // trace-specific handlers
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCaptureImage?: () => void;
};

export default function LeftPanel({
  activeTab,
  shapes,
  selectedItem,
  selectItem,
  addDefaultShape,
  addTextShape,
  dxfInputRef,
  handleDxfFile,
  imageInputRef,
  handleImageFile,
  onCaptureImage,
}: Props) {
  if (activeTab === "trace") {
    return (
      <aside className="panel panel-left">
        <h2 className="section-header">Trace</h2>
        <div style={{ padding: "0 1rem 1rem" }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
            <button
              onClick={() => imageInputRef.current?.click()}
              className="action-text-button"
              style={{ width: '100%', fontSize: '1.05rem' }}
            >
              Load Image
            </button>
            <button
              onClick={() => onCaptureImage?.()}
              className="action-text-button"
              style={{ width: '100%', fontSize: '1.05rem' }}
            >
              Capture Image
            </button>
          </div>
          <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageFile} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel panel-left">
      <h2 className="section-header">BOARD</h2>
      <ul className="tool-list">
        <li
          className={"tool-list-item" + (selectedItem === "board" ? " selected" : "")}
          onClick={() => selectItem("board")}
        >
          Board Size
        </li>
      </ul>

      <hr />

      <h2 className="section-header">SHAPES</h2>
      <ul className="tool-list">
        {shapes.map((shape) => (
          <li
            key={shape.id}
            className={"tool-list-item" + (selectedItem === shape.id ? " selected" : "")}
            onClick={() => selectItem(shape.id)}
          >
            {shape.name}
          </li>
        ))}
      </ul>

      <div style={{ padding: "0 1rem 1rem" }}>
        <button onClick={addDefaultShape} className="add-item-button">
          + Shape
        </button>
        <button onClick={() => dxfInputRef.current?.click()} style={{ marginLeft: 8 }} className="import-dxf-button">
          + Import DXF
        </button>
        <button onClick={addTextShape} style={{ marginLeft: 8 }} className="add-text-button">
          + Text
        </button>
        <input ref={dxfInputRef} type="file" accept=".dxf" multiple style={{ display: "none" }} onChange={handleDxfFile} />
      </div>
    </aside>
  );
}
