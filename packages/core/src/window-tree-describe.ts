import type { FrameSide, GlassBarGeometry, GlassBarSpec, PanelLeafLayout, SashLeafRect, SashType, WindowSashSpec, WindowTree } from './window-tree.js';
import { walkAreas, layoutTree, layoutContours, frameOpenSidesOf, treeNeedsContours, slopeOf, meetingWidthOf, sashLeavesOf, louverPitchOf, louverSlats, sashInfillOf, panelHeightOf, panelLeafLayout, glassBarGeometry, autoFittingsOfTree, sashHandlePlacement, sashLeafRects, sashWidthOf, type SashHandlePlacement } from './window-tree.js';
import { insetPolygon, pointInPoly, polygonArea, regionAnchor, sampleOutline, type FrameShape, type MuntinSlope, type Pt } from './outline.js';

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

export interface LouverRenderGeometry {
  /** 每片百叶的局部 y 中心坐标。 */
  slatYs: number[];
  /** 百叶的视觉厚度。 */
  slatHeightMm: number;
}

export interface SashLeafRenderGeometry extends SashLeafRect {
  louver?: LouverRenderGeometry;
  panel?: PanelLeafLayout;
}

export interface RectRenderGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HandleRenderPlacement extends SashHandlePlacement {
  /** 所属单叶在宿主元素内的局部原点。 */
  x: number;
  y: number;
  hinge: 'left' | 'right';
  /** 已考虑异形轮廓的最终物化坐标。 */
  drawX: number;
  drawY: number;
}

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
  /** 已解析的扇料视觉内缩；Konva 层不得再从整树推导。 */
  sashInsetMm?: number;
  /** 已归一化的扇叶数（旧数据缺省为 1）。 */
  sashLeaves?: 1 | 2;
  /** 已归一化的扇面填充类型（旧数据缺省为 glass）。 */
  sashInfill?: 'glass' | 'louver' | 'panel';
  /** 已完成中缝重叠和填充布局计算的单叶渲染几何；仅对开扇提供。 */
  sashLeafGeometries?: SashLeafRenderGeometry[];
  /** 百叶帘片间距（mm，仅 sash.infill==='louver' 时给出） */
  louverPitchMm?: number;
  /** 肯德基门下板高度（mm，仅 sash.infill==='panel' 时给出） */
  panelHeightMm?: number;
  /** 单扇百叶的已解析布局。 */
  louver?: LouverRenderGeometry;
  /** 单扇上玻下板的已解析布局。 */
  panel?: PanelLeafLayout;
  /** 对开上玻下板跨中缝推板的已解析几何。 */
  panelPushPlate?: RectRenderGeometry;
  /**
   * 轮廓多边形（**局部坐标**，相对本元素 x/y；扁平 [x0,y0,x1,y1,...]）。
   * 渲染层把 Group 定位到 (x,y) 后按局部坐标绘制，故此处必须已减去 (x,y)。
   * frame = 外轮廓（渲染层再内缩 frameWidth 得内腔）；area/muntin = 裁剪后的局部轮廓。
   */
  points?: number[];
  /** 异形叶区内缩后的内容轮廓，供格条裁剪和百叶物化使用。 */
  panePoints?: number[];
  /** 异形开启扇的玻璃轮廓，已在 core 中完成扇料内缩。 */
  sashGlassPoints?: number[];
  /** 标签/异形配件角标的稳定区域锚点。 */
  contentAnchor?: Pt;
  label?: string;
  sash?: WindowSashSpec;
  /** 玻璃格条（叶子分格） */
  bars?: GlassBarSpec;
  /** 已按实际玻璃口尺寸解析的格条几何。 */
  glassBars?: GlassBarGeometry;
  /** 宿主配件总数（显式 + 自动派生），由 core 统一计算供渲染角标使用。 */
  fittingCount?: number;
  /** 把手几何描述（由 core 计算，Konva 层只负责物化）。 */
  handlePlacements?: HandleRenderPlacement[];
}

const flat = (pts: { x: number; y: number }[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** 世界坐标 → 相对 (ox,oy) 的局部坐标（渲染层 Group 已定位到 ox,oy） */
const localize = (pts: Pt[], ox: number, oy: number): Pt[] => pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));

const louverGeometry = (h: number, inset: number, pitch: number): LouverRenderGeometry => ({
  slatYs: louverSlats(h, inset, pitch),
  slatHeightMm: Math.max(4, Math.min(16, pitch * 0.3)),
});

const insetOrOriginal = (pts: Pt[], inset: number): Pt[] => {
  if (inset <= 0) return pts;
  const inner = insetPolygon(pts, inset);
  return inner.length >= 3 && Math.abs(polygonArea(inner)) > 1 ? inner : pts;
};

const withDrawPosition = (
  placement: SashHandlePlacement & { x: number; y: number; hinge: 'left' | 'right' },
  contour?: Pt[],
): HandleRenderPlacement => {
  const wanted = { x: placement.x + placement.cx, y: placement.y + placement.cy };
  const drawAt = contour && !pointInPoly(wanted, contour) ? regionAnchor(contour) : wanted;
  return { ...placement, drawX: drawAt.x, drawY: drawAt.y };
};

export function describeWindowTree(tree: WindowTree, installGap: number): TreeRenderElement[] {
  const layout = layoutTree(tree, { installGap });
  const contours = layoutContours(tree, { installGap });
  const out: TreeRenderElement[] = [];
  const fittingCounts = new Map<string, number>();
  if (tree.fittings?.length) fittingCounts.set('frame', tree.fittings.length);
  walkAreas(tree, (a) => {
    if (a.fittings?.length) fittingCounts.set(a.id, a.fittings.length);
  });
  for (const f of autoFittingsOfTree(tree, { installGap }, (id) => id)) {
    fittingCounts.set(f.hostId, (fittingCounts.get(f.hostId) ?? 0) + 1);
  }
  const shape = tree.frameShape ?? 'rect';
  // 异形框、有弧梃或有斜梃时按轮廓渲染子区/中梃（矩形直梃仍走 box 解析路径）
  const useContours = shape !== 'rect' || treeNeedsContours(tree);

  const frameX = Math.round(layout.frame.x);
  const frameY = Math.round(layout.frame.y);
  // 外框渲染需要「外轮廓」（渲染层再内缩 frameWidth 得内腔），而非 layoutContours 里的内腔。
  // 局部化到 (frameX,frameY)，与 Group 定位一致，避免世界坐标被二次平移。
  // 自定义轮廓（旧方案迁移）优先：它才是真实外轮廓，不能被形状采样覆盖。
  const frameOuterWorld =
    tree.frameContour && tree.frameContour.length >= 3
      ? tree.frameContour.map((p) => ({ x: layout.frame.x + p.x, y: layout.frame.y + p.y }))
      : shape !== 'rect'
        ? sampleOutline(shape, layout.frame, { inset: 0, topRatio: tree.topRatio })
        : undefined;
  const frameOuterPoints = frameOuterWorld ? localize(frameOuterWorld, frameX, frameY) : undefined;
  const frameOuter = frameOuterPoints ? flat(frameOuterPoints) : undefined;

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
    contentAnchor: frameOuterPoints ? regionAnchor(frameOuterPoints) : { x: Math.round(layout.frame.w) / 2, y: Math.round(layout.frame.h) / 2 },
    label: tree.name,
    fittingCount: fittingCounts.get('frame') ?? 0,
  });

  walkAreas(tree, (area) => {
    const pts = area.children ? contours.get(area.children[1].id) : contours.get(area.id);
    if (area.children) {
      const m = area.children[1];
      const b = layout.boxes.get(m.id)!;
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      const localPoints = useContours && pts ? localize(pts, bx, by) : undefined;
      out.push({
        id: m.id,
        kind: 'muntin',
        type: 'muntin',
        x: bx,
        y: by,
        w: Math.round(b.w),
        h: Math.round(b.h),
        points: localPoints ? flat(localPoints) : undefined,
        contentAnchor: localPoints ? regionAnchor(localPoints) : { x: Math.round(b.w) / 2, y: Math.round(b.h) / 2 },
        sagittaMm: m.curve?.sagittaMm,
        slope: slopeOf(m.direction) ?? undefined,
        thicknessMm: m.thicknessMm,
        fittingCount: fittingCounts.get(m.id) ?? 0,
      });
      return;
    }
    const b = layout.boxes.get(area.id)!;
    const bx = Math.round(b.x);
    const by = Math.round(b.y);
    const localPoints = useContours && pts ? localize(pts, bx, by) : undefined;
    const sash = area.sash ?? undefined;
    const sashInsetMm = sash ? sashWidthOf(tree) : undefined;
    const sashLeaves = sash ? (sashLeavesOf(sash) === 2 ? 2 : 1) : undefined;
    const sashInfill = sash ? sashInfillOf(sash) : undefined;
    const meetingWidthMm = sash && sashLeaves === 2 ? meetingWidthOf(tree) : undefined;
    const louverPitchMm = sashInfill === 'louver' ? louverPitchOf(tree) : undefined;
    const panelHeightMm = sashInfill === 'panel' ? panelHeightOf(tree) : undefined;
    const leafRects = sash && sashLeaves === 2
      ? sashLeafRects(Math.round(b.w), Math.round(b.h), 2, Math.max(sashInsetMm ?? 0, meetingWidthMm ?? 0))
      : undefined;
    const sashLeafGeometries = leafRects?.map((leaf): SashLeafRenderGeometry => ({
      ...leaf,
      louver: louverPitchMm === undefined ? undefined : louverGeometry(leaf.h, sashInsetMm ?? 0, louverPitchMm),
      panel: panelHeightMm === undefined ? undefined : panelLeafLayout(leaf.w, leaf.h, sashInsetMm ?? 0, panelHeightMm) ?? undefined,
    }));
    const louver = sash && sashLeaves === 1 && louverPitchMm !== undefined
      ? louverGeometry(Math.round(b.h), sashInsetMm ?? 0, louverPitchMm)
      : undefined;
    const panel = sash && sashLeaves === 1 && panelHeightMm !== undefined
      ? panelLeafLayout(Math.round(b.w), Math.round(b.h), sashInsetMm ?? 0, panelHeightMm) ?? undefined
      : undefined;
    const doublePanelLayout = sash && sashLeaves === 2 && panelHeightMm !== undefined
      ? panelLeafLayout(Math.round(b.w), Math.round(b.h), sashInsetMm ?? 0, panelHeightMm)
      : undefined;
    const panelPushPlate = doublePanelLayout
      ? (() => {
          const w = Math.min(150, Math.round(b.w) * 0.14);
          const h = Math.min(200, Math.round(b.h) * 0.14);
          return { x: Math.round(b.w) / 2 - w / 2, y: doublePanelLayout.railY - h / 2, w, h };
        })()
      : undefined;
    const glassInsetMm = sash ? sashInsetMm ?? 0 : 0;
    const glassBars = glassBarGeometry(
      Math.max(1, Math.round(b.w) - 2 * glassInsetMm),
      Math.max(1, Math.round(b.h) - 2 * glassInsetMm),
      area.bars,
    ) ?? undefined;
    const panePoints = localPoints ? insetOrOriginal(localPoints, sash ? sashInsetMm ?? 0 : 0) : undefined;
    const sashGlassPoints = localPoints && sash
      ? insetOrOriginal(localPoints, Math.max(4, sashInsetMm ?? 0))
      : undefined;
    const handlePlacements = sash && sash.windowType !== 'fixed'
      ? (sashLeaves === 2
          ? (leafRects ?? []).flatMap((leaf) => {
              const hinge: 'left' | 'right' = leaf.hinge;
              const p = sashHandlePlacement(leaf.w, leaf.h, sashInsetMm ?? 0, sash.handle, hinge);
              return p ? [withDrawPosition({ ...p, x: leaf.x, y: leaf.y, hinge }, localPoints)] : [];
            })
          : (() => {
              const hinge: 'left' | 'right' = sash.hingeSide === 'right' ? 'right' : 'left';
              const p = sashHandlePlacement(Math.round(b.w), Math.round(b.h), sashInsetMm ?? 0, sash.handle, hinge);
              return p ? [withDrawPosition({ ...p, x: 0, y: 0, hinge }, localPoints)] : [];
            })())
      : undefined;
    out.push({
      id: area.id,
      kind: 'area',
      type: sash ? typeOfSash(sash.windowType) : 'empty',
      x: bx,
      y: by,
      w: Math.round(b.w),
      h: Math.round(b.h),
      points: localPoints ? flat(localPoints) : undefined,
      panePoints: panePoints ? flat(panePoints) : undefined,
      sashGlassPoints: sashGlassPoints ? flat(sashGlassPoints) : undefined,
      contentAnchor: localPoints ? regionAnchor(localPoints) : { x: Math.round(b.w) / 2, y: Math.round(b.h) / 2 },
      meetingWidthMm,
      sashInsetMm,
      sashLeaves,
      sashInfill,
      sashLeafGeometries,
      louverPitchMm,
      panelHeightMm,
      louver,
      panel,
      panelPushPlate,
      label: sash?.label,
      sash,
      bars: area.bars,
      glassBars,
      fittingCount: fittingCounts.get(area.id) ?? 0,
      handlePlacements,
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
