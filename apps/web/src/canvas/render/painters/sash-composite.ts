import Konva from 'konva';
import type { TreeRenderElement } from '@wdd/core';

export interface SashCompositePainterColors {
  glass: string;
  sash: string;
}

export interface SashCompositePainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  insetMm: number;
  colors: SashCompositePainterColors;
}

/** 复合扇的结构仅是 Web 视觉组合，业务几何仍来自 TreeRenderElement。 */
export function paintSubSash({ group, element, colors, insetMm }: SashCompositePainterContext): void {
  const smallW = element.w * 0.34;
  const smallH = element.h * 0.52;
  const x = element.w - insetMm - smallW;
  const y = element.h - insetMm - smallH;
  barRing(group, 0, 0, element.w, element.h, Math.max(6, insetMm * 0.8), colors.sash);
  glassPane(group, insetMm, insetMm, element.w - 2 * insetMm, element.h - 2 * insetMm, colors.glass);
  barRing(group, x, y, smallW, smallH, Math.max(4, insetMm * 0.6), colors.sash);
  glassPane(group, x + 4, y + 4, smallW - 8, smallH - 8, colors.glass);
}

export function paintSashInSash({ group, element, colors, insetMm }: SashCompositePainterContext): void {
  const width = element.w * 0.42;
  const height = element.h * 0.55;
  const x = element.w / 2 - width / 2;
  const y = element.h / 2 - height / 2;
  barRing(group, 0, 0, element.w, element.h, Math.max(6, insetMm * 0.8), colors.sash);
  glassPane(group, insetMm, insetMm, element.w - 2 * insetMm, element.h - 2 * insetMm, colors.glass);
  barRing(group, x, y, width, height, Math.max(5, insetMm * 0.7), colors.sash);
  glassPane(group, x + 5, y + 5, width - 10, height - 10, colors.glass);
}

export function paintPushIn({ group, element, colors, insetMm }: SashCompositePainterContext): void {
  const band = Math.max(10, Math.min(element.w, element.h) * 0.12);
  const cx = element.w / 2;
  const cy = element.h / 2;
  barRing(group, 0, 0, element.w, element.h, Math.max(6, insetMm * 0.8), colors.sash);
  glassPane(group, insetMm, insetMm, element.w - 2 * insetMm, element.h - 2 * insetMm, colors.glass);
  const line = (points: number[]): void => {
    group.add(new Konva.Line({ points, stroke: '#444', strokeWidth: 2.5, listening: false }));
  };
  line([cx, cy - band, cx, cy + band]);
  line([cx, cy - band, cx - band * 0.6, cy - band * 0.5]);
  line([cx, cy - band, cx + band * 0.6, cy - band * 0.5]);
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
    fillLinearGradientStartPoint: { x, y },
    fillLinearGradientEndPoint: { x, y: y + h },
    fillLinearGradientColorStops: [0, shade(fill, 0.06), 1, shade(fill, -0.05)],
  }));
}

function barRing(group: Konva.Group, x: number, y: number, w: number, h: number, width: number, fill: string): void {
  const stroke = 'rgba(0,0,0,0.45)';
  const bar = Math.max(1, width);
  if (bar * 2 >= w || bar * 2 >= h) {
    group.add(new Konva.Rect({ x, y, width: Math.max(1, w), height: Math.max(1, h), fill, stroke, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
    return;
  }
  const bars: [number, number, number, number][] = [
    [x, y, w, bar],
    [x, y + h - bar, w, bar],
    [x, y + bar, bar, h - 2 * bar],
    [x + w - bar, y + bar, bar, h - 2 * bar],
  ];
  for (const [barX, barY, barW, barH] of bars) {
    group.add(new Konva.Rect({ x: barX, y: barY, width: Math.max(1, barW), height: Math.max(1, barH), fill, stroke, strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
  }
}

function shade(hex: string, factor: number): string {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const value = parseInt(normalized, 16);
  const r = Math.min(255, Math.max(0, (value >> 16) + Math.round(255 * factor)));
  const g = Math.min(255, Math.max(0, ((value >> 8) & 0xff) + Math.round(255 * factor)));
  const b = Math.min(255, Math.max(0, (value & 0xff) + Math.round(255 * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
