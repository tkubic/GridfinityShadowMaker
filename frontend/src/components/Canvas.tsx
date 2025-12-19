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
  updateShape: (id: string, partial: Partial<ToolShape>, opts?: { skipHistory?: boolean }) => void;
  draggingId: string | null;
  dragOffset: { x: number; y: number } | null;
  setDraggingId: (id: string | null) => void;
  setDragOffset: (o: { x: number; y: number } | null) => void;
  FONT_SIZE_CORRECTION: number;
  textInputRef: React.RefObject<HTMLInputElement | null>;
  deleteShape: (id: string | string[]) => void;
  pushHistoryCheckpoint: (label?: string) => void;
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
  pushHistoryCheckpoint,
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
  // Track whether the current pointer gesture already pushed a history checkpoint
  const gestureHistoryPushedRef = React.useRef(false);

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

  // compute a chamfer-outline stroke width in SVG pixels based on board settings
  function chamferStrokePxFor(): number {
    try {
      const enabled = !!board.chamferEnabled;
      const h = typeof board.chamferHeight === 'number' ? board.chamferHeight : Number(board.chamferHeight || 0);
      if (!enabled || !h) return 0;
      const avgScale = (scaleX + scaleY) / 2;
      // stroke width in px approximates chamfer height in mm scaled to px
      // Multiply by 2 to make the preview outline more visible (user requested ~2x thickness)
      return Math.max(0.5, Math.round(h * avgScale * 2));
    } catch {
      return 0;
    }
  }

  // Build a rotated strip polygon (axis-aligned before rotation) and return SVG points string
  function stripPolygonPoints(
    cx: number,
    cy: number,
    x0: number,
    x1: number,
    halfH: number,
    angleDeg: number
  ): string {
    const theta = (angleDeg * Math.PI) / 180;
    const cosr = Math.cos(theta);
    const sinr = Math.sin(theta);

    const corners = [
      { x: x0, y: -halfH },
      { x: x1, y: -halfH },
      { x: x1, y: halfH },
      { x: x0, y: halfH },
    ];

    const pts = corners.map(({ x, y }) => {
      const rx = x * cosr - y * sinr + cx;
      const ry = x * sinr + y * cosr + cy;
      return `${rx},${ry}`;
    });

    return pts.join(" ");
  }

  // Return a half-height large enough that a rotated strip fully covers the shape when clipped
  function coverHalfHeight(widthPx: number, heightPx: number): number {
    // Use max dimension * sqrt(2) to cover any rotation without leaving gaps
    return Math.max(widthPx, heightPx) * Math.SQRT2;
  }

  // Extend strip length beyond the shape so rotated strips reach both ends
  function stripExtra(widthPx: number, heightPx: number): number {
    return coverHalfHeight(widthPx, heightPx);
  }

  

  // geometry helpers imported from ../lib/geometry

  // Keyboard handler: delete, arrow moves (shift fine), ctrl+arrow rotate
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      let checkpointed = false;
      const ensureCheckpoint = () => {
        if (!checkpointed) {
          pushHistoryCheckpoint('key-move');
          checkpointed = true;
        }
      };
      if (e.key === "Delete") {
        const hasMulti = selectedItems && selectedItems.length;
        const hasSingle = selectedItem && selectedItem !== "board";
        if (!hasMulti && !hasSingle) return;
        ensureCheckpoint();
        if (hasMulti) {
          deleteShape(selectedItems);
        } else if (hasSingle) {
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
        const delta = (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0);
        if (delta === 0) return;
        ensureCheckpoint();
        // rotate whole selection around bounding-box center (more intuitive)
        if (targets.length === 1) {
          // single item -> rotate in place
          const id = targets[0];
          const s = drawShapes.find((d) => d.id === id);
          if (!s) return;
          const next = Math.round((s.rotateDeg ?? 0) + delta);
          updateShape(id, { rotateDeg: next }, { skipHistory: true });
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
          updateShape(id, { x: newX, y: newY, rotateDeg: nextRot }, { skipHistory: true });
        }
        return;
      }

      // translation
      ensureCheckpoint();
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
        updateShape(id, { x: newX, y: newY }, { skipHistory: true });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItem, selectedItems, drawShapes, updateShape, deleteShape, pushHistoryCheckpoint]);

  // SVG-level mouse move handles group dragging when set
  function onMouseMove(e: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (!draggingId || !groupOffsetsRef.current) return;
    if (!gestureHistoryPushedRef.current) {
      pushHistoryCheckpoint('group-drag');
      gestureHistoryPushedRef.current = true;
    }
    const pt = getSvgPoint(e);
    // compute new position for each id in groupOffsets
    for (const id of Object.keys(groupOffsetsRef.current)) {
      const off = groupOffsetsRef.current[id];
      const newXmm = Math.round((pt.x - off.x) * 10) / 10;
      const newYmm = Math.round((pt.y - off.y) * 10) / 10;
      updateShape(id, { x: newXmm, y: newYmm }, { skipHistory: true });
    }
  }

  // resizing ref holds the active resize interaction
  const [hoverHandle, setHoverHandle] = React.useState<string | null>(null);
  const resizingRef = React.useRef<{
    id: string | null;
    handle: string | null;
    startShape?: ToolShape;
    startPointer?: { x: number; y: number };
  }>({ id: null, handle: null });

  // handle mouse move for resizing (separate from group drag)
  function onMouseMoveResize(e: React.MouseEvent<SVGSVGElement, MouseEvent>) {
    if (!resizingRef.current || !resizingRef.current.id) return;
    if (!gestureHistoryPushedRef.current) {
      pushHistoryCheckpoint('resize-gesture');
      gestureHistoryPushedRef.current = true;
    }
    const id = resizingRef.current.id;
    const handle = resizingRef.current.handle!;
    const sLocal = drawShapes.find((d) => d.id === id);
    if (!sLocal) return;
    const start = resizingRef.current.startShape ?? sLocal;
    const ptStart = resizingRef.current.startPointer ?? { x: start.x ?? 0, y: start.y ?? 0 };
    const pt = getSvgPoint(e); // world mm now

    // Unified rotation convention: world/mm coordinates are y-up. SVG applies
    // positive angles clockwise (y-down). To match the rendered shape, use a
    // single rotation `rotRadUsed` = -deg in math space.
    const rotDeg = start.rotateDeg ?? 0;
    const rotRadUsed = -((rotDeg) * Math.PI) / 180.0;
    const cosR = Math.cos(rotRadUsed);
    const sinR = Math.sin(rotRadUsed);

    const rotate = (v: { x: number; y: number }, angleRad: number) => {
      const c = Math.cos(angleRad);
      const s = Math.sin(angleRad);
      return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
    };

    const dWorld = { x: pt.x - ptStart.x, y: pt.y - ptStart.y };
    const dLocal = rotate(dWorld, -rotRadUsed);

    const wStartScaled = Math.max(0.01, (start.widthMM ?? 0) * (start.scale ?? 1));
    const hStartScaled = Math.max(0.01, (start.heightMM ?? 0) * (start.scale ?? 1));

    const meta: Record<string, { sx: number; sy: number }> = {
      e: { sx: 1, sy: 0 },
      w: { sx: -1, sy: 0 },
      n: { sx: 0, sy: 1 },
      s: { sx: 0, sy: -1 },
      ne: { sx: 1, sy: 1 },
      nw: { sx: -1, sy: 1 },
      se: { sx: 1, sy: -1 },
      sw: { sx: -1, sy: -1 },
    };
    const dir = meta[handle];
    if (!dir) return;
    const MIN_SIDE = 1.0;

    const newWidthScaled = dir.sx !== 0 ? Math.max(MIN_SIDE, wStartScaled + dir.sx * dLocal.x) : wStartScaled;
    const newHeightScaled = dir.sy !== 0 ? Math.max(MIN_SIDE, hStartScaled + dir.sy * dLocal.y) : hStartScaled;

    const anchorLocalStart = {
      x: dir.sx !== 0 ? -dir.sx * wStartScaled / 2 : 0,
      y: dir.sy !== 0 ? -dir.sy * hStartScaled / 2 : 0,
    };
    const anchorLocalNew = {
      x: dir.sx !== 0 ? -dir.sx * newWidthScaled / 2 : 0,
      y: dir.sy !== 0 ? -dir.sy * newHeightScaled / 2 : 0,
    };

    // Opposite handle must stay anchored in world space during resize
    const anchorWorld = {
      x: (start.x ?? 0) + anchorLocalStart.x * cosR - anchorLocalStart.y * sinR,
      y: (start.y ?? 0) + anchorLocalStart.x * sinR + anchorLocalStart.y * cosR,
    };

    const centerNew = {
      x: anchorWorld.x - (anchorLocalNew.x * cosR - anchorLocalNew.y * sinR),
      y: anchorWorld.y - (anchorLocalNew.x * sinR + anchorLocalNew.y * cosR),
    };

    const newWidthMM = Math.round((newWidthScaled / (start.scale ?? 1)) * 10) / 10;
    const newHeightMM = Math.round((newHeightScaled / (start.scale ?? 1)) * 10) / 10;

    updateShape(id, { x: Math.round(centerNew.x * 10) / 10, y: Math.round(centerNew.y * 10) / 10, widthMM: newWidthMM, heightMM: newHeightMM }, { skipHistory: true });
  }

  function onMouseUp() {
    setDraggingId(null);
    setDragOffset(null);
    groupOffsetsRef.current = {};
    resizingRef.current = { id: null, handle: null };
    gestureHistoryPushedRef.current = false;
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
          gestureHistoryPushedRef.current = false;
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
          gestureHistoryPushedRef.current = false;
        };

        if (shape.type === "rect") {
          const wPx = (shape.widthMM || 0) * scaleX;
          const hPx = (shape.heightMM || 0) * scaleY;
          const cx = shape.x * scaleX;
          const cy = boardPxHeight - shape.y * scaleY;
          const xPx = cx - wPx / 2;
          const yPx = cy - hPx / 2;
          const rotDeg = shape.rotateDeg ?? 0;

          // Section visualization: render 3 vertical strip zones when splitToSections is enabled
          // This matches OpenSCAD's three_section_shape which divides into left/center/right strips
          if (shape.splitToSections && (shape.cutType ?? "Cut") === "Cut") {
            const sectionWidths = shape.sectionWidths ?? [20, 0];
            const sectionRotRaw = shape.sectionRotation ?? 0;
            const fillAngle = -sectionRotRaw;
            const clipId = `rect-clip-${shape.id}`;

            // Section colors: left, center, right
            const sectionColors = ['#ff6666', '#cc0000', '#ff3333'];

            // Interpret sectionWidths[0] = center island width; sectionWidths[1] = offset from center
            const centerWidthMM = sectionWidths[0] ?? 20;
            const offsetMM = sectionWidths[1] ?? 0;
            const centerWidthPx = Math.min(centerWidthMM * scaleX, wPx);
            const offsetPx = offsetMM * scaleX;

            // Determine the left coordinate for the center island, clamped to stay inside the rect
            let centerLeft = cx - centerWidthPx / 2 + offsetPx;
            const minCenterLeft = xPx;
            const maxCenterLeft = xPx + wPx - centerWidthPx;
            if (centerLeft < minCenterLeft) centerLeft = minCenterLeft;
            if (centerLeft > maxCenterLeft) centerLeft = maxCenterLeft;

            const leftPxWidth = Math.max(0, centerLeft - xPx);
            const rightPxWidth = Math.max(0, xPx + wPx - (centerLeft + centerWidthPx));

            const chamferPx = chamferStrokePxFor();
            const showChamferOutline = chamferPx > 0 && ((shape.cutType ?? "Cut") === "Cut");
            return (
              <g key={shape.id} onMouseDown={startDragFor} transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}>
                <defs>
                  <clipPath id={clipId}>
                    <rect
                      x={xPx}
                      y={yPx}
                      width={wPx}
                      height={hPx}
                      transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                    />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`} transform={rotDeg ? `rotate(${-rotDeg} ${cx} ${cy})` : undefined}>
                  {leftPxWidth > 0 && (
                    <polygon
                      points={stripPolygonPoints(
                        cx,
                        cy,
                        xPx - cx - stripExtra(wPx, hPx),
                        xPx - cx + leftPxWidth,
                        coverHalfHeight(wPx, hPx),
                        fillAngle
                      )}
                      fill={sectionColors[0]}
                    />
                  )}
                  <polygon
                    points={stripPolygonPoints(
                      cx,
                      cy,
                      centerLeft - cx,
                      centerLeft - cx + centerWidthPx,
                      coverHalfHeight(wPx, hPx),
                      fillAngle
                    )}
                    fill={sectionColors[1]}
                  />
                  {rightPxWidth > 0 && (
                    <polygon
                      points={stripPolygonPoints(
                        cx,
                        cy,
                        centerLeft + centerWidthPx - cx,
                        centerLeft + centerWidthPx - cx + rightPxWidth + stripExtra(wPx, hPx),
                        coverHalfHeight(wPx, hPx),
                        fillAngle
                      )}
                      fill={sectionColors[2]}
                    />
                  )}
                </g>
                {/* Chamfer preview outline (approx) */}
                {showChamferOutline && (
                  <rect
                    x={xPx}
                    y={yPx}
                    width={wPx}
                    height={hPx}
                    fill="none"
                    stroke="#990000"
                    strokeOpacity={0.6}
                    strokeWidth={chamferPx}
                    pointerEvents="none"
                  />
                )}
                {/* Selection outline */}
                {isSelected && (
                  <rect
                    x={xPx}
                    y={yPx}
                    width={wPx}
                    height={hPx}
                    fill="none"
                    stroke="#ffff66"
                    strokeWidth={3}
                  />
                )}
              </g>
            );
          }

          return (
            (() => {
              const chamferPx = chamferStrokePxFor();
              const isCut = (shape.cutType ?? "Cut") === "Cut";
              const chamferStroke = isCut && chamferPx > 0 ? chamferPx : 0;
              const baseStroke = isSelected ? 3 : 0;
              const totalStroke = baseStroke + chamferStroke;
              const strokeColor = isSelected ? "#ffff66" : (chamferStroke > 0 ? "#990000" : "none");
              return (
                <rect
                  key={shape.id}
                  x={xPx}
                  y={yPx}
                  width={wPx}
                  height={hPx}
                  transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                  fill={fillColorFor(shape)}
                  stroke={strokeColor}
                  strokeWidth={totalStroke}
                  className={"shape-rect" + (isSelected ? " shape-selected" : "")}
                  onMouseDown={startDragFor}
                />
              );
            })()
          );
        }

        if (shape.type === "oval") {
          const cx = shape.x * scaleX;
          const cy = boardPxHeight - shape.y * scaleY;
          const rotDeg = shape.rotateDeg ?? 0;
          const sectionRotRaw = shape.sectionRotation ?? 0;
          const fillAngle = -sectionRotRaw;
          const baseW = shape.widthMM ?? 20;
          const baseH = shape.heightMM ?? 20;
          const rx = (baseW * scaleX) / 2;
          const ry = (baseH * scaleY) / 2;

          // Section visualization for ovals - use clip paths with vertical strips
          if (shape.splitToSections && (shape.cutType ?? "Cut") === "Cut") {
            const sectionWidths = shape.sectionWidths ?? [20, 0];

            // Section colors: left, center, right
            const sectionColors = ['#ff6666', '#cc0000', '#ff3333'];

            // total width in pixels
            const totalW = baseW * scaleX;

            // Interpret sectionWidths[0] = center island width; sectionWidths[1] = offset from center
            const centerWidthMM = sectionWidths[0] ?? 20;
            const offsetMM = sectionWidths[1] ?? 0;
            const centerWidthPx = Math.min(centerWidthMM * scaleX, totalW);
            const offsetPx = offsetMM * scaleX;

            const leftEdge = cx - rx;
            // centerLeft = centered + offset, clamped
            let centerLeft = leftEdge + (totalW - centerWidthPx) / 2 + offsetPx;
            const minCenterLeft = leftEdge;
            const maxCenterLeft = leftEdge + totalW - centerWidthPx;
            if (centerLeft < minCenterLeft) centerLeft = minCenterLeft;
            if (centerLeft > maxCenterLeft) centerLeft = maxCenterLeft;

            const leftPx = Math.max(0, centerLeft - leftEdge);
            const midPx = centerWidthPx;
            const rightPx = Math.max(0, totalW - leftPx - midPx);

            const clipId = `oval-clip-${shape.id}`;

            return (
              <g key={shape.id} onMouseDown={startDragFor} transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}>
                <defs>
                  <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`} transform={rotDeg ? `rotate(${-rotDeg} ${cx} ${cy})` : undefined}>
                  {leftPx > 0 && (
                    <polygon
                      points={stripPolygonPoints(
                        cx,
                        cy,
                        leftEdge - cx - stripExtra(rx * 2, ry * 2),
                        leftEdge - cx + leftPx,
                        coverHalfHeight(rx * 2, ry * 2),
                        fillAngle
                      )}
                      fill={sectionColors[0]}
                    />
                  )}
                  {midPx > 0 && (
                    <polygon
                      points={stripPolygonPoints(
                        cx,
                        cy,
                        centerLeft - cx,
                        centerLeft - cx + midPx,
                        coverHalfHeight(rx * 2, ry * 2),
                        fillAngle
                      )}
                      fill={sectionColors[1]}
                    />
                  )}
                  {rightPx > 0 && (
                    <polygon
                      points={stripPolygonPoints(
                        cx,
                        cy,
                        centerLeft + midPx - cx,
                        centerLeft + midPx - cx + rightPx + stripExtra(rx * 2, ry * 2),
                        coverHalfHeight(rx * 2, ry * 2),
                        fillAngle
                      )}
                      fill={sectionColors[2]}
                    />
                  )}
                </g>
                {/* Chamfer preview outline (approx) */}
                { (board.chamferEnabled && ((shape.cutType ?? "Cut") === "Cut")) && (
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rx}
                    ry={ry}
                    transform={undefined}
                    fill="none"
                    stroke="#990000"
                    strokeOpacity={0.6}
                    strokeWidth={chamferStrokePxFor()}
                    pointerEvents="none"
                  />
                )}
                {/* Selection outline */}
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  transform={undefined}
                  fill="none"
                  stroke={isSelected ? "#ffff66" : "none"}
                  strokeWidth={isSelected ? 3 : 0}
                />
              </g>
            );
          }

          return (
            (() => {
              const chamferPx = chamferStrokePxFor();
              const isCut = (shape.cutType ?? "Cut") === "Cut";
              const chamferStroke = isCut && chamferPx > 0 ? chamferPx : 0;
              const baseStroke = isSelected ? 3 : 0;
              const totalStroke = baseStroke + chamferStroke;
              const strokeColor = isSelected ? "#ffff66" : (chamferStroke > 0 ? "#990000" : "none");
              return (
                <ellipse
                  key={shape.id}
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                  fill={fillColorFor(shape)}
                  stroke={strokeColor}
                  strokeWidth={totalStroke}
                  className={"shape-oval" + (isSelected ? " shape-selected" : "")}
                  onMouseDown={startDragFor}
                />
              );
            })()
          );
        }

        if (shape.type === "dxf") {
          const s = shape.scale ?? 1;
          const centerXpx = shape.x * scaleX;
          const centerYpx = boardPxHeight - shape.y * scaleY;
          const hasPaths = shape.dxfPaths && shape.dxfPaths.length > 0;
          const baseRotation = shape.rotateDeg ?? 0;
          const sectionRotRaw = (shape.splitToSections && (shape.cutType ?? "Cut") === "Cut") ? (shape.sectionRotation ?? 0) : 0;
          const fillAngle = -sectionRotRaw;
          return (
            <g
              key={shape.id}
              className="shape-dxf"
              transform={baseRotation ? `rotate(${baseRotation} ${centerXpx} ${centerYpx})` : undefined}
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

                    // Build absolute pixel coordinates for the polygon
                    const pts = path.map((p) => {
                      const px = centerXpx + p.x * s * scaleX;
                      const py = centerYpx - p.y * s * scaleY;
                      return { px, py };
                    });
                    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.px} ${p.py}`).join(" ") + " Z";

                    // If this is a hole, render as a normal path outline (no section fills)
                    const baseStrokeColor = isSelected ? "#ffff66" : (shape.splitToSections ? "#ffcc00" : "#ffaaaa");
                    const baseStrokeW = isSelected ? 3 : (shape.splitToSections ? 2 : 1);
                    const chamferPx = chamferStrokePxFor();
                    const isCutShape = (shape.cutType ?? "Cut") === "Cut";
                    const strokeColor = isSelected ? "#ffff66" : (isCutShape && chamferPx > 0 ? "#990000" : baseStrokeColor);
                    const strokeW = baseStrokeW + (isCutShape ? chamferPx : 0);
                    if (isHole || !(shape.splitToSections && isCutShape)) {
                      return (
                        <path
                          key={idx}
                          d={d}
                          fill={isHole ? 'none' : fillColorFor(shape)}
                          stroke={strokeColor}
                          strokeWidth={strokeW}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      );
                    }

                    // For sectioned DXF shapes: draw three left-to-right strips clipped to the polygon
                    const xs = pts.map((p) => p.px);
                    const ys = pts.map((p) => p.py);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    const totalW = Math.max(0, maxX - minX);
                    const totalH = Math.max(0, maxY - minY);

                    // sectionWidths[0] = center island width, sectionWidths[1] = offset from center
                    const centerWmm = (shape.sectionWidths && shape.sectionWidths.length > 0) ? shape.sectionWidths[0] : 20;
                    const offsetMm = (shape.sectionWidths && shape.sectionWidths.length > 1) ? shape.sectionWidths[1] : 0;
                    // Section widths/offsets should not scale with DXF shape scale
                    const centerPx = Math.min(centerWmm * scaleX, totalW);
                    const offsetPx = offsetMm * scaleX;

                    let centerLeft = minX + (totalW - centerPx) / 2 + offsetPx;
                    const minCenterLeft = minX;
                    const maxCenterLeft = minX + totalW - centerPx;
                    if (centerLeft < minCenterLeft) centerLeft = minCenterLeft;
                    if (centerLeft > maxCenterLeft) centerLeft = maxCenterLeft;

                    const leftPxW = Math.max(0, centerLeft - minX);
                    const rightPxW = Math.max(0, minX + totalW - (centerLeft + centerPx));

                    const clipId = `dxf-clip-${shape.id}-${idx}`;
                    const sectionColors = ['#ff6666', '#cc0000', '#ff3333'];

                    return (
                      <g key={idx}>
                        <defs>
                          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                            <path d={d} transform={baseRotation ? `rotate(${baseRotation} ${centerXpx} ${centerYpx})` : undefined} />
                          </clipPath>
                        </defs>
                        <g clipPath={`url(#${clipId})`} transform={baseRotation ? `rotate(${-baseRotation} ${centerXpx} ${centerYpx})` : undefined}>
                          {leftPxW > 0 && (
                            <polygon
                              points={stripPolygonPoints(
                                centerXpx,
                                centerYpx,
                                minX - centerXpx - stripExtra(totalW, totalH),
                                minX - centerXpx + leftPxW,
                                coverHalfHeight(totalW, totalH),
                                fillAngle
                              )}
                              fill={sectionColors[0]}
                            />
                          )}
                          <polygon
                            points={stripPolygonPoints(
                              centerXpx,
                              centerYpx,
                              centerLeft - centerXpx,
                              centerLeft - centerXpx + centerPx,
                              coverHalfHeight(totalW, totalH),
                              fillAngle
                            )}
                            fill={sectionColors[1]}
                          />
                          {rightPxW > 0 && (
                            <polygon
                              points={stripPolygonPoints(
                                centerXpx,
                                centerYpx,
                                centerLeft + centerPx - centerXpx,
                                centerLeft + centerPx - centerXpx + rightPxW + stripExtra(totalW, totalH),
                                coverHalfHeight(totalW, totalH),
                                fillAngle
                              )}
                              fill={sectionColors[2]}
                            />
                          )}
                        </g>
                        {/* Outline on top */}
                        <path
                          d={d}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={strokeW}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </g>
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
                      {(() => {
                        const chamferPx = chamferStrokePxFor();
                        const isCut = (shape.cutType ?? "Cut") === "Cut";
                        const chamferStroke = isCut && chamferPx > 0 ? chamferPx : 0;
                        const baseStroke = isSelected ? 2 : 1;
                        const totalStroke = baseStroke + chamferStroke;
                        const strokeColor = isSelected ? "#ff6666" : (chamferStroke > 0 ? "#990000" : "#ffaaaa");
                        return (
                          <rect x={xPx} y={yPx} width={wPx} height={hPx} fill="#ffaaaa33" stroke={strokeColor} strokeWidth={totalStroke} />
                        );
                      })()}
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
              // If we have vector paths we rotate points in-place when
              // constructing the `d` attribute. In that case, avoid applying
              // an additional group-level transform which would double-rotate
              // the glyphs. For fallback text (no dxfPaths) keep the group
              // transform so placeholders still rotate visually.
              transform={hasPaths ? undefined : (rotDeg ? `rotate(${rotDeg} ${centerXpx} ${centerYpx})` : undefined)}
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
                // Focus the text input and select all text so typing or
                // backspace/ delete will replace the entire value.
                setTimeout(() => {
                  const el = textInputRef.current as HTMLInputElement | null;
                  if (el) {
                    el.focus();
                    try {
                      el.select();
                    } catch {
                      // ignore selection errors in older browsers
                    }
                  }
                }, 0);
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

                  // When rendering vectorized text, rotate each glyph polyline
                  // in-place around the stored centroid using shape.rotateDeg
                  // rather than relying on a group-level transform. This avoids
                  // mismatches where the bounding box is rotated but the glyph
                  // geometry appears unrotated after re-vectorization.
                  const rotDeg = shape.rotateDeg ?? 0;
                  return paths.map((path, idx) => {
                    if (!path || !path.length) return null;
                    const isHole = !!holeFlags[idx];
                    // When splitToSections is enabled, use a darker fill to indicate sections
                    let fill = isHole ? 'rgba(0, 0, 0, 1)' : fillColorFor(shape);
                    if (!isHole && shape.splitToSections && (shape.cutType ?? "Cut") === "Cut") {
                      fill = '#cc0000'; // Darker red to indicate sectioned
                    }
                    const d = path.map((p: { x: number; y: number }, i: number) => {
                      // rotate the local point (p.x/p.y are relative to centroid)
                      // Use negated angle to match SVG/group rotation direction
                      // (canvas Y axis is inverted vs. math Y axis).
                      const theta = (-rotDeg * Math.PI) / 180.0;
                      const cosr = Math.cos(theta);
                      const sinr = Math.sin(theta);
                      const rx = p.x * cosr - p.y * sinr;
                      const ry = p.x * sinr + p.y * cosr;
                      const px = centerXpx + rx * s * scaleX;
                      const py = centerYpx - ry * s * scaleY;
                      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
                    }).join(" ") + " Z";

                    // Add dashed stroke to indicate sections are enabled
                    const strokeStyle = shape.splitToSections && (shape.cutType ?? "Cut") === "Cut" 
                      ? { strokeDasharray: "4 2" } 
                      : {};

                    return (
                      <path
                        key={idx}
                        d={d}
                        fill={fill}
                        fillOpacity={shape.cutType === "Raised" ? 1 : 1}
                        stroke={isSelected ? "#ffff66" : (shape.splitToSections ? "#ffcc00" : "#ffaaaa")}
                        strokeWidth={isSelected ? 3 : (shape.splitToSections ? 2 : 1)}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        {...strokeStyle}
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
        const cursorForDirWorld = (dx: number, dy: number) => {
          // World/math axes (y-up). Normalize to [0,180)
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          const a = ((ang % 180) + 180) % 180;
          if (a < 22.5 || a >= 157.5) return 'ew-resize';
          if (a >= 67.5 && a < 112.5) return 'ns-resize';
          const sameSign = (dx >= 0 && dy >= 0) || (dx < 0 && dy < 0);
          return sameSign ? 'nwse-resize' : 'nesw-resize';
        };

        // Unified rotation: world coords are y-up; SVG applies positive angles clockwise.
        // Use a single rotRadUsed for all conversions.
        const rotRadUsed = ((s.rotateDeg ?? 0) * Math.PI) / 180;
        const rotateUsed = (v: { x: number; y: number }) => ({
          x: v.x * Math.cos(rotRadUsed) - v.y * Math.sin(rotRadUsed),
          y: v.x * Math.sin(rotRadUsed) + v.y * Math.cos(rotRadUsed),
        });

        // Base local axes (width, height)
        const uX = { x: 1, y: 0 }; // +width direction
        const uY = { x: 0, y: 1 }; // +height direction (matches edge handles)
        const norm = (v: { x: number; y: number }) => {
          const m = Math.hypot(v.x, v.y) || 1;
          return { x: v.x / m, y: v.y / m };
        };

        const localDirs: Record<string, { x: number; y: number }> = {
          e: uX,
          w: { x: -uX.x, y: -uX.y },
          n: uY,
          s: { x: -uY.x, y: -uY.y },
          ne: norm({ x: uX.x - uY.x, y: uX.y - uY.y }),
          nw: norm({ x: -uX.x - uY.x, y: -uX.y - uY.y }),
          se: norm({ x: uX.x + uY.x, y: uX.y + uY.y }),
          sw: norm({ x: -uX.x + uY.x, y: -uX.y + uY.y }),
        };

        const handles: Array<{ name: string; p: { x: number; y: number }; cursor: string; dir: { x: number; y: number } }> = [
          (() => { const world = rotateUsed(localDirs.nw); return { name: 'nw', p: nw, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.n); return { name: 'n', p: n, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.ne); return { name: 'ne', p: ne, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.e); return { name: 'e', p: e, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.se); return { name: 'se', p: se, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.s); return { name: 's', p: spt, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.sw); return { name: 'sw', p: sw, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
          (() => { const world = rotateUsed(localDirs.w); return { name: 'w', p: w, dir: world, cursor: cursorForDirWorld(world.x, world.y) }; })(),
        ];
        const sizePx = 8;
        return (
          <g pointerEvents="all">
            {handles.map((h) => {
              const xPx = h.p.x * scaleX - sizePx / 2;
              const yPx = boardPxHeight - h.p.y * scaleY - sizePx / 2;
              const centerPx = { x: xPx + sizePx / 2, y: yPx + sizePx / 2 };
              // Compute endpoints in world space using true world dir, then project to px
              const halfLenWorld = (sizePx * 0.4) / Math.max(scaleX, scaleY);
              const p1World = { x: h.p.x + h.dir.x * halfLenWorld, y: h.p.y + h.dir.y * halfLenWorld };
              const p2World = { x: h.p.x - h.dir.x * halfLenWorld, y: h.p.y - h.dir.y * halfLenWorld };
              const toPx = (p: { x: number; y: number }) => ({ x: p.x * scaleX, y: boardPxHeight - p.y * scaleY });
              const p1Px = toPx(p1World);
              const p2Px = toPx(p2World);
              return (
                <g key={h.name} pointerEvents="all">
                  <rect
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
                      const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
                      let startPt = { x: h.p.x, y: h.p.y };
                      if (svg) {
                        const pt = svg.createSVGPoint();
                        pt.x = e.clientX;
                        pt.y = e.clientY;
                        const ctm = svg.getScreenCTM();
                        const svgPt = ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
                        startPt = { x: svgPt.x / scaleX, y: (boardPxHeight - svgPt.y) / scaleY };
                      }
                      resizingRef.current = { id, handle: h.name, startShape: { ...s }, startPointer: startPt };
                      // prevent interfering with drag
                      setDraggingId(null);
                      setDragOffset(null);
                      gestureHistoryPushedRef.current = false;
                      setHoverHandle(null);
                    }}
                    onMouseEnter={() => setHoverHandle(h.name)}
                    onMouseLeave={() => setHoverHandle((curr) => (curr === h.name ? null : curr))}
                  />
                  {/* Hover glyph: draw oriented line using true worldDir (continuous, unsnapped) */}
                  {hoverHandle === h.name ? (
                    <line
                      x1={p1Px.x}
                      y1={p1Px.y}
                      x2={p2Px.x}
                      y2={p2Px.y}
                      stroke="#666666"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })() : null}
      {bboxRect}
    </svg>
  );
}
