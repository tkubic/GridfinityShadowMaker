 
type Props = {
  projectName?: string;
};

export default function RenderCanvas({ projectName }: Props) {
  async function generateScad() {
    try {
      // Attempt to call backend export-scad endpoint if available
      const res = await fetch('http://localhost:5000/export-scad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName }) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        alert('Generate SCAD request failed: ' + (txt || res.statusText));
        return;
      }
      const j = await res.json().catch(() => null);
      alert('Generate SCAD requested' + (j && j.message ? (': ' + j.message) : ''));
    } catch (e) {
      // Backend may not implement this endpoint yet; notify user
      console.warn('Generate SCAD request failed', e);
      alert('Generate SCAD: could not contact backend (no /export-scad endpoint).');
    }
  }
  return (
    <div style={{ padding: 24, height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>3D Render / Export</h3>
        <div>
          <button className="action-text-button" onClick={generateScad}>
            Generate SCAD
          </button>
        </div>
      </div>

      <div style={{ border: "1px dashed #ccc", padding: 16, minHeight: 240, height: "calc(100% - 48px)", marginTop: 12 }}>
        Render preview will appear here.
      </div>
    </div>
  );
}
