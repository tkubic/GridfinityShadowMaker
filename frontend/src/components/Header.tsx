import { useState, useEffect, useRef } from "react";

type TabKey = "trace" | "canvas" | "render";

type Props = {
  projectName: string;
  onRename: (name: string) => void;
  onSave: () => void;
  onLoadClick: () => void;
  activeTab: TabKey;
  setActiveTab: (t: TabKey) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export default function Header({ projectName, onRename, onSave, onLoadClick, activeTab, setActiveTab, onUndo, onRedo, canUndo, canRedo }: Props) {
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep draft synchronized with external projectName changes
  useEffect(() => {
    setDraft(projectName);
  }, [projectName]);

  return (
    <header className="app-header">
      <div style={{ flex: 1 }}>
        <div className="app-title">Gridfinity Shadow Maker V2.0</div>
      </div>

      <div style={{ flex: "0 1 auto", display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
        <nav style={{ display: "flex", gap: 8 }} aria-label="Top tabs">
          <button className={"tab-btn" + (activeTab === "trace" ? " active" : "")} onClick={() => setActiveTab("trace")}>Trace Object</button>
          <button className={"tab-btn" + (activeTab === "canvas" ? " active" : "")} onClick={() => setActiveTab("canvas")}>2D Canvas</button>
          <button className={"tab-btn" + (activeTab === "render" ? " active" : "")} onClick={() => setActiveTab("render")}>3D Viewer</button>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
          <div style={{ fontSize: 12, color: "#333" }}>Project Name</div>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== projectName) onRename(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (draft !== projectName) onRename(draft);
                inputRef.current?.blur();
              }
            }}
            style={{ width: "auto", maxWidth: "60vw", minWidth: 200, padding: "6px 8px", border: "1px solid #000", borderRadius: 4, whiteSpace: "nowrap", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
            <button
              onClick={onUndo}
              disabled={activeTab !== "canvas" || !canUndo}
              title="Undo (Ctrl+Z)"
              style={{ padding: "6px 8px" }}
            >
              Undo
            </button>
            <button
              onClick={onRedo}
              disabled={activeTab !== "canvas" || !canRedo}
              title="Redo (Ctrl+Y)"
              style={{ padding: "6px 8px" }}
            >
              Redo
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
        <button onClick={onSave} style={{ padding: "6px 8px" }}>Save</button>
        <button onClick={onLoadClick} style={{ padding: "6px 8px" }}>Load</button>
      </div>
    </header>
  );
}
