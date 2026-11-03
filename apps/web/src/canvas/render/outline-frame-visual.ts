import { bBoxOf, insetPolygon, type Pt } from '@wdd/core';

export type OutlineFrameEdge = 'top' | 'bottom' | 'left' | 'right';

export interface OutlineFrameEdgeBand {
  x: number;
  y: number;
  w: number;
  h: number;
  edge: OutlineFrameEdge;
}

/**
 * 异形外框在当前 Web renderer 中的纯视觉描述。
 *
 * 这里允许读取 core 的通用多边形算法，但不依赖 Konva，也不反向修改 WindowTree。
 * beadWidthMm 与 edgeBands 都是当前画布的视觉/交互策略，因此不进入业务模型。
 */
export interface OutlineFrameVisual {
  outerPoints: number[];
  innerPoints: number[];
  beadCenterPoints: number[];
  beadInnerPoints: number[];
  beadWidthMm: number;
  edgeBands: OutlineFrameEdgeBand[];
}

const toPoints = (flat: number[]): Pt[] => {
  const points: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
  return points;
};

const flatten = (points: Pt[]): number[] => points.flatMap((point) => [point.x, point.y]);

export function describeOutlineFrameVisual(
  flatPoints: number[],
  frameWidthMm: number,
  beadWidthMm: number,
): OutlineFrameVisual {
  const outer = toPoints(flatPoints);
  const frameWidth = Math.max(1, frameWidthMm);
  const inner = insetPolygon(outer, frameWidth);
  const innerBox = bBoxOf(inner);
  const beadWidth = Math.max(1, Math.min(beadWidthMm, Math.min(innerBox.w, innerBox.h) / 2));
  const outerBox = bBoxOf(outer);

  return {
    outerPoints: [...flatPoints],
    innerPoints: flatten(inner),
    beadCenterPoints: flatten(insetPolygon(inner, beadWidth / 2)),
    beadInnerPoints: flatten(insetPolygon(inner, beadWidth)),
    beadWidthMm: beadWidth,
    edgeBands: [
      { x: outerBox.x, y: outerBox.y, w: outerBox.w, h: frameWidth, edge: 'top' },
      { x: outerBox.x, y: outerBox.y + outerBox.h - frameWidth, w: outerBox.w, h: frameWidth, edge: 'bottom' },
      { x: outerBox.x, y: outerBox.y, w: frameWidth, h: outerBox.h, edge: 'left' },
      { x: outerBox.x + outerBox.w - frameWidth, y: outerBox.y, w: frameWidth, h: outerBox.h, edge: 'right' },
    ],
  };
}
