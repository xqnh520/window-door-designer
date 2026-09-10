import type { SeriesSpec } from '@wdd/schema';
import type { WindowTree, WindowAssembly, Pt, TreeRenderElement } from '@wdd/core';
import { describeWindowTree, treeFromDesignModel, layoutAssembly, meetingWidthOf, sashLeavesOf, sashLeafRects } from '@wdd/core';
import type { DesignerStore, SketchShape } from '../store';
import { buildDesignModelFromShapes } from './designModelAdapter';

/**
 * 容器树 ↔ 传统画布图形 桥接（R4）：
 * - treeToShapes：树 → SketchShape[]（保存/CRM export 兼容旧格式）
 * - shapesToTree：旧画布图形 → 容器树（一键进入树设计模式）
 */

const INSTALL_GAP = 20;

export function treeToShapes(tree: WindowTree, _series: SeriesSpec): SketchShape[] {
  const shapes: SketchShape[] = [];
  let seq = 0;

  for (const el of describeWindowTree(tree, INSTALL_GAP)) {
    const bbox = { x: el.x, y: el.y, w: el.w, h: el.h };
    if (el.kind === 'frame') {
      const shapeType = el.shape && el.shape !== 'rect' ? el.shape : 'rect';
      shapes.push({
        id: `sh-frame-${++seq}`,
        type: shapeType as SketchShape['type'],
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
      // 中梃：按竖/横生成端点（3D 长条方向与 2D 一致）；斜梃取 bbox 对角两端
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
    // 叶子：有构件才输出
    const sash = el.sash;
    if (!sash) continue;
    const contour = absoluteContour(el);
    const leaves = sashLeavesOf(sash) === 2 && !contour
      ? sashLeafRects(el.w, el.h, 2, meetingWidthOf(tree))
      : [];
    if (leaves.length === 2) {
      // 对开扇：两片扇各出一个构件（中缝两根对开料重叠一段，3D 里就是两圈扇料）
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

/** 旧画布图形 → 容器树；无法识别外框时返回 null */
export function shapesToTree(shapes: SketchShape[], state: DesignerStore): WindowTree | null {
  const model = buildDesignModelFromShapes(shapes, state);
  if (!model) return null;
  const series = state.library.series.find((s) => s.id === model.seriesId) ?? state.library.series[0];
  return treeFromDesignModel(model, {
    installGap: INSTALL_GAP,
    name: model.name,
    seriesId: model.seriesId,
    glassId: model.glassId,
    frameWidthMm: series.frameWidth ?? 60,
  });
}

/**
 * 装配体 → 传统画布图形（外框拼接：供 3D 挤出管线与 CRM 方案保存复用旧格式）。
 * 逐单元烘焙绝对布局 → treeToShapes，重编 id 防冲突；拼樘料按布局矩形输出为中线直条（mullion 语义）。
 */
export function assemblyToShapes(a: WindowAssembly, series: SeriesSpec): SketchShape[] {
  const out: SketchShape[] = [];
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

/** 装配体总体尺寸（mm，四舍五入）：用于 3D 场景包围 */
export function assemblySize(a: WindowAssembly): { w: number; h: number } {
  const bb = layoutAssembly(a, { installGap: INSTALL_GAP }).bbox;
  return { w: Math.round(bb.x + bb.w + INSTALL_GAP), h: Math.round(bb.y + bb.h + INSTALL_GAP) };
}

/** 描述里的「局部扁平点序」→ 绝对坐标轮廓（少于 3 点视为无轮廓，走原 bbox 路径） */
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
      return 'sash';
    case 'sliding':
      return 'sash';
    case 'topHinged':
      return 'sash';
    case 'screen':
      return 'screen';
    default:
      return 'glass';
  }
}