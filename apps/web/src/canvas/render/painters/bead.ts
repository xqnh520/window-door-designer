import Konva from 'konva';
import type { TreeRenderElement } from '@wdd/core';

export interface BeadPainterColors {
  sash: string;
  glass: string;
  screen: string;
}

export interface BeadPainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  insetMm: number;
  colors: BeadPainterColors;
}

export function paintSashBead(context: BeadPainterContext): void {
  paintBead(context, context.colors.glass);
}

export function paintScreenBead(context: BeadPainterContext): void {
  paintBead(context, context.colors.screen);
}

export function paintPanelBead(context: BeadPainterContext): void {
  paintBead(context, '#e5d3b3');
}

function paintBead({ group, element, colors, insetMm }: BeadPainterContext, fill: string): void {
  const width = Math.max(3, insetMm * 0.35);
  barRing(group, 0, 0, element.w, element.h, width, colors.sash);
  glassPane(group, width, width, element.w - 2 * width, element.h - 2 * width, fill);
  const line = (points: number[]): void => {
    group.add(new Konva.Line({ points, stroke: 'rgba(255,255,255,0.55)', strokeWidth: 1, listening: false }));
  };
  line([width, width, element.w - width, width]);
  line([width, element.h - width, element.w - width, element.h - width]);
  line([width, width, width, element.h - width]);
  line([element.w - width, width, element.w - width, element.h - width]);
}

function glassPane(group: Konva.Group, x: number, y: number, w: number, h: number, fill: string): void {
  group.add(new Konva.Rect({
    x,
    y,
    width: Math.max(1, w),
    height: Math.max(1, h),
    fill,
    stroke: 'rgba(0,0,0,0.4)',
    strokeWidth: 1,
    strokeScaleEnabled: false,
    listening: false,
  }));
}

function barRing(group: Konva.Group, x: number, y: number, w: number, h: number, width: number, fill: string): void {
  const stroke = 'rgba(0,0,0,0.45)';
  const b = Math.max(1, width);
  if (b * 2 >= w || b * 2 >= h) {
    group.add(new Konva.Rect({ x, y, width: Math.max(1, w), height: Math.max(1, h), fill, stroke, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
    return;
  }
  const bars: [number, number, number, number][] = [
    [x, y, w, b],
    [x, y + h - b, w, b],
    [x, y + b, b, h - 2 * b],
    [x + w - b, y + b, b, h - 2 * b],
  ];
  for (const [bx, by, bw, bh] of bars) {
    group.add(new Konva.Rect({ x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh), fill, stroke, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
  }
}
