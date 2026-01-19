// Shared types and constants extracted from App.tsx

export type BoardConfig = {
  gridX: number;
  gridY: number;
  cellSizeMM: number;
  height7Units?: number;
  // Chamfer controls for DXF chamfered extrusion
  chamferEnabled?: boolean;
  chamferHeight?: number;
};

export type ShapeType = "rect" | "oval" | "dxf" | "text";

export type ScoopType = "none" | "shallow" | "deep";

export type CutType = "Cut" | "Blocker" | "Raised";

export type ToolShape = {
  id: string;
  type: ShapeType;
  name: string;
  x: number; // mm, board coordinates (origin bottom-left, y+ up)
  y: number; // mm
  widthMM?: number;
  heightMM?: number;
  depthMM?: number; // depth in mm
  scoop?: ScoopType;
  cutType?: CutType;
  // text-specific
  fontName?: string;
  // optional explicit font file (filename served from /fonts). When set, the
  // frontend will try to load `/fonts/<fontFile>` for conversion and display.
  fontFile?: string;
  fontSizeMM?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  text?: string;
  // text alignment: controls how text anchor maps to `x,y` when creating/exporting
  textAlign?: 'left' | 'center' | 'right';
  // vertical alignment: top/middle/baseline/bottom
  textValign?: 'top' | 'middle' | 'baseline' | 'bottom';
  // origin indicates how `x,y` should be interpreted when `dxfPaths` exist.
  // 'centroid' means `x,y` is the geometry center (default for imported DXFs).
  // 'anchor' means `x,y` is an anchor derived from textAlign/textValign.
  origin?: 'centroid' | 'anchor';
  // for imported DXF/custom shapes
  scale?: number;
  dxfName?: string;
  dxfPaths?: Array<Array<{ x: number; y: number }>>; // points in mm, relative to shape center
  rotateDeg?: number;
  // Split to Sections: enables 3-depth section cutting for this shape
  splitToSections?: boolean;
  // Depths for each of the 3 sections (innermost to outermost), in mm
  sectionDepths?: [number, number, number];
  // Widths for sections 1 and 2 (section 3 extends to edge), in mm
  sectionWidths?: [number, number];
  // Rotation angle for section cut orientation, in degrees
  sectionRotation?: number;
  // Optional corner radius for rectangle shapes
  cornerRadiusEnabled?: boolean;
  cornerRadiusMM?: number;
};

export type Project = {
  name: string;
  board: BoardConfig;
  shapes: ToolShape[];
};

// Font options for text shapes. Values include sensible fallbacks.
export const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Rounded (Nunito)", value: "Nunito, Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Arial Black", value: "'Arial Black', Gadget, sans-serif" },
];
