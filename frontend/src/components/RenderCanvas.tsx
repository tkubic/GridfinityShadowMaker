import React from "react";

export default function RenderCanvas() {
  return (
    <div style={{ padding: 24, height: "100%", boxSizing: "border-box" }}>
      <h3>3D Render / Export</h3>
      <div style={{ border: "1px dashed #ccc", padding: 16, minHeight: 240, height: "calc(100% - 48px)" }}>
        Render preview will appear here.
      </div>
    </div>
  );
}
