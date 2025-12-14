/*
 * textToPolylines.ts
 *
 * Convert TextShape objects into exact vector polygons using opentype.js + paper.js
 * and emit DXF polylines. No rasterization, no font-renderer fallbacks.
 *
 * Usage:
 *  - loadFont(url)
 *  - convertTextShapeToPolygons(shape, fontUrl)
 *  - polygons -> DXF via polygonsToDxf()
 *
 * Libraries required (install in frontend project):
 *  - opentype.js
 *  - paper
 *
 */

import * as opentype from "opentype.js";
// Use the lightweight paper-core build which is more bundler-friendly in browser apps
import paper from "paper/dist/paper-core";

// Public shape type (matches the user's spec)
export type TextShape = {
  id: string;
  kind: "text";
  content: string;
  fontFamily: string;
  fontStyle: "normal" | "bold" | "italic";
  heightMm: number;
  positionMm: { x: number; y: number };
  rotationDeg: number;
  align: "left" | "center" | "right";
  valign: "baseline" | "middle" | "top" | "bottom";
};

export type Point = { x: number; y: number };

// A polygon ring (closed). Orientation preserved (signed area positive/negative kept).
export type Ring = Point[];

// Polygon with outer ring and optional holes
export type PolygonWithHoles = { outer: Ring; holes: Ring[] };

// Load opentype font from URL
export async function loadFont(url: string): Promise<opentype.Font> {
  return new Promise((resolve, reject) => {
    opentype.load(url, (err, font) => {
      if (err) return reject(err);
      resolve(font!);
    });
  });
}

// Compute signed area of a ring (positive = CCW, negative = CW, depending on coordinate convention)
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Point-in-polygon: ray casting
function pointInPolygon(pt: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x,
      yi = ring[i].y;
    const xj = ring[j].x,
      yj = ring[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Convert a TextShape into polygon(s) (outer + holes) using opentype + paper
// - fontOrUrl: either an already-loaded opentype.Font or a URL to load
// - toleranceMm: flatten tolerance in millimeters (defaults to 0.1)
export async function convertTextShapeToPolygons(
  shape: TextShape,
  fontOrUrl: string | opentype.Font,
  toleranceMm = 0.1
): Promise<PolygonWithHoles[]> {
  const font: opentype.Font = typeof fontOrUrl === "string" ? await loadFont(fontOrUrl) : (fontOrUrl as opentype.Font);

  // For opentype, font coordinates are in font units (unitsPerEm). When you call
  // glyph.getPath(x, y, fontSize) the resulting coordinates are transformed by
  // (fontSize / unitsPerEm). To get final coordinates in millimeters we therefore
  // pass fontSize = desired height in millimeters (shape.heightMm). That makes
  // glyph coordinates appear directly in millimeters.
  const fontSizeMm = shape.heightMm;
  const unitsPerEm = font.unitsPerEm || 1000;

  // layout glyphs with advance widths and kerning
  const glyphs = font.stringToGlyphs(shape.content);
  const scale = fontSizeMm / unitsPerEm; // for computing advances in mm

  // compute total width in mm
  let totalWidth = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    totalWidth += (g.advanceWidth || 0) * scale;
    if (i + 1 < glyphs.length) {
      const kern = font.getKerningValue(g, glyphs[i + 1]) || 0;
      totalWidth += kern * scale;
    }
  }

  let startX = 0;
  if (shape.align === "center") startX = -totalWidth / 2;
  else if (shape.align === "right") startX = -totalWidth;

  // vertical baseline baseline/middle/top/bottom handling
  // opentype coordinates: y is baseline; font.ascender/font.descender are in font units
  const asc = (font.ascender || (unitsPerEm * 0.8)) * scale;
  const desc = (font.descender || (-(unitsPerEm * 0.2))) * scale;
  // asc is positive up, desc negative

  let baselineY = 0; // default baseline
  if (shape.valign === "middle") {
    // center of em box
    baselineY = (asc + desc) / 2;
  } else if (shape.valign === "top") {
    baselineY = asc;
  } else if (shape.valign === "bottom") {
    baselineY = desc; // desc is negative
  } else {
    baselineY = 0; // baseline
  }

  // We'll use a fresh PaperScope so we don't interfere with global paper state
  const scope = new paper.PaperScope();
  // size doesn't matter; paper requires a canvas or size for some operations.
  scope.setup(new scope.Size(100, 100));

  const allRings: Ring[] = [];

  let cursorX = startX;
  for (let gi = 0; gi < glyphs.length; gi++) {
    const glyph = glyphs[gi];

    // compute kerning with next glyph (applied to advance after this glyph)
    const kern = gi + 1 < glyphs.length ? font.getKerningValue(glyph, glyphs[gi + 1]) || 0 : 0;

    // Get path for this glyph positioned at cursorX, baselineY
    // Use fontSize in mm so path coordinates are in mm
    const path = glyph.getPath(cursorX, baselineY, fontSizeMm);

    // Build paper.js paths splitting on moveTo commands
    let current: paper.Path | null = null;
    // helper to finalize a current path into allRings
    const finalizeCurrent = (p: paper.Path | null) => {
      if (!p || p.segments.length === 0) return;
      if (!p.closed) p.closePath();
      p.flatten(toleranceMm);
      const pts: Ring = p.segments.map((s) => ({ x: s.point.x, y: -s.point.y }));
      if (pts.length >= 3) allRings.push(pts);
      try { p.remove(); } catch (e) { /* ignore */ }
    };
    for (const cmd of path.commands) {
      const type = (cmd as any).type;
      if (type === "M") {
        if (current && current.segments.length > 0) {
          // finish previous ring and push it
          finalizeCurrent(current);
        }
        current = new scope.Path();
        current.closed = false;
      } else if (!current) {
        // implicit move when glyph begins without explicit M
        current = new scope.Path();
        current.closed = false;
      }

      if (type === "L") {
        current.add(new scope.Point((cmd as any).x, (cmd as any).y));
      } else if (type === "M") {
        current.moveTo(new scope.Point((cmd as any).x, (cmd as any).y));
      } else if (type === "Q") {
        // quadratic bezier: has x1,y1 control and x,y
        current.quadraticCurveTo(new scope.Point((cmd as any).x1, (cmd as any).y1), new scope.Point((cmd as any).x, (cmd as any).y));
      } else if (type === "C") {
        // cubic bezier: x1,y1, x2,y2, x,y
        current.cubicCurveTo(
          new scope.Point((cmd as any).x1, (cmd as any).y1),
          new scope.Point((cmd as any).x2, (cmd as any).y2),
          new scope.Point((cmd as any).x, (cmd as any).y)
        );
      } else if (type === "Z") {
        if (current && !current.closed) current.closePath();
        // finalize closed contour
        finalizeCurrent(current);
        current = null;
      }
    }

    // finalize any remaining path
    finalizeCurrent(current);

    // advance cursor by glyph advance + kerning
    cursorX += (glyph.advanceWidth || 0) * scale + kern * scale;
  }

  // Now we have a flat list of rings. Classify them by containment rather than relying on winding/sign,
  // because fonts may use different winding conventions and the previous sign-based heuristic caused
  // letters like "e" to appear as only the hole being emitted.
  type TempRing = { ring: Ring; area: number; centroid: Point };
  const temp: TempRing[] = allRings.map((r) => {
    const area = signedArea(r);
    // compute centroid (simple average of vertices works for our polygons)
    const cx = r.reduce((acc, p) => acc + p.x, 0) / r.length;
    const cy = r.reduce((acc, p) => acc + p.y, 0) / r.length;
    return { ring: r, area, centroid: { x: cx, y: cy } };
  });

  // Determine which rings are outer rings: a ring that is not contained inside any other ring
  const polygons: PolygonWithHoles[] = [];
  const isContainedIn = (idxA: number, idxB: number) => {
    // returns true if ring A is inside ring B (using A's centroid)
    return pointInPolygon(temp[idxA].centroid, temp[idxB].ring);
  };

  const outerIndices: number[] = [];
  for (let i = 0; i < temp.length; i++) {
    let insideAny = false;
    for (let j = 0; j < temp.length; j++) {
      if (i === j) continue;
      if (isContainedIn(i, j)) {
        insideAny = true;
        break;
      }
    }
    if (!insideAny) outerIndices.push(i);
  }

  // Create polygon entries for each outer ring
  for (const oi of outerIndices) {
    polygons.push({ outer: temp[oi].ring.slice(), holes: [] });
  }

  // Assign other rings as holes to the smallest outer that contains them
  for (let i = 0; i < temp.length; i++) {
    if (outerIndices.includes(i)) continue; // already an outer
    const centroid = temp[i].centroid;
    let bestOuterIdx = -1;
    let bestOuterArea = Infinity;
    for (let k = 0; k < outerIndices.length; k++) {
      const oi = outerIndices[k];
      if (pointInPolygon(centroid, temp[oi].ring)) {
        const a = Math.abs(temp[oi].area) || 0;
        if (a < bestOuterArea) {
          bestOuterArea = a;
          bestOuterIdx = k; // index into polygons array
        }
      }
    }
    if (bestOuterIdx >= 0) {
      polygons[bestOuterIdx].holes.push(temp[i].ring.slice());
    } else {
      // no containing outer found — treat as its own outer (defensive)
      polygons.push({ outer: temp[i].ring.slice(), holes: [] });
    }
  }

  // Ensure winding: make outer rings CCW (positive signed area), holes CW (negative)
  for (const poly of polygons) {
    const aOuter = signedArea(poly.outer);
    if (aOuter < 0) poly.outer.reverse();
    for (let hi = 0; hi < poly.holes.length; hi++) {
      const ha = signedArea(poly.holes[hi]);
      if (ha > 0) poly.holes[hi].reverse();
    }
  }

  // apply overall transform: rotation and translation (positionMm) to all points
  const theta = (shape.rotationDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const transformPoint = (p: Point): Point => {
    // rotate around origin (0,0), then translate by shape.positionMm
    const rx = p.x * cosT - p.y * sinT;
    const ry = p.x * sinT + p.y * cosT;
    return { x: rx + shape.positionMm.x, y: ry + shape.positionMm.y };
  };

  const transformed: PolygonWithHoles[] = polygons.map((poly) => ({
    outer: poly.outer.map(transformPoint),
    holes: poly.holes.map((h) => h.map(transformPoint)),
  }));

  // After applying the rotation+translation, compute the polygons' bounding box
  // and also an area-weighted centroid so we can choose different anchor modes
  // (left/center/right × top/middle/baseline/bottom). This lets top-left
  // creation match zero padding while center alignment still centers.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // helpers
  const polygonCentroid = (ring: Ring) => {
    let A = 0;
    let Cx = 0;
    let Cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const xi = ring[i].x,
        yi = ring[i].y;
      const xj = ring[j].x,
        yj = ring[j].y;
      const cross = xi * yj - xj * yi;
      A += cross;
      Cx += (xi + xj) * cross;
      Cy += (yi + yj) * cross;
    }
    A *= 0.5;
    if (Math.abs(A) < 1e-9) return { x: ring[0].x, y: ring[0].y };
    return { x: Cx / (6 * A), y: Cy / (6 * A) };
  };

  let accumX = 0;
  let accumY = 0;
  let totalArea = 0;

  for (const poly of transformed) {
    for (const p of poly.outer) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    for (const h of poly.holes) {
      for (const p of h) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    // outer ring centroid/area
    const aOuter = signedArea(poly.outer);
    const cOuter = polygonCentroid(poly.outer);
    accumX += cOuter.x * aOuter;
    accumY += cOuter.y * aOuter;
    totalArea += aOuter;

    // subtract hole contributions
    for (const h of poly.holes) {
      const ah = signedArea(h);
      const ch = polygonCentroid(h);
      accumX += ch.x * ah; // ah is negative when properly wound
      accumY += ch.y * ah;
      totalArea += ah;
    }
  }

  if (minX === Infinity) {
    try {
      (scope as any).clear?.();
    } catch (e) {
      /* ignore */
    }
    return transformed;
  }

  const bboxCenterX = (minX + maxX) / 2;
  const bboxCenterY = (minY + maxY) / 2;

  const align = (shape.align || 'center');
  const valign = (shape.valign || 'baseline');

  let anchorX: number;
  let anchorY: number;

  if (align === 'left') anchorX = minX;
  else if (align === 'right') anchorX = maxX;
  else /* center */ anchorX = Math.abs(totalArea) > 1e-9 ? accumX / totalArea : bboxCenterX;

  if (valign === 'top') anchorY = maxY;
  else if (valign === 'bottom') anchorY = minY;
  else if (valign === 'middle') anchorY = Math.abs(totalArea) > 1e-9 ? accumY / totalArea : bboxCenterY;
  else /* baseline */ anchorY = Math.abs(totalArea) > 1e-9 ? accumY / totalArea : bboxCenterY;

  const dx = shape.positionMm.x - anchorX;
  const dy = shape.positionMm.y - anchorY;

  const centered = transformed.map((poly) => ({
    outer: poly.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    holes: poly.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
  }));

  // cleanup paper scope
  try {
    (scope as any).clear?.();
  } catch (e) {
    /* ignore */
  }

  return centered;
}

// Minimal DXF exporter: create POLYLINE + VERTEX entities for each ring
export function polygonsToDxf(polys: PolygonWithHoles[]): string {
  const header = [
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  const entities: string[] = [];

  function addRingAsPolyline(ring: Ring) {
    // POLYLINE header
    entities.push("0", "POLYLINE", "8", "0", "66", "1", "70", "1");
    for (const pt of ring) {
      entities.push("0", "VERTEX", "8", "0", "10", String(pt.x), "20", String(pt.y));
    }
    entities.push("0", "SEQEND");
  }

  for (const p of polys) {
    // outer
    addRingAsPolyline(p.outer);
    // holes as separate polylines (preserve winding/orientation so downstream tools can detect holes)
    for (const h of p.holes) addRingAsPolyline(h);
  }

  const footer = ["0", "ENDSEC", "0", "EOF"];
  return [...header, ...entities, ...footer].join("\n") + "\n";
}

// Convenience: convert a TextShape -> DXF string in one call
export async function textShapeToDxf(shape: TextShape, fontOrUrl: string | opentype.Font, toleranceMm = 0.1): Promise<string> {
  const polys = await convertTextShapeToPolygons(shape, fontOrUrl, toleranceMm);
  return polygonsToDxf(polys);
}

export default {
  loadFont,
  convertTextShapeToPolygons,
  polygonsToDxf,
  textShapeToDxf,
};
