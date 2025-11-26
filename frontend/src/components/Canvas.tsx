import React from "react";
import type { BoardConfig, ToolShape } from "../types";

type Props = {
  boardPxWidth: number;
  boardPxHeight: number;
  board: BoardConfig;
  drawShapes: ToolShape[];
  scaleX: number;
  scaleY: number;
  selectedItem: "board" | string;
  selectItem: (id: "board" | string) => void;
  updateShape: (id: string, partial: Partial<ToolShape>) => void;
  draggingId: string | null;
  dragOffset: { x: number; y: number } | null;
  setDraggingId: (id: string | null) => void;
  setDragOffset: (o: { x: number; y: number } | null) => void;
  FONT_SIZE_CORRECTION: number;
  textInputRef: React.RefObject<HTMLInputElement | null>;
  deleteShape: (id: string) => void;
};

export default function Canvas({
  boardPxWidth,
  boardPxHeight,
  board,
  drawShapes,
  scaleX,
  scaleY,
  selectedItem,
  selectItem,
  updateShape,
  draggingId,
  dragOffset,
  setDraggingId,
  setDragOffset,
  FONT_SIZE_CORRECTION,
  textInputRef,
  deleteShape,
}: Props) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Delete or Backspace should remove the selected shape when present
      if (e.key === 'Delete') {
        if (selectedItem && selectedItem !== 'board') {
          e.preventDefault();
          deleteShape(selectedItem as string);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedItem, deleteShape]);
  // convert mouse event to board mm coords (origin bottom-left)
  function getSvgPoint(evt: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    const svg = evt.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    const svgPt = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
    const mmX = svgPt.x / scaleX;
    const mmY = (boardPxHeight - svgPt.y) / scaleY;
    return { x: mmX, y: mmY };
  }

  function fillColorFor(shape: ToolShape) {
    const t = shape.cutType ?? "Cut";
    if (t === "Blocker") return "#000000";
    if (t === "Raised") return "#ffffff";
    return "#ff3333";
  }

  return (
    <svg
      viewBox={`0 0 ${boardPxWidth} ${boardPxHeight}`}
      width={boardPxWidth}
      height={boardPxHeight}
      className="board-svg"
      onMouseMove={(e) => {
        if (!draggingId || !dragOffset) return;
        const pt = getSvgPoint(e);
        const rawX = pt.x - dragOffset.x;
        const rawY = pt.y - dragOffset.y;
        const newXmm = Math.round(rawX * 10) / 10;
        const newYmm = Math.round(rawY * 10) / 10;
        updateShape(draggingId, { x: newXmm, y: newYmm });
      }}
      onMouseUp={() => {
        setDraggingId(null);
        setDragOffset(null);
      }}
      onMouseLeave={() => {
        setDraggingId(null);
        setDragOffset(null);
      }}
    >
      <rect x={0} y={0} width={boardPxWidth} height={boardPxHeight} className="board-rect" />

      {Array.from({ length: board.gridX + 1 }).map((_, i) => {
        const x = (i * boardPxWidth) / board.gridX;
        return <line key={`v-${i}`} x1={x} y1={0} x2={x} y2={boardPxHeight} className="board-grid-line" />;
      })}

      {Array.from({ length: board.gridY + 1 }).map((_, i) => {
        const y = boardPxHeight - (i * boardPxHeight) / board.gridY;
        return <line key={`h-${i}`} x1={0} y1={y} x2={boardPxWidth} y2={y} className="board-grid-line" />;
      })}

      {drawShapes.map((shape) => {
        const isSelected = selectedItem === shape.id;

        if (shape.type === "rect") {
          // Render rectangles with shape.x/shape.y as the center (consistent with ovals and text)
          const wPx = (shape.widthMM || 0) * scaleX;
          const hPx = (shape.heightMM || 0) * scaleY;
          const cx = shape.x * scaleX;
          const cy = boardPxHeight - shape.y * scaleY;
          const xPx = cx - wPx / 2;
          const yPx = cy - hPx / 2;
          const rotDeg = shape.rotateDeg ?? 0;
          return (
            <rect
              key={shape.id}
              x={xPx}
              y={yPx}
              width={wPx}
              height={hPx}
              transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
              fill={fillColorFor(shape)}
              stroke={isSelected ? "#ffff66" : "none"}
              strokeWidth={isSelected ? 3 : 0}
              className={"shape-rect" + (isSelected ? " shape-selected" : "")}
              onMouseDown={(e) => {
                e.stopPropagation();
                selectItem(shape.id);
                const svg = (e.target as SVGGraphicsElement).ownerSVGElement!;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = svg.getScreenCTM();
                const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
                const mmX = p.x / scaleX;
                const mmY = (boardPxHeight - p.y) / scaleY;
                setDragOffset({ x: mmX - shape.x, y: mmY - shape.y });
                setDraggingId(shape.id);
              }}
            />
          );
        }

        if (shape.type === "oval") {
          const cx = shape.x * scaleX;
          const cy = boardPxHeight - shape.y * scaleY;
          const rotDeg = shape.rotateDeg ?? 0;
          const baseW = shape.widthMM ?? 20;
          const baseH = shape.heightMM ?? 20;
          const rx = (baseW * scaleX) / 2;
          const ry = (baseH * scaleY) / 2;
          return (
            <ellipse
              key={shape.id}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
              fill={fillColorFor(shape)}
              stroke={isSelected ? "#ffff66" : "none"}
              strokeWidth={isSelected ? 3 : 0}
              className={"shape-oval" + (isSelected ? " shape-selected" : "")}
              onMouseDown={(e) => {
                e.stopPropagation();
                selectItem(shape.id);
                const svg = (e.target as SVGGraphicsElement).ownerSVGElement!;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = svg.getScreenCTM();
                const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
                const mmX = p.x / scaleX;
                const mmY = (boardPxHeight - p.y) / scaleY;
                setDragOffset({ x: mmX - shape.x, y: mmY - shape.y });
                setDraggingId(shape.id);
              }}
            />
          );
        }

        if (shape.type === "dxf") {
          const s = shape.scale ?? 1;
          const centerXpx = shape.x * scaleX;
          const centerYpx = boardPxHeight - shape.y * scaleY;
          const hasPaths = shape.dxfPaths && shape.dxfPaths.length > 0;
          return (
            <g
              key={shape.id}
              className="shape-dxf"
              transform={((shape.rotateDeg ?? 0) !== 0) ? `rotate(${shape.rotateDeg} ${centerXpx} ${centerYpx})` : undefined}
              onMouseDown={(e) => {
                e.stopPropagation();
                selectItem(shape.id);
                const svg = (e.target as SVGGraphicsElement).ownerSVGElement!;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = svg.getScreenCTM();
                const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
                const mmX = p.x / scaleX;
                const mmY = (boardPxHeight - p.y) / scaleY;
                setDragOffset({ x: mmX - shape.x, y: mmY - shape.y });
                setDraggingId(shape.id);
              }}
            >
              {hasPaths ? (
                shape.dxfPaths!.map((path, idx) => {
                  if (!path.length) return null;
                  const d = path.map((p, i) => {
                    const px = centerXpx + p.x * s * scaleX;
                    const py = centerYpx - p.y * s * scaleY;
                    return `${i === 0 ? "M" : "L"} ${px} ${py}`;
                  }).join(" ") + " Z";

                  return (
                    <path
                      key={idx}
                      d={d}
                      fill={fillColorFor(shape)}
                      fillOpacity={shape.cutType === "Raised" ? 1 : 1}
                      stroke={isSelected ? "#ffff66" : "#ffaaaa"}
                      strokeWidth={isSelected ? 3 : 1}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  );
                })
              ) : (
                (() => {
                  const baseW = shape.widthMM || 50;
                  const baseH = shape.heightMM || 50;
                  const wPx = baseW * s * scaleX;
                  const hPx = baseH * s * scaleY;
                  const xPx = centerXpx - wPx / 2;
                  const yPx = centerYpx - hPx / 2;
                  return (
                    <>
                      <rect x={xPx} y={yPx} width={wPx} height={hPx} fill="#ffaaaa33" stroke={isSelected ? "#ff6666" : "#ffaaaa"} strokeWidth={isSelected ? 2 : 1} />
                      <line x1={xPx} y1={yPx} x2={xPx + wPx} y2={yPx + hPx} stroke="#ff6666" strokeWidth={1} />
                      <line x1={xPx + wPx} y1={yPx} x2={xPx} y2={yPx + hPx} stroke="#ff6666" strokeWidth={1} />
                    </>
                  );
                })()
              )}
            </g>
          );
        }

        if (shape.type === "text") {
          const xPx = shape.x * scaleX;
          const yPx = boardPxHeight - shape.y * scaleY;
          const rotDeg = shape.rotateDeg ?? 0;
          const fontSizePx = (shape.fontSizeMM ?? 15) * ((scaleX + scaleY) / 2) * FONT_SIZE_CORRECTION;
          return (
            <text
              key={shape.id}
              x={xPx}
              y={yPx}
              transform={rotDeg ? `rotate(${rotDeg} ${xPx} ${yPx})` : undefined}
              fill={fillColorFor(shape)}
              fontFamily={shape.fontName ?? "Nunito, Arial, Helvetica, sans-serif"}
              style={{
                fontFamily: shape.fontName ?? "Nunito, Arial, Helvetica, sans-serif",
                fontWeight: shape.fontBold ? "700" : "400",
                fontStyle: shape.fontItalic ? "italic" : "normal",
                textDecoration: shape.fontUnderline ? "underline" : "none",
              }}
              fontSize={fontSizePx}
              textAnchor="middle"
              dominantBaseline="middle"
              className={"shape-text" + (isSelected ? " shape-selected" : "")}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.detail > 1) return;
                selectItem(shape.id);
                const svg = (e.target as SVGGraphicsElement).ownerSVGElement!;
                const pt = svg.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const ctm = svg.getScreenCTM();
                const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
                const mmX = p.x / scaleX;
                const mmY = (boardPxHeight - p.y) / scaleY;
                setDragOffset({ x: mmX - shape.x, y: mmY - shape.y });
                setDraggingId(shape.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                selectItem(shape.id);
                setDraggingId(null);
                setDragOffset(null);
                setTimeout(() => textInputRef.current?.focus(), 0);
              }}
            >
              {shape.text ?? shape.name}
            </text>
          );
        }

        return null;
      })}
    </svg>
  );
}
