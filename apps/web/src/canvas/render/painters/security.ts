import Konva from 'konva';
import type { Pt, TreeRenderElement } from '@wdd/core';

export interface SecurityPainterColors {
  glass: string;
  sash: string;
}

export interface SecurityPainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  colors: SecurityPainterColors;
  points?: Pt[];
}

/** 安防类构件仅将 core 的只读描述物化为 Konva 节点。 */
export function paintFrostedGlass({ group, element, colors }: SecurityPainterContext): void {
  glassPane(group, 0, 0, element.w, element.h, colors.glass, true);
  for (let x = -element.h; x < element.w + element.h; x += 16) {
    group.add(new Konva.Line({ points: [x, element.h, x + element.h, 0], stroke: 'rgba(160,190,200,0.35)', strokeWidth: 1, listening: false }));
  }
}

export function paintSecurityFrame({ group, element, colors }: SecurityPainterContext): void {
  glassPane(group, 0, 0, element.w, element.h, colors.glass, true);
  const band = Math.max(10, Math.min(element.w, element.h) * 0.12);
  const barW = band * 0.9;
  const cx = element.w / 2;
  barRing(group, 0, 0, element.w, element.h, barW, colors.sash);
  group.add(new Konva.Line({ points: [cx - barW / 2, barW, cx + barW / 2, barW, cx + barW / 2, element.h - barW, cx - barW / 2, element.h - barW], closed: true, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
  group.add(new Konva.Rect({ x: cx - 4, y: element.h / 2 - 4, width: 8, height: 8, fill: '#333', cornerRadius: 1, listening: false }));
}

export function paintSecurityBar({ group, element, colors }: SecurityPainterContext): void {
  glassPane(group, 0, 0, element.w, element.h, colors.glass, true);
  const band = Math.max(10, Math.min(element.w, element.h) * 0.12);
  const rod = Math.max(4, band * 0.5);
  const rows = Math.max(2, Math.round(element.h / 300));
  for (let i = 1; i <= rows; i++) {
    const y = (element.h / (rows + 1)) * i;
    group.add(new Konva.Rect({ x: 0, y: y - rod / 2, width: element.w, height: rod, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
  }
  group.add(new Konva.Rect({ x: element.w / 2 - rod / 2, y: 0, width: rod, height: element.h, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
}

export function paintWaterGuard({ group, element, colors, points }: SecurityPainterContext): void {
  const local = points ? flatOf(points) : [0, 0, element.w, 0, element.w, element.h, 0, element.h];
  group.add(new Konva.Line({ points: local, closed: true, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1, listening: false }));
  const height = Math.max(14, element.h * 0.2);
  group.add(new Konva.Rect({ x: 0, y: element.h - height, width: element.w, height, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
  group.add(new Konva.Line({ points: [0, element.h - height, element.w, element.h - height], stroke: '#fff', strokeWidth: 1.5, listening: false }));
}

function glassPane(group: Konva.Group, x: number, y: number, w: number, h: number, fill: string, gradient: boolean): void {
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
    ...(gradient
      ? {
          fillLinearGradientStartPoint: { x, y },
          fillLinearGradientEndPoint: { x, y: y + h },
          fillLinearGradientColorStops: [0, shade(fill, 0.06), 1, shade(fill, -0.05)],
        }
      : {}),
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

function flatOf(points: Pt[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
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
