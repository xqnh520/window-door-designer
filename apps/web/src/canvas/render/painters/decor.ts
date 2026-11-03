import Konva from 'konva';
import type { TreeRenderElement } from '@wdd/core';

export interface DecorPainterColors {
  glass: string;
  sash: string;
  screen: string;
}

export interface DecorPainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  colors: DecorPainterColors;
}

/** 装饰条和中梃的视觉实现；不解释或修改业务模型。 */
export function paintDecorBar({ group, element, colors }: DecorPainterContext): void {
  glassPane(group, 0, 0, element.w, element.h, colors.glass, true);
  const cell = Math.max(6, Math.min(element.w, element.h) * 0.06);
  const cols = element.w >= element.h * 1.4 ? 3 : 2;
  for (let i = 1; i < cols; i++) {
    group.add(new Konva.Rect({ x: (element.w / cols) * i - cell / 2, y: 0, width: cell, height: element.h, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
  }
  group.add(new Konva.Rect({ x: 0, y: element.h / 2 - cell / 2, width: element.w, height: cell, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
}

export function paintFakeMullion({ group, element, colors }: DecorPainterContext): void {
  glassPane(group, 0, 0, element.w, element.h, colors.glass, true);
  const height = Math.max(10, element.h * 0.15);
  group.add(new Konva.Rect({ x: 0, y: height / 2, width: element.w, height, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
}

export function paintSashMullion({ group, element, colors }: DecorPainterContext): void {
  const width = mullionWidth(element);
  glassPane(group, 0, 0, element.w, element.h, colors.glass, false);
  group.add(new Konva.Rect({ x: element.w / 2 - width / 2, y: 0, width, height: element.h, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
}

export function paintScreenMullion({ group, element, colors }: DecorPainterContext): void {
  const width = mullionWidth(element);
  glassPane(group, 0, 0, element.w, element.h, colors.screen, false);
  group.add(new Konva.Rect({ x: element.w / 2 - width / 2, y: 0, width, height: element.h, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
}

function mullionWidth(element: TreeRenderElement): number {
  const band = Math.max(10, Math.min(element.w, element.h) * 0.12);
  return Math.max(5, band * 0.7);
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

function shade(hex: string, factor: number): string {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const value = parseInt(normalized, 16);
  const r = Math.min(255, Math.max(0, (value >> 16) + Math.round(255 * factor)));
  const g = Math.min(255, Math.max(0, ((value >> 8) & 0xff) + Math.round(255 * factor)));
  const b = Math.min(255, Math.max(0, (value & 0xff) + Math.round(255 * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
