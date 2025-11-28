import type { ToolShape } from "../types";

export type Point = { x: number; y: number };

export function centroidOf(poly: Point[]) {
  if (!poly || poly.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}

export function signedArea(poly: Point[]) {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return a / 2;
}

export function pointInPoly(pt: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rotatePoint(px: number, py: number, deg: number) {
  const r = (deg * Math.PI) / 180.0;
  const cosr = Math.cos(r);
  const sinr = Math.sin(r);
  return { x: px * cosr - py * sinr, y: px * sinr + py * cosr };
}

// compute world-space corners for a shape's bounding box (taking into account width/height, scale and rotation)
export function getWorldCorners(s: ToolShape) {
  const cx = s.x ?? 0;
  const cy = s.y ?? 0;
  const scale = s.scale ?? 1;
  let w: number;
  let h: number;
  if (s.type === 'text') {
    if (s.dxfPaths && s.dxfPaths.length && s.origin === 'centroid') {
      const halfW = Math.max(0.01, ((s.widthMM ?? 0) * scale) / 2);
      const halfH = Math.max(0.01, ((s.heightMM ?? 0) * scale) / 2);
      const local = [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
      ];
      const deg = s.rotateDeg ?? 0;
      const r = (deg * Math.PI) / 180.0;
      const cosr = Math.cos(r);
      const sinr = Math.sin(r);
      return local.map((p) => {
        const rx = p.x * cosr - p.y * sinr;
        const ry = p.x * sinr + p.y * cosr;
        return { x: Math.round((cx + rx) * 10) / 10, y: Math.round((cy + ry) * 10) / 10 };
      });
    }
    const fontSize = (s.fontSizeMM ?? s.heightMM ?? 15) * (scale);
    const textLen = (s.text && s.text.length) ? s.text.length : (s.name ? s.name.length : 4);
    w = Math.max(1, textLen * fontSize * 0.6);
    h = Math.max(1, fontSize);
    let centerX = cx;
    let centerY = cy;
    const align = s.textAlign || 'center';
    const valign = s.textValign || 'top';
    if (align === 'left') centerX = cx + w / 2;
    else if (align === 'right') centerX = cx - w / 2;
    if (valign === 'top') centerY = cy - h / 2;
    else if (valign === 'bottom') centerY = cy + h / 2;
    const roundedCenterX = Math.round(centerX * 10) / 10;
    const roundedCenterY = Math.round(centerY * 10) / 10;
    const centerForCornersX = roundedCenterX;
    const centerForCornersY = roundedCenterY;
    const halfW = Math.max(0.01, w / 2);
    const halfH = Math.max(0.01, h / 2);
    const local = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ];
    const deg = s.rotateDeg ?? 0;
    const r = (deg * Math.PI) / 180.0;
    const cosr = Math.cos(r);
    const sinr = Math.sin(r);
    return local.map((p) => {
      const rx = p.x * cosr - p.y * sinr;
      const ry = p.x * sinr + p.y * cosr;
      return { x: Math.round((centerForCornersX + rx) * 10) / 10, y: Math.round((centerForCornersY + ry) * 10) / 10 };
    });
  } else {
    w = (s.widthMM ?? 0) * scale;
    h = (s.heightMM ?? 0) * scale;
  }
  const halfW = Math.max(0.01, w / 2);
  const halfH = Math.max(0.01, h / 2);
  const local = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  const deg = s.rotateDeg ?? 0;
  const r = (deg * Math.PI) / 180.0;
  const cosr = Math.cos(r);
  const sinr = Math.sin(r);
  return local.map((p) => {
    const rx = p.x * cosr - p.y * sinr;
    const ry = p.x * sinr + p.y * cosr;
    return { x: Math.round((cx + rx) * 10) / 10, y: Math.round((cy + ry) * 10) / 10 };
  });
}

export function computeTextBox(s: ToolShape) {
  const scale = s.scale ?? 1;
  if (s.type === 'text' && s.dxfPaths && s.dxfPaths.length && s.origin === 'centroid') {
    const centerX = s.x ?? 0;
    const centerY = s.y ?? 0;
    const w = s.widthMM ?? (s.text ? (s.text.length * (s.fontSizeMM ?? 15) * 0.6) : 10);
    const h = s.heightMM ?? (s.fontSizeMM ?? 15);
    const halfW = w / 2;
    const halfH = h / 2;
    return {
      centerX: Math.round(centerX * 10) / 10,
      centerY: Math.round(centerY * 10) / 10,
      width: w,
      height: h,
      left: Math.round((centerX - halfW) * 10) / 10,
      right: Math.round((centerX + halfW) * 10) / 10,
      top: Math.round((centerY + halfH) * 10) / 10,
      bottom: Math.round((centerY - halfH) * 10) / 10,
    };
  }

  const fontSize = (s.fontSizeMM ?? s.heightMM ?? 15) * (scale);
  const textLen = (s.text && s.text.length) ? s.text.length : (s.name ? s.name.length : 4);
  const w = Math.max(1, textLen * fontSize * 0.6);
  const h = Math.max(1, fontSize);

  let centerX = s.x ?? 0;
  let centerY = s.y ?? 0;
  const align = s.textAlign || 'center';
  const valign = s.textValign || 'top';
  if (align === 'left') centerX = (s.x ?? 0) + w / 2;
  else if (align === 'right') centerX = (s.x ?? 0) - w / 2;
  if (valign === 'top') centerY = (s.y ?? 0) - h / 2;
  else if (valign === 'bottom') centerY = (s.y ?? 0) + h / 2;

  const halfW = w / 2;
  const halfH = h / 2;
  return {
    centerX: Math.round(centerX * 10) / 10,
    centerY: Math.round(centerY * 10) / 10,
    width: w,
    height: h,
    left: Math.round((centerX - halfW) * 10) / 10,
    right: Math.round((centerX + halfW) * 10) / 10,
    top: Math.round((centerY + halfH) * 10) / 10,
    bottom: Math.round((centerY - halfH) * 10) / 10,
  };
}

export default {
  centroidOf,
  signedArea,
  pointInPoly,
  rotatePoint,
  getWorldCorners,
  computeTextBox,
};
