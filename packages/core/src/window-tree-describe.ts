import type { FrameSide, GlassBarSpec, SashType, WindowSashSpec, WindowTree } from './window-tree.js';
import { walkAreas, layoutTree, layoutContours, frameOpenSidesOf, treeNeedsContours, slopeOf, meetingWidthOf, sashLeavesOf, louverPitchOf, sashInfillOf, panelHeightOf } from './window-tree.js';
import { sampleOutline, type FrameShape, type MuntinSlope, type Pt } from './outline.js';

/**
 * 容器树 → 渲染元素描述（纯数据，无 Konva 依赖，可测试）：
 * 每个逻辑节点产出一条描述（外框 / 中梃 / 叶子区域），携带几何与构件类型，
 * 供 Konva 物化层（window-tree-render）与画布交互层消费。
 */

export type TreeRenderElementType =
  | 'frame'
  | 'muntin'
  | 'combiner'
  | 'empty'
  | 'fixed'
  | 'casement'
  | 'casementUp'
  | 'tiltSlide'
  | 'sliding'
  | 'topHinged'
  | 'screen';

export interface TreeRenderElement {
  id: string;
  kind: 'frame' | 'muntin' | 'combiner' | 'area';
  type: TreeRenderElementType;
  /** 绝对几何（mm） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 外框料宽（mm，frame 元素专用，渲染四根独立框料） */
  frameWidthMm?: number;
  /** 异形外框形状（frame 元素专用；rect=矩形走原路径） */
  shape?: FrameShape;
  /** 外框缺边（frame 元素专用）：渲染时跳过这些边的框料 */
  openSides?: FrameSide[];
  /** 弧梃弧高（mm，muntin 元素专用；缺省=直梃） */
  sagittaMm?: number;
  /** 斜梃朝向（muntin 元素专用；缺省=轴对齐中梃） */
  slope?: MuntinSlope;
  /** 中梃料厚（mm，muntin 元素专用）：斜带的 bbox 看不出厚度，需显式给 */
  thicknessMm?: number;
  /** 对开扇中缝料（对开料）宽度（mm，仅 sash.leaves===2 时给出） */
  meetingWidthMm?: number;
  /** 百叶帘片间距（mm，仅 sash.infill==='louver' 时给出） */
  louverPitchMm?: number;
  /** 肯德基门下板高度（mm，仅 sash.infill==='panel' 时给出） */
  panelHeightMm?: number;
  /**
   * 轮廓多边形（**局部坐标**，相对本元素 x/y；扁平 [x0,y0,x1,y1,...]）。
   * 渲染层把 Group 定位到 (x,y) 后按局部坐标绘制，故此处必须已减去 (x,y)。
   * frame = 外轮廓（渲染层再内缩 frameWidth 得内腔）；area/muntin = 裁剪后的局部轮廓。
   */
  points?: number[];
  label?: string;
  sash?: WindowSashSpec;
  /** 玻璃格条（叶子分格） */
  bars?: GlassBarSpec;
}

const flat = (pts: { x: number; y: number }[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** 世界坐标 → 相对 (ox,oy) 的局部坐标（渲染层 Group 已定位到 ox,oy） */
const localize = (pts: Pt[], ox: number, oy: number): Pt[] => pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));

export function describeWindowTree(tree: WindowTree, installGap: number): TreeRenderElement[] {
  const layout = layoutTree(tree, { installGap });
  const contours = layoutContours(tree, { installGap });
  const out: TreeRenderElement[] = [];
  const shape = tree.frameShape ?? 'rect';
  // 异形框、有弧梃或有斜梃时按轮廓渲染子区/中梃（矩形直梃仍走 box 解析路径）
  const useContours = shape !== 'rect' || treeNeedsContours(tree);

  const frameX = Math.round(layout.frame.x);
  const frameY = Math.round(layout.frame.y);
  // 外框渲染需要「外轮廓」（渲染层再内缩 frameWidth 得内腔），而非 layoutContours 里的内腔。
  // 局部化到 (frameX,frameY)，与 Group 定位一致，避免世界坐标被二次平移。
  const frameOuter =
    shape !== 'rect'
      ? flat(localize(sampleOutline(shape, layout.frame, { inset: 0, topRatio: tree.topRatio }), frameX, frameY))
      : undefined;

  out.push({
    id: 'frame',
    kind: 'frame',
    type: 'frame',
    x: frameX,
    y: frameY,
    w: Math.round(layout.frame.w),
    h: Math.round(layout.frame.h),
    frameWidthMm: tree.frameWidthMm,
    shape,
    openSides: frameOpenSidesOf(tree).length ? frameOpenSidesOf(tree) : undefined,
    points: frameOuter,
    label: tree.name,
  });

  walkAreas(tree, (area) => {
    const pts = area.children ? contours.get(area.children[1].id) : contours.get(area.id);
    if (area.children) {
      const m = area.children[1];
      const b = layout.boxes.get(m.id)!;
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      out.push({
        id: m.id,
        kind: 'muntin',
        type: 'muntin',
        x: bx,
        y: by,
        w: Math.round(b.w),
        h: Math.round(b.h),
        points: useContours && pts ? flat(localize(pts, bx, by)) : undefined,
        sagittaMm: m.curve?.sagittaMm,
        slope: slopeOf(m.direction) ?? undefined,
        thicknessMm: m.thicknessMm,
      });
      return;
    }
    const b = layout.boxes.get(area.id)!;
    const bx = Math.round(b.x);
    const by = Math.round(b.y);
    const sash = area.sash ?? undefined;
    out.push({
      id: area.id,
      kind: 'area',
      type: sash ? typeOfSash(sash.windowType) : 'empty',
      x: bx,
      y: by,
      w: Math.round(b.w),
      h: Math.round(b.h),
      points: useContours && pts ? flat(localize(pts, bx, by)) : undefined,
      meetingWidthMm: sash && sashLeavesOf(sash) === 2 ? meetingWidthOf(tree) : undefined,
      louverPitchMm: sash && sashInfillOf(sash) === 'louver' ? louverPitchOf(tree) : undefined,
      panelHeightMm: sash && sashInfillOf(sash) === 'panel' ? panelHeightOf(tree) : undefined,
      label: sash?.label,
      sash,
      bars: area.bars,
    });
  });

  return out;
}

export function typeOfSash(type: SashType): TreeRenderElementType {
  switch (type) {
    case 'fixed':
      return 'fixed';
    case 'casement':
      return 'casement';
    case 'casementUp':
      return 'casementUp';
    case 'tiltSlide':
      return 'tiltSlide';
    case 'sliding':
      return 'sliding';
    case 'topHinged':
      return 'topHinged';
    case 'screen':
      return 'screen';
    default:
      return 'empty';
  }
}