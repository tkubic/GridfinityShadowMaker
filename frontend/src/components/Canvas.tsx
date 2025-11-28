/** @jsxImportSource react */
import * as React from "react";
import * as opentype from "opentype.js";
import type { BoardConfig, ToolShape } from "../types";
import { centroidOf, signedArea, pointInPoly, getWorldCorners, computeTextBox } from "../lib/geometry";

type Props = {
  boardPxWidth: number;
  boardPxHeight: number;
  board: BoardConfig;
  drawShapes: ToolShape[];
  scaleX: number;
  scaleY: number;
  selectedItem: "board" | string;
  selectedItems: string[];
  selectItem: (id: "board" | string, append?: boolean) => void;
  updateShape: (id: string, partial: Partial<ToolShape>) => void;
  draggingId: string | null;
  dragOffset: { x: number; y: number } | null;
  setDraggingId: (id: string | null) => void;
  setDragOffset: (o: { x: number; y: number } | null) => void;
  FONT_SIZE_CORRECTION: number;
  textInputRef: React.RefObject<HTMLInputElement | null>;
  deleteShape: (id: string | string[]) => void;
};

export default function Canvas({
  boardPxWidth,
  boardPxHeight,
  board,
  drawShapes,
  scaleX,
  scaleY,
  selectedItem,
  selectedItems,
  selectItem,
  updateShape,
  draggingId,
  setDraggingId,
  setDragOffset,
  FONT_SIZE_CORRECTION,
  textInputRef,
  deleteShape,
}: Props) {
  // cache loaded opentype fonts by filename/url
  const fontCacheRef = React.useRef<Record<string, opentype.Font | null>>({});
  const [, setFontLoadTick] = React.useState(0);

  // Load any fonts referenced by shapes (fontFile) so we can compute ascender/descender
  React.useEffect(() => {
    const toLoad: string[] = [];
    for (const s of drawShapes) {
      const ff = s.fontFile as string | undefined;
      if (!ff) continue;
      const url = ff.startsWith('http://') || ff.startsWith('https://') ? ff : `http://localhost:5000/fonts/${ff}`;
      if (!fontCacheRef.current[url]) {
        fontCacheRef.current[url] = null; // mark as pending
        toLoad.push(url);
      }
    }
    if (!toLoad.length) return;
    for (const url of toLoad) {
      opentype.load(url, (err: Error | null, font?: opentype.Font) => {
        if (err) {
          console.warn('Failed to load font for metrics', url, err);
          fontCacheRef.current[url] = null;
        } else {
          fontCacheRef.current[url] = font ?? null;
        }
        // trigger a re-render so components depending on loaded fonts update
        setFontLoadTick((n) => n + 1);
      });
    }
  }, [drawShapes]);
  // refs to manage group dragging
  const groupOffsetsRef = React.useRef<Record<string, { x: number; y: number }>>({});

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

  

  // geometry helpers imported from ../lib/geometry

  // Keyboard handler: delete, arrow moves (shift fine), ctrl+arrow rotate
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete") {
        if (selectedItems && selectedItems.length) {
          deleteShape(selectedItems);
        } else if (selectedItem && selectedItem !== "board") {
          deleteShape(selectedItem);
        }
        return;
      }

      const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      if (!isArrow) return;
      e.preventDefault();

      const step = e.shiftKey ? 0.1 : 1.0;
      const targets = (selectedItems && selectedItems.length) ? selectedItems : (selectedItem && selectedItem !== "board" ? [selectedItem] : []);
      if (!targets.length) return;

      // rotation when ctrl/meta is held and Left/Right
      if (e.ctrlKey || e.metaKey) {
        // rotate whole selection around bounding-box center (more intuitive)
        const delta = (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0);
        if (targets.length === 1) {
          // single item -> rotate in place
          const id = targets[0];
          const s = drawShapes.find((d) => d.id === id);
          if (!s) return;
          const next = Math.round((s.rotateDeg ?? 0) + delta);
          updateShape(id, { rotateDeg: next });
          return;
        }

        // compute bounding box center of targets using shapes' world-space extents
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of targets) {
          const s = drawShapes.find((d) => d.id === id);
          if (!s) continue;
          const corners = getWorldCorners(s);
          for (const c of corners) {
            minX = Math.min(minX, c.x);
            minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x);
            maxY = Math.max(maxY, c.y);
          }
        }
        if (!isFinite(minX)) return;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const rad = (deg: number) => (deg * Math.PI) / 180.0;
        const cosd = Math.cos(rad(delta));
        const sind = Math.sin(rad(delta));

        for (const id of targets) {
          const s = drawShapes.find((d) => d.id === id);
          if (!s) continue;
          const sx = s.x ?? 0;
          const sy = s.y ?? 0;
          const relX = sx - centerX;
          const relY = sy - centerY;
          const rx = Math.round((relX * cosd - relY * sind) * 10) / 10;
          const ry = Math.round((relX * sind + relY * cosd) * 10) / 10;
          const newX = Math.round((centerX + rx) * 10) / 10;
          const newY = Math.round((centerY + ry) * 10) / 10;
          const nextRot = Math.round((s.rotateDeg ?? 0) + delta);
          updateShape(id, { x: newX, y: newY, rotateDeg: nextRot });
        }
        return;
      }

      // translation
      for (const id of targets) {
        const s = drawShapes.find((d) => d.id === id);
        if (!s) continue;
        let dx = 0, dy = 0;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowUp") dy = step;
        if (e.key === "ArrowDown") dy = -step;
        const newX = Math.round(((s.x ?? 0) + dx) * 10) / 10;
        const newY = Math.round(((s.y ?? 0) + dy) * 10) / 10;
        updateShape(id, { x: newX, y: newY });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItem, selectedItems, drawShapes, updateShape, deleteShape]);

  // SVG-level mouse move handles group dragging when set
  function onMouseMove(e: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (!draggingId || !groupOffsetsRef.current) return;
    const pt = getSvgPoint(e);
    // compute new position for each id in groupOffsets
    for (const id of Object.keys(groupOffsetsRef.current)) {
      const off = groupOffsetsRef.current[id];
      const newXmm = Math.round((pt.x - off.x) * 10) / 10;
      const newYmm = Math.round((pt.y - off.y) * 10) / 10;
      updateShape(id, { x: newXmm, y: newYmm });
    }
  }

  // resizing ref holds the active resize interaction
  const resizingRef = React.useRef<{
    id: string | null;
    handle: string | null;
    startShape?: ToolShape;
  }>({ id: null, handle: null });

  // handle mouse move for resizing (separate from group drag)
  function onMouseMoveResize(e: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (!resizingRef.current || !resizingRef.current.id) return;
    const id = resizingRef.current.id;
    const handle = resizingRef.current.handle!;
    const sLocal = drawShapes.find((d) => d.id === id);
    if (!sLocal) return;
    const s = sLocal;
    const pt = getSvgPoint(e); // world mm

    // helper: rotate a local point (in mm) to world coords using shape rotation
    const deg = sLocal.rotateDeg ?? 0;
    const r = (deg * Math.PI) / 180.0;
    const cosr = Math.cos(r);
    const sinr = Math.sin(r);

    function worldToLocal(wx: number, wy: number) {
      const dx = wx - (s.x ?? 0);
      const dy = wy - (s.y ?? 0);
      return { x: Math.round((dx * cosr + dy * -sinr) * 10) / 10, y: Math.round((dx * sinr + dy * cosr) * 10) / 10 };
    }

    const halfW = Math.max(0.01, ((sLocal.widthMM ?? 0) * (sLocal.scale ?? 1)) / 2);
    const halfH = Math.max(0.01, ((sLocal.heightMM ?? 0) * (sLocal.scale ?? 1)) / 2);

    // local coordinates for opposite/fixed corner depending on handle
    const localCorners: Record<string, { x: number; y: number }> = {
      nw: { x: -halfW, y: halfH },
      n: { x: 0, y: halfH },
      ne: { x: halfW, y: halfH },
      e: { x: halfW, y: 0 },
      se: { x: halfW, y: -halfH },
      s: { x: 0, y: -halfH },
      sw: { x: -halfW, y: -halfH },
      w: { x: -halfW, y: 0 },
    };

    // opposite mapping (which local point remains fixed)
    const opposite: Record<string, { x: number; y: number }> = {
      nw: localCorners.se,
      ne: localCorners.sw,
      se: localCorners.nw,
      sw: localCorners.ne,
      n: localCorners.s,
      s: localCorners.n,
      e: localCorners.w,
      w: localCorners.e,
    };

    const mouseLocal = worldToLocal(pt.x, pt.y);
    const fixedLocal = opposite[handle];

    // For mid-edge handles constrain one axis and preserve the other dimension
    let newLocal = { x: mouseLocal.x, y: mouseLocal.y };
    // original scaled halves
    const origHalfW = halfW;
    const origHalfH = halfH;

    // compute new sizes in scaled units (local units include shape.scale)
    let newWidthScaled: number;
    let newHeightScaled: number;

    if (handle === "n" || handle === "s") {
      // vertical drag: width preserved, height changes
      newWidthScaled = Math.max(1.0, origHalfW * 2);
      // constrain horizontal local coordinate to center (so we only change height)
      newLocal.x = 0;
      newHeightScaled = Math.max(1.0, Math.abs(newLocal.y - fixedLocal.y));
    } else if (handle === "e" || handle === "w") {
      // horizontal drag: height preserved, width changes
      newHeightScaled = Math.max(1.0, origHalfH * 2);
      // constrain vertical local coordinate to center
      newLocal.y = 0;
      newWidthScaled = Math.max(1.0, Math.abs(newLocal.x - fixedLocal.x));
    } else {
      // corner drag: both dimensions change
      newLocal = { x: mouseLocal.x, y: mouseLocal.y };
      newWidthScaled = Math.max(1.0, Math.abs(newLocal.x - fixedLocal.x));
      newHeightScaled = Math.max(1.0, Math.abs(newLocal.y - fixedLocal.y));
    }
    const newWidthMM = Math.round((newWidthScaled / (s.scale ?? 1)) * 10) / 10;
    const newHeightMM = Math.round((newHeightScaled / (s.scale ?? 1)) * 10) / 10;

    // new center in local coords (relative to original center)
    const centerLocal = { x: (newLocal.x + fixedLocal.x) / 2, y: (newLocal.y + fixedLocal.y) / 2 };
    // convert centerLocal (local mm) back to world coords
    const newCenterWorldX = Math.round(((s.x ?? 0) + (centerLocal.x * cosr - centerLocal.y * sinr)) * 10) / 10;
    const newCenterWorldY = Math.round(((s.y ?? 0) + (centerLocal.x * sinr + centerLocal.y * cosr)) * 10) / 10;

    updateShape(id, { x: newCenterWorldX, y: newCenterWorldY, widthMM: newWidthMM, heightMM: newHeightMM });
  }

  function onMouseUp() {
    setDraggingId(null);
    setDragOffset(null);
    groupOffsetsRef.current = {};
    resizingRef.current = { id: null, handle: null };
  }

  // combined mouse move (resize takes precedence)
  function svgMouseMove(e: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (resizingRef.current && resizingRef.current.id) {
      onMouseMoveResize(e);
      return;
    }
    onMouseMove(e);
  }

  // compute axis-aligned bounding box (mm coords) for current multi-selection using shapes' extents
  const selectedShapes = drawShapes.filter((s) => selectedItems.includes(s.id));
  let bboxRect: React.JSX.Element | null = null;
  let bboxMM: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  if (selectedShapes.length > 1) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of selectedShapes) {
      const corners = getWorldCorners(s);
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
    }
    if (isFinite(minX)) {
      bboxMM = { minX, minY, maxX, maxY };
      const xPx = minX * scaleX;
      const yPx = boardPxHeight - maxY * scaleY;
      const wPx = Math.max(0.1, (maxX - minX) * scaleX);
      const hPx = Math.max(0.1, (maxY - minY) * scaleY);
      bboxRect = (
        <rect
          x={xPx}
          y={yPx}
          width={wPx}
          height={hPx}
          stroke="#66aaff"
          strokeWidth={2}
          fill="none"
          strokeDasharray="6 4"
          pointerEvents="none"
          className="selection-bbox"
        />
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${boardPxWidth} ${boardPxHeight}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      className="board-svg"
      onMouseDown={(e) => {
        // clicking the background should deselect everything unless the click is inside
        // the current multi-selection bounding box (we keep the group active until clicked outside)
        const tgt = e.target as Element | null;
        if (!tgt) return;
        // compute world coords for click
        const pt = getSvgPoint(e);
        let clickedInsideBBox = false;
        if (bboxMM) {
          const { minX, minY, maxX, maxY } = bboxMM;
          if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) clickedInsideBBox = true;
        }
        const isBackground = (tgt === e.currentTarget || tgt.classList.contains("board-rect"));

        // If the user clicked inside the multi-selection bounding box, start
        // a group drag: compute offsets for every selected item and set
        // dragging state so `onMouseMove` will translate the whole group.
        if (isBackground && clickedInsideBBox && selectedItems && selectedItems.length > 1) {
          const offsets: Record<string, { x: number; y: number }> = {};
          for (const id of selectedItems) {
            const s = drawShapes.find((d) => d.id === id);
            if (!s) continue;
            offsets[id] = { x: pt.x - (s.x ?? 0), y: pt.y - (s.y ?? 0) };
          }
          groupOffsetsRef.current = offsets;
          // Use the first selected item as the dragging reference id
          const refId = selectedItems[0];
          const refShape = drawShapes.find((d) => d.id === refId);
          setDragOffset({ x: pt.x - (refShape?.x ?? 0), y: pt.y - (refShape?.y ?? 0) });
          setDraggingId(refId);
          return;
        }

        if (isBackground && !clickedInsideBBox) {
          selectItem("board");
        }
      }}
      onMouseMove={svgMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
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
        const isSelected = selectedItems.includes(shape.id) || selectedItem === shape.id;

        const startDragFor = (e: React.MouseEvent<SVGGraphicsElement, MouseEvent>) => {
          e.stopPropagation();
            const append = e.ctrlKey || e.metaKey;
            // If this shape is already part of a multi-selection and the user did not hold
            // a modifier, keep the existing multi-selection so clicking inside the box
            // and dragging moves the whole group. Only change selection if append is true
            // or the shape was not already a member.
            let newSelection: string[] = [];
            if (!append && selectedItems.includes(shape.id) && selectedItems.length > 1) {
              newSelection = selectedItems.slice();
              // do not call selectItem so parent selection state remains unchanged
            } else {
              if (append) {
                if (selectedItems.includes(shape.id)) newSelection = selectedItems.filter((x) => x !== shape.id);
                else newSelection = [...selectedItems, shape.id];
              } else {
                newSelection = [shape.id];
              }
              // inform parent only when we intend to change the selection
              selectItem(shape.id, append);
            }

          // compute mouse mm coords
          const svg = (e.target as SVGGraphicsElement).ownerSVGElement!;
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const ctm = svg.getScreenCTM();
          const p = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
          const mmX = p.x / scaleX;
          const mmY = (boardPxHeight - p.y) / scaleY;

          // For each item in resulting selection create offset = mouse - shapePos
          const offsets: Record<string, { x: number; y: number }> = {};
          for (const id of newSelection) {
            const s = drawShapes.find((d) => d.id === id);
            if (!s) continue;
            offsets[id] = { x: mmX - (s.x ?? 0), y: mmY - (s.y ?? 0) };
          }
          groupOffsetsRef.current = offsets;
          // set dragging state referencing the shape that was clicked
          setDragOffset({ x: mmX - (shape.x ?? 0), y: mmY - (shape.y ?? 0) });
          setDraggingId(shape.id);
        };

        if (shape.type === "rect") {
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
              onMouseDown={startDragFor}
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
              onMouseDown={startDragFor}
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
              onMouseDown={startDragFor}
            >
              {hasPaths ? (
                (() => {
                  const paths = shape.dxfPaths || [];
                  // Sort polygons by absolute area (largest first) so we only
                  // test containment against larger polygons. This avoids
                  // misclassifying large outer shapes when centroids fall
                  // inside smaller holes (common for concentric glyph contours).
                  const areas = paths.map((p) => Math.abs(signedArea(p || [])));
                  const idxs = paths.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
                  const holeFlags: boolean[] = new Array(paths.length).fill(false);
                  const processed: number[] = [];
                  for (const idx of idxs) {
                    const p = paths[idx] || [];
                    const c = centroidOf(p || []);
                    let isHole = false;
                    for (const larger of processed) {
                      const other = paths[larger] || [];
                      if (other && other.length && pointInPoly(c, other)) {
                        isHole = true;
                        break;
                      }
                    }
                    holeFlags[idx] = isHole;
                    processed.push(idx);
                  }
                  return paths.map((path, idx) => {
                    if (!path || !path.length) return null;
                    const isHole = !!holeFlags[idx];
                    const fill = isHole ? 'none' : fillColorFor(shape);
                    const d = path.map((p, i) => {
                      const px = centerXpx + p.x * s * scaleX;
                      const py = centerYpx - p.y * s * scaleY;
                      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
                    }).join(" ") + " Z";

                    return (
                      <path
                        key={idx}
                        d={d}
                        fill={fill}
                        fillOpacity={shape.cutType === "Raised" ? 1 : 1}
                        stroke={isSelected ? "#ffff66" : "#ffaaaa"}
                        strokeWidth={isSelected ? 3 : 1}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    );
                  });
                })()
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
          // Render text shapes using their pre-computed vector geometry (`dxfPaths`).
          // This keeps text editable (shape remains type 'text') while the canvas
          // shows deterministic vectors rather than browser-rendered font text.
          const rotDeg = shape.rotateDeg ?? 0;
          const s = shape.scale ?? 1;
          // Determine visual center: if the shape's origin is 'centroid' we
          // treat `x,y` as the geometry center. Otherwise compute the center
          // from the anchor (textAlign/textValign) so pre-vectorized anchor
          // placement is preserved when dxfPaths are present.
          let centerX = shape.x ?? 0;
          let centerY = shape.y ?? 0;
          if (!(shape.origin === 'centroid')) {
            const tb = computeTextBox(shape);
            centerX = tb.centerX;
            centerY = tb.centerY;
          }
          const centerXpx = centerX * scaleX;
          const centerYpx = boardPxHeight - centerY * scaleY;
          const fontSizePx = (shape.fontSizeMM ?? 15) * ((scaleX + scaleY) / 2) * FONT_SIZE_CORRECTION;
          const hasPaths = shape.dxfPaths && shape.dxfPaths.length > 0;

          return (
            <g
              key={shape.id}
              className={"shape-text" + (isSelected ? " shape-selected" : "")}
              transform={rotDeg ? `rotate(${rotDeg} ${centerXpx} ${centerYpx})` : undefined}
              onMouseDown={(e) => {
                // keep same drag/select behavior as before
                if ((e as React.MouseEvent).detail > 1) return;
                startDragFor(e as React.MouseEvent<SVGGraphicsElement, MouseEvent>);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                selectItem(shape.id);
                setDraggingId(null);
                setDragOffset(null);
                setTimeout(() => textInputRef.current?.focus(), 0);
              }}
            >
              {hasPaths ? (
                (() => {
                  const paths = shape.dxfPaths || [];
                  const areas = paths.map((p) => Math.abs(signedArea(p || [])));
                  const idxs = paths.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
                  const holeFlags: boolean[] = new Array(paths.length).fill(false);
                  const processed: number[] = [];
                  for (const idx of idxs) {
                    const p = paths[idx] || [];
                    const c = centroidOf(p || []);
                    let isHole = false;
                    for (const larger of processed) {
                      const other = paths[larger] || [];
                      if (other && other.length && pointInPoly(c, other)) {
                        isHole = true;
                        break;
                      }
                    }
                    holeFlags[idx] = isHole;
                    processed.push(idx);
                  }

                  return paths.map((path, idx) => {
                    if (!path || !path.length) return null;
                    const isHole = !!holeFlags[idx];
                    const fill = isHole ? 'rgba(0, 0, 0, 1)' : fillColorFor(shape);
                    const d = path.map((p: { x: number; y: number }, i: number) => {
                      const px = centerXpx + p.x * s * scaleX;
                      const py = centerYpx - p.y * s * scaleY;
                      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
                    }).join(" ") + " Z";

                    return (
                      <path
                        key={idx}
                        d={d}
                        fill={fill}
                        fillOpacity={shape.cutType === "Raised" ? 1 : 1}
                        stroke={isSelected ? "#ffff66" : "#ffaaaa"}
                        strokeWidth={isSelected ? 3 : 1}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    );
                  });
                })()
              ) : (
                // Fallback: show a simple placeholder box with the text label so
                // the user can still see and interact with the object even if
                // vectorization hasn't completed or failed.
                (() => {
                  const tb = computeTextBox(shape);
                  const baseW = tb.width || 40;
                  const baseH = tb.height || 15;
                  const wPx = baseW * s * scaleX;
                  const hPx = baseH * s * scaleY;
                  const xPx = centerXpx - wPx / 2;
                  const yPx = centerYpx - hPx / 2;
                  return (
                    <>
                      <rect x={xPx} y={yPx} width={wPx} height={hPx} fill="#ffaaaa33" stroke={isSelected ? "#ff6666" : "#ffaaaa"} strokeWidth={isSelected ? 2 : 1} />
                      <line x1={xPx} y1={yPx} x2={xPx + wPx} y2={yPx + hPx} stroke="#ff6666" strokeWidth={1} />
                      <line x1={xPx + wPx} y1={yPx} x2={xPx} y2={yPx + hPx} stroke="#ff6666" strokeWidth={1} />
                      <text x={centerXpx} y={centerYpx} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(10, Math.round(fontSizePx * 0.6))} fill="#333333">{shape.text ?? shape.name}</text>
                    </>
                  );
                })()
              )}
            </g>
          );
        }

        return null;
      })}
      {/* Render resize handles when a single shape is selected */}
      {selectedItems.length === 1 ? (() => {
        const id = selectedItems[0];
        const s = drawShapes.find((d) => d.id === id);
        if (!s) return null;
        // don't show resize handles for DXF or text shapes
        // - DXF shapes manage scale separately
        // - text size is controlled by fontSize, not resize handles
        if (s.type === 'dxf' || s.type === 'text') return null;
        const corners = getWorldCorners(s); // order: sw, se, ne, nw
        const sw = corners[0];
        const se = corners[1];
        const ne = corners[2];
        const nw = corners[3];
        // midpoints
        const n = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
        const spt = { x: (sw.x + se.x) / 2, y: (sw.y + se.y) / 2 };
        const e = { x: (se.x + ne.x) / 2, y: (se.y + ne.y) / 2 };
        const w = { x: (sw.x + nw.x) / 2, y: (sw.y + nw.y) / 2 };
        const handles: Array<{ name: string; p: { x: number; y: number }; cursor: string }> = [
          { name: 'nw', p: nw, cursor: 'nwse-resize' },
          { name: 'n', p: n, cursor: 'ns-resize' },
          { name: 'ne', p: ne, cursor: 'nesw-resize' },
          { name: 'e', p: e, cursor: 'ew-resize' },
          { name: 'se', p: se, cursor: 'nwse-resize' },
          { name: 's', p: spt, cursor: 'ns-resize' },
          { name: 'sw', p: sw, cursor: 'nesw-resize' },
          { name: 'w', p: w, cursor: 'ew-resize' },
        ];
        const sizePx = 8;
        return (
          <g pointerEvents="all">
            {handles.map((h) => {
              const xPx = h.p.x * scaleX - sizePx / 2;
              const yPx = boardPxHeight - h.p.y * scaleY - sizePx / 2;
              return (
                <rect
                  key={h.name}
                  x={xPx}
                  y={yPx}
                  width={sizePx}
                  height={sizePx}
                  fill="#ffffff"
                  stroke="#333333"
                  strokeWidth={1}
                  style={{ cursor: h.cursor }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    resizingRef.current = { id, handle: h.name };
                    // prevent interfering with drag
                    setDraggingId(null);
                    setDragOffset(null);
                  }}
                />
              );
            })}
          </g>
        );
      })() : null}
      {bboxRect}
    </svg>
  );
}
