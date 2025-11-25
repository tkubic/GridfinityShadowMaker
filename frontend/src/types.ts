// Shared types and constants extracted from App.tsx

export type BoardConfig = {
  gridX: number;
  gridY: number;
  cellSizeMM: number;
  height7Units?: number;
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
  fontSizeMM?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  text?: string;
  // for imported DXF/custom shapes
  scale?: number;
  dxfName?: string;
  dxfPaths?: Array<Array<{ x: number; y: number }>>; // points in mm, relative to shape center
  rotateDeg?: number;
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
