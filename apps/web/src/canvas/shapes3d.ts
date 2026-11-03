import type { SeriesSpec } from '@wdd/schema';
import type { WindowTree, WindowAssembly, Pt, TreeRenderElement } from '@wdd/core';
import { DEFAULT_INSTALL_GAP_MM, describeWindowTree, layoutAssembly, meetingWidthOf, sashLeavesOf, sashLeafRects } from '@wdd/core';
import type { LegacyShape } from './legacyShape';

/**
 * 容器树到旧 shapes 的单向边界投影。
 *
 * 只供 3D 与 CRM 兼容输出消费；返回值不是业务状态，禁止写回 store。
 */
const INSTALL_GAP = DEFAULT_INSTALL_GAP_MM;

export function treeToShapes(tree: WindowTree, _series: SeriesSpec): LegacyShape[] {
  const shapes: LegacyShape[] = [];
  let seq = 0;

  for (const el of describeWindowTree(tree, INSTALL_GAP)) {
    const bbox = { x: el.x, y: el.y, w: el.w, h: el.h };
    if (el.kind === 'frame') {
      const shapeType = el.shape && el.shape !== 'rect' ? el.shape : 'rect';
      shapes.push({
        id: `sh-frame-${++seq}`,
        type: shapeType as LegacyShape['type'],
        bbox,
        topRatio: String(shapeType).startsWith('trapezoid') ? (tree.topRatio ?? 0.6) : 1,
        text: '',
        componentKind: 'outerFrame',
        materialRole: 'frame',
        windowType: 'fixed',
      });
      continue;
    }
    if (el.kind === 'muntin') {
      const vertical = el.h >= el.w;
      const ends: [{ x: number; y: number }, { x: number; y: number }] = el.slope
        ? el.slope === 'diagonal'
          ? [{ x: el.x, y: el.y }, { x: el.x + el.w, y: el.y + el.h }]
          : [{ x: el.x, y: el.y + el.h }, { x: el.x + el.w, y: el.y }]
        : vertical
          ? [{ x: el.x + el.w / 2, y: el.y }, { x: el.x + el.w / 2, y: el.y + el.h }]
          : [{ x: el.x, y: el.y + el.h / 2 }, { x: el.x + el.w, y: el.y + el.h / 2 }];
      shapes.push({
        id: `sh-mullion-${++seq}`,
        type: 'line',
        bbox,
        topRatio: 1,
        p1: ends[0],
        p2: ends[1],
        widthMm: el.thicknessMm,
        curve: el.sagittaMm ? { sagittaMm: el.sagittaMm } : undefined,
        text: '',
        componentKind: 'mullion',
        materialRole: 'mullion',
        windowType: 'fixed',
      });
      continue;
    }

    const sash = el.sash;
    if (!sash) continue;
    const contour = absoluteContour(el);
    const leaves = sashLeavesOf(sash) === 2 && !contour
      ? sashLeafRects(el.w, el.h, 2, meetingWidthOf(tree))
      : [];
    if (leaves.length === 2) {
      leaves.forEach((leaf, i) => {
        shapes.push({
          id: `sh-panel-${++seq}`,
          type: 'rect',
          bbox: { x: Math.round(el.x + leaf.x), y: Math.round(el.y + leaf.y), w: Math.round(leaf.w), h: Math.round(leaf.h) },
          topRatio: 1,
          text: `${sash.label ?? ''}${i + 1}`,
          label: `${sash.label ?? ''}${i + 1}`,
          side: leaf.hinge,
          openDir: sash.openDirection,
          componentKind: kindOf(sash.windowType),
          materialRole: roleOf(sash.windowType),
          windowType: sash.windowType === 'screen' ? undefined : sash.windowType,
        });
      });
      continue;
    }
    shapes.push({
      id: `sh-panel-${++seq}`,
      type: 'rect',
      bbox,
      topRatio: 1,
      contour,
      text: sash.label ?? '',
      label: sash.label,
      side: sash.hingeSide === 'right' ? 'right' : sash.hingeSide === 'left' ? 'left' : undefined,
      openDir: sash.openDirection,
      componentKind: kindOf(sash.windowType),
      materialRole: roleOf(sash.windowType),
      windowType: sash.windowType === 'screen' ? undefined : sash.windowType,
    });
  }
  return shapes;
}

export function assemblyToShapes(a: WindowAssembly, series: SeriesSpec): LegacyShape[] {
  const out: LegacyShape[] = [];
  const layout = layoutAssembly(a, { installGap: INSTALL_GAP });
  for (const u of a.units) {
    const baked = layout.trees.get(u.id);
    if (!baked) continue;
    for (const s of treeToShapes(baked, series)) out.push({ ...s, id: `${u.id}__${s.id}` });
  }
  for (const c of a.combiners) {
    const r = layout.combiners.get(c.id);
    if (!r) continue;
    const vertical = r.h >= r.w;
    out.push({
      id: c.id,
      type: 'line',
      bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
      topRatio: 1,
      p1: vertical ? { x: r.x + r.w / 2, y: r.y } : { x: r.x, y: r.y + r.h / 2 },
      p2: vertical ? { x: r.x + r.w / 2, y: r.y + r.h } : { x: r.x + r.w, y: r.y + r.h / 2 },
      text: '',
      componentKind: 'mullion',
      materialRole: 'mullion',
      windowType: 'fixed',
    });
  }
  return out;
}

export function assemblySize(a: WindowAssembly): { w: number; h: number } {
  const bb = layoutAssembly(a, { installGap: INSTALL_GAP }).bbox;
  return { w: Math.round(bb.x + bb.w + INSTALL_GAP), h: Math.round(bb.y + bb.h + INSTALL_GAP) };
}

function absoluteContour(el: TreeRenderElement): Pt[] | undefined {
  const flat = el.points;
  if (!flat || flat.length < 6) return undefined;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i] + el.x, y: flat[i + 1] + el.y });
  return pts.length >= 3 ? pts : undefined;
}

function kindOf(type: string): 'fixedGlass' | 'casementSash' | 'slidingSash' | 'topHungSash' | 'screen' {
  switch (type) {
    case 'casement':
    case 'casementUp':
    case 'tiltSlide':
      return 'casementSash';
    case 'sliding':
      return 'slidingSash';
    case 'topHinged':
      return 'topHungSash';
    case 'screen':
      return 'screen';
    default:
      return 'fixedGlass';
  }
}

function roleOf(type: string): string {
  switch (type) {
    case 'casement':
    case 'casementUp':
    case 'tiltSlide':
    case 'sliding':
    case 'topHinged':
      return 'sash';
    case 'screen':
      return 'screen';
    default:
      return 'glass';
  }
}
