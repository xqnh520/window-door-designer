import Konva from 'konva';
import type { TreeRenderElement } from '@wdd/core';

export interface FoldPainterColors {
  sash: string;
  glass: string;
  screen: string;
}

export interface FoldPainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  insetMm: number;
  colors: FoldPainterColors;
}

export function paintFoldSash(context: FoldPainterContext): void {
  paintFoldPages(context, false);
}

export function paintFoldScreen(context: FoldPainterContext): void {
  paintFoldPages(context, true);
}

function paintFoldPages({ group, element, colors, insetMm }: FoldPainterContext, screen: boolean): void {
  const pages = 4;
  const pageWidth = element.w / pages;
  const hingeWidth = Math.max(2, Math.min(4, insetMm * 0.25));
  for (let page = 0; page < pages; page++) {
    const x = pageWidth * page;
    const contentWidth = pageWidth - 2 * insetMm;
    group.add(new Konva.Line({
      points: [x, 0, x + pageWidth, 0, x + pageWidth, element.h, x, element.h],
      closed: true,
      fill: colors.sash,
      stroke: 'rgba(0,0,0,0.2)',
      strokeWidth: 1,
      listening: false,
    }));
    if (contentWidth > 4 && element.h > 2 * insetMm) {
      glassPane(group, x + insetMm, insetMm, contentWidth, element.h - 2 * insetMm, screen ? colors.screen : colors.glass);
    }
    if (page > 0) {
      group.add(new Konva.Line({ points: [x, insetMm, x, element.h - insetMm], stroke: '#555', strokeWidth: hingeWidth, listening: false }));
    }
  }
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

function shade(hex: string, factor: number): string {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const value = parseInt(normalized, 16);
  const r = Math.min(255, Math.max(0, (value >> 16) + Math.round(255 * factor)));
  const g = Math.min(255, Math.max(0, ((value >> 8) & 0xff) + Math.round(255 * factor)));
  const b = Math.min(255, Math.max(0, (value & 0xff) + Math.round(255 * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
