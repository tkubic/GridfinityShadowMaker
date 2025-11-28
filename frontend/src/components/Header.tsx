import { useState, useEffect, useRef } from "react";

type TabKey = "trace" | "canvas" | "render";

type Props = {
  projectName: string;
  onRename: (name: string) => void;
  onSave: () => void;
  onLoadClick: () => void;
  activeTab: TabKey;
  setActiveTab: (t: TabKey) => void;
};

export default function Header({ projectName, onRename, onSave, onLoadClick, activeTab, setActiveTab }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Initialize draft from prop; when editing starts we set it explicitly.

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

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
          {!isEditing ? (
            <div
              onDoubleClick={() => { setDraft(projectName); setIsEditing(true); }}
              title="Double-click to rename project"
              style={{
                cursor: "text",
                fontWeight: 600,
                display: "inline-block",
                background: "#fff",
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid #000",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "60vw",
                minWidth: 200,
                boxSizing: "border-box",
              }}
            >
              {projectName}
            </div>
          ) : (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onRename(draft);
                setIsEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(draft);
                  setIsEditing(false);
                }
                if (e.key === "Escape") setIsEditing(false);
              }}
              style={{ width: "auto", maxWidth: "60vw", minWidth: 200, padding: "4px 6px", border: "1px solid #000", borderRadius: 4, whiteSpace: "nowrap", boxSizing: "border-box" }}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
        <button onClick={onSave} style={{ padding: "6px 8px" }}>Save</button>
        <button onClick={onLoadClick} style={{ padding: "6px 8px" }}>Load</button>
      </div>
    </header>
  );
}
