// Lightweight DXF parser used by the app.
// Parses LWPOLYLINE, POLYLINE+VERTEX, and CIRCLE entities into arrays of points.
export function parseDxf(content: string): Array<Array<{ x: number; y: number }>> | null {
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map((l) => l.trim());

  const isNumber = (s: string) => {
    if (!s) return false;
    return !Number.isNaN(Number(s));
  };

  try {
    const paths: Array<Array<{ x: number; y: number }>> = [];
    const n = lines.length;

    for (let i = 0; i < n - 1; i++) {
      if (lines[i] !== "0") continue;
      const type = lines[i + 1];

      // --- LWPOLYLINE ---
      if (type === "LWPOLYLINE") {
        let j = i + 2;
        const verts: Array<{ x: number; y: number }> = [];

        while (j < n - 1) {
          const code = lines[j];
          const valNext = lines[j + 1];

          // Break if we hit start of a new entity: "0" followed by NON-numeric
          if (code === "0" && !isNumber(valNext)) break;

          if (code === "10") {
            const x = parseFloat(valNext);
            let k = j + 2;
            let y: number | null = null;

            // Look for 20 (Y) before we hit 10 (next vertex) or a new entity
            while (k < n - 1) {
              const c2 = lines[k];
              const v2 = lines[k + 1];

              if (c2 === "0" && !isNumber(v2)) break;
              if (c2 === "10") break; // next vertex
              if (c2 === "20") {
                y = parseFloat(v2);
                k += 2;
                break;
              }
              k += 2;
            }

            verts.push({ x, y: y ?? 0 });
            j = k;
            continue;
          }

          j += 2;
        }

        if (verts.length >= 3) {
          paths.push(verts);
        }
      }

      // --- POLYLINE + VERTEX (simplified) ---
      if (type === "POLYLINE") {
        let j = i + 2;
        const verts: Array<{ x: number; y: number }> = [];
        while (j < n - 1) {
          const code = lines[j];
          const valNext = lines[j + 1];

          if (code === "0" && !isNumber(valNext)) {
            // new entity or SEQEND
            if (valNext === "SEQEND") {
              j += 2;
              break;
            }
            break;
          }

          if (code === "0" && valNext === "VERTEX") {
            // parse vertex
            let k = j + 2;
            let vx = 0,
              vy = 0;
            while (k < n - 1) {
              const c2 = lines[k];
              const v2 = lines[k + 1];

              if (c2 === "0" && !isNumber(v2)) break;
              if (c2 === "10") vx = parseFloat(v2);
              if (c2 === "20") vy = parseFloat(v2);
              k += 2;
            }
            verts.push({ x: vx, y: vy });
            j = k;
            continue;
          }

          j += 2;
        }

        if (verts.length >= 3) {
          paths.push(verts);
        }
      }

      // --- CIRCLE (approximate as polyline) ---
      if (type === "CIRCLE") {
        let j = i + 2;
        let cx = 0,
          cy = 0,
          r = 0;
        while (j < n - 1) {
          const code = lines[j];
          const valNext = lines[j + 1];
          if (code === "0" && !isNumber(valNext)) break;
          if (code === "10") cx = parseFloat(valNext);
          if (code === "20") cy = parseFloat(valNext);
          if (code === "40") r = parseFloat(valNext);
          j += 2;
        }
        if (r > 0) {
          const segs = 64;
          const pts: Array<{ x: number; y: number }> = [];
          for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            pts.push({
              x: cx + Math.cos(a) * r,
              y: cy + Math.sin(a) * r,
            });
          }
          paths.push(pts);
        }
      }
    }

    return paths.length ? paths : null;
  } catch (err) {
    return null;
  }
}
