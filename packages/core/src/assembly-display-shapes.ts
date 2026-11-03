import type { SeriesSpec } from '@wdd/schema';
import { DEFAULT_INSTALL_GAP_MM } from './defaults.js';
import type { LegacyShape } from './legacy-shapes.js';
import { sampleOutline, type FrameShape, type Pt } from './outline.js';
import { layoutAssembly, type WindowAssembly } from './window-assembly.js';
import { applyPlacement, transformBox, type UnitPlacement } from './window-assembly-corner.js';
import { describeWindowTree, type TreeRenderElement } from './window-tree-describe.js';
import { meetingWidthOf, sashLeafRects, sashLeavesOf, type WindowTree } from './window-tree.js';

/**
 * 容器树 / 装配体 → 旧 shapes 的单向边界投影（3D 与 CRM 兼容输出消费）。
 *
 * 空间纪律：
 * - `treeToShapes` 产出**加工空间（展开态）**图形，喂 BOM/CRM 兼容输出；
 * - `assemblyToShapes` 默认按 layoutAssembly 的 placement/combinerPlacement 把每个单元/拼樘
 *   搬到**显示空间**（与 2D 渲染完全同一变换），供 3D 预览；
 * - 180° 直线装配的 placement 恒等，输出与 M1b 逐字段一致。
 *
 * 返回值不是业务状态，禁止写回 store。
 */
const INSTALL_GAP = DEFAULT_INSTALL_GAP_MM;

export interface AssemblyShapeOptions {
  /** 'display'（默认）= 应用转角显示变换；'processing' = 展开态（CRM 兼容输出沿用） */
  space?: 'display' | 'processing';
}

export function treeToShapes(tree: WindowTree, _series?: SeriesSpec): LegacyShape[] {
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

export function assemblyToShapes(
  a: WindowAssembly,
  series?: SeriesSpec,
  opts: AssemblyShapeOptions = {},
): LegacyShape[] {
  const space = opts.space ?? 'display';
  const out: LegacyShape[] = [];
  const layout = layoutAssembly(a, { installGap: INSTALL_GAP });
  for (const u of a.units) {
    const baked = layout.trees.get(u.id);
    if (!baked) continue;
    const placement = space === 'display' ? layout.placement.get(u.id) : undefined;
    for (const s of treeToShapes(baked, series)) {
      const projected = placement ? transformShapeForDisplay(s, placement) : s;
      out.push({ ...projected, id: `${u.id}__${s.id}` });
    }
  }
  for (const c of a.combiners) {
    const r = layout.combiners.get(c.id);
    if (!r) continue;
    const vertical = r.h >= r.w;
    const shape: LegacyShape = {
      id: c.id,
      type: 'line',
      bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
      topRatio: 1,
      p1: vertical ? { x: r.x + r.w / 2, y: r.y } : { x: r.x, y: r.y + r.h / 2 },
      p2: vertical ? { x: r.x + r.w / 2, y: r.y + r.h } : { x: r.x + r.w, y: r.y + r.h / 2 },
      widthMm: c.thicknessMm,
      text: '',
      componentKind: 'mullion',
      materialRole: 'mullion',
      windowType: 'fixed',
    };
    const placement = space === 'display' ? layout.combinerPlacement.get(c.id) : undefined;
    out.push(placement ? transformShapeForDisplay(shape, placement) : shape);
  }
  return out;
}

export function assemblySize(a: WindowAssembly): { w: number; h: number } {
  const bb = layoutAssembly(a, { installGap: INSTALL_GAP }).displayBbox;
  return { w: Math.round(bb.x + bb.w + INSTALL_GAP), h: Math.round(bb.y + bb.h + INSTALL_GAP) };
}

/** 是否为恒等显示变换（180° / 单单元）：恒等时原样返回，保证旧行为逐字段不变 */
export function isIdentityPlacement(p: UnitPlacement): boolean {
  return p.rotationDeg === 0 && p.translate.x === 0 && p.translate.y === 0;
}

/**
 * 加工空间图形 → 显示空间：与 2D 的 placeNode 同一变换 f(p)=R·p+t。
 * - 轮廓点 / 中梃端点全部变换；
 * - 旋转后的矩形/异形框转成真实四边形/多边形轮廓（bbox 只作外接）；
 * - 弧梃保留 sagittaMm（旋转不改变弦与弧的相对关系）。
 */
export function transformShapeForDisplay(s: LegacyShape, p: UnitPlacement): LegacyShape {
  if (isIdentityPlacement(p)) return s;

  const sourceContour = processingContour(s);
  const contour = sourceContour?.map((pt) => roundPoint(applyPlacement(p, pt)));
  const out: LegacyShape = {
    ...s,
    bbox: contour ? roundBox(aabbOf(contour)) : roundBox(transformBox(p, s.bbox)),
  };
  if (contour) out.contour = contour;
  if (s.p1) out.p1 = roundPoint(applyPlacement(p, s.p1));
  if (s.p2) out.p2 = roundPoint(applyPlacement(p, s.p2));
  return out;
}

/** 加工空间轮廓：已有轮廓优先；矩形取四角；异形框按形状采样；直线/文字没有面轮廓 */
function processingContour(s: LegacyShape): Pt[] | undefined {
  if (s.contour && s.contour.length >= 3) return s.contour;
  if (s.type === 'line' || s.type === 'text') return undefined;
  if (s.type === 'rect') {
    const b = s.bbox;
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ];
  }
  return sampleOutline(s.type as FrameShape, s.bbox, { inset: 0, topRatio: s.topRatio });
}

function aabbOf(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of pts) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function roundPoint(p: Pt): Pt {
  return { x: round(p.x), y: round(p.y) };
}

function roundBox(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
