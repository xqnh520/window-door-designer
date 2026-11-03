import type { DesignComponent, DesignModel } from '@wdd/schema';
import { bBoxOf, clipByDiagonalBand, pointInPoly, type MuntinSlope, type Pt } from './outline.js';
import {
  DEFAULT_MUNTIN_MM,
  createWindowTree,
  type FrameSide,
  type SashType,
  type WindowBox,
  type WindowSashSpec,
  type WindowTree,
  type WindowTreeArea,
  type WindowMuntin,
} from './window-tree.js';

/**
 * DesignModel → 容器树反推（R4：旧画布/存量方案一键进入容器树设计）。
 *
 * 算法（基于现有几何的递归划分）：
 * - 外框 → 根容器（保留形状 / 梯形顶宽比 / 缺边 / 自定义外轮廓）；
 * - 在每个区域矩形内优先找"贯穿"的中梃（斜梃跨满两向 / 竖中梃跨满整高 / 横中梃跨满整宽）→ 分割出 [子区, 中梃, 子区] 递归；
 * - 斜梃按对角线族偏移切出真实三角/五边形子区，弧梃保留弧高；
 * - 无贯穿中梃但有多面板 → 按面板中心分组切开（引入中梃，保证结构自洽）；
 * - 剩余单面板 → 叶子放置构件（固定/平开/推拉/上悬/内开内倒/纱窗），保留叶数与填充物。
 * 布局由 layoutTree 以中梃 thicknessMm 精算，反推时保留原几何。
 */

export interface TreeFromDesignOptions {
  installGap: number;
  name: string;
  seriesId: string;
  glassId: string;
  frameWidthMm: number;
}

const TOL = 4;

interface Item {
  panel: DesignComponent | null;
  box: WindowBox;
}

export function treeFromDesignModel(model: DesignModel, opts: TreeFromDesignOptions): WindowTree | null {
  const frame = model.components.find((c) => c.kind === 'outerFrame');
  if (!frame) return null;

  const shape = frame.shape ?? 'rect';
  const tree = createWindowTree({
    openingW: model.openingW,
    openingH: model.openingH,
    seriesId: opts.seriesId,
    glassId: opts.glassId,
    frameWidthMm: opts.frameWidthMm,
    name: opts.name,
    frameShape: shape,
    topRatio: shape === 'trapezoid' ? clamp01(frame.topRatio ?? 1) : undefined,
    frameOpenSides: frame.openSides?.length ? (frame.openSides as FrameSide[]) : undefined,
    frameContour: outerContourOf(frame),
  });

  // 整窗级的对开缝宽 / 下板高度只有树上有位置，取任一携带该信息的叶子回填
  const doubleLeaf = model.components.find((c) => c.leaves === 2 && c.meetingWidthMm);
  if (doubleLeaf?.meetingWidthMm) tree.meetingWidthMm = doubleLeaf.meetingWidthMm;
  const panelLeaf = model.components.find((c) => c.infill === 'panel' && c.panelHeightMm);
  if (panelLeaf?.panelHeightMm) tree.panelHeightMm = panelLeaf.panelHeightMm;

  const inner: WindowBox = {
    x: frame.x + opts.frameWidthMm,
    y: frame.y + opts.frameWidthMm,
    w: Math.max(1, frame.w - 2 * opts.frameWidthMm),
    h: Math.max(1, frame.h - 2 * opts.frameWidthMm),
  };

  const items: Item[] = model.components
    .filter((c) => c.kind !== 'outerFrame')
    .map((c) => ({ panel: c, box: { x: c.x, y: c.y, w: c.w, h: c.h } }));

  tree.root = buildArea(inner, items, tree);
  return tree;
}

/**
 * 外框自定义轮廓：只有与 frame 矩形包围盒吻合时才视为真实外轮廓。
 * 树反推输出的非矩形外框 contour 是**内腔轮廓**（历史口径），不能当外轮廓再缩一圈，否则重复迁移。
 */
function outerContourOf(frame: DesignComponent): Pt[] | undefined {
  const pts = pointsOf(frame.contour);
  if (!pts || pts.length < 3) return undefined;
  const b = bBoxOf(pts);
  const eps = 2;
  if (Math.abs(b.x - frame.x) > eps || Math.abs(b.y - frame.y) > eps) return undefined;
  if (Math.abs(b.x + b.w - (frame.x + frame.w)) > eps || Math.abs(b.y + b.h - (frame.y + frame.h)) > eps) return undefined;
  return pts.map((p) => ({ x: p.x - frame.x, y: p.y - frame.y }));
}

/** 递归构建区域（含分割与叶构件） */
function buildArea(rect: WindowBox, items: Item[], tree: WindowTree): WindowTreeArea {
  const area: WindowTreeArea = { id: randomId(), kind: 'area', xr: 0, yr: 0, wr: 1, hr: 1 };
  const inRect = items.filter((it) => intersects(it.box, rect, TOL));

  // 0) 斜梃优先：横跨两个方向的斜带（bbox 近正方形，绝不能按 w/h 当横梃）
  const slopeItem = inRect.find(
    (it) =>
      it.panel?.kind === 'mullion' &&
      it.panel.slope &&
      spansX(it.box, rect) &&
      spansY(it.box, rect) &&
      centerInside(it.box, rect),
  );
  if (slopeItem) {
    const split = splitOnSlope(area, rect, inRect, slopeItem, tree);
    if (split) return split;
  }

  // 1) 贯穿竖中梃：跨满 rect 高度且中心线在 rect 内
  const vMullion = inRect.find(
    (it) => it.panel?.kind === 'mullion' && isVerticalMullion(it.panel) && spansY(it.box, rect) && centerInside(it.box, rect),
  );
  if (vMullion) {
    return splitOn(tree, area, rect, inRect, 'vertical', vMullion);
  }
  // 2) 贯穿横中梃
  const hMullion = inRect.find(
    (it) => it.panel?.kind === 'mullion' && isHorizontalMullion(it.panel) && spansX(it.box, rect) && centerInside(it.box, rect),
  );
  if (hMullion) {
    return splitOn(tree, area, rect, inRect, 'horizontal', hMullion);
  }

  // 3) 无贯穿中梃：统计面板（中心在区域内的面板；避免跨界面板被相邻子区重复消耗）
  const panels = inRect.filter((it) => it.panel && it.panel.kind !== 'mullion' && centerInside(it.box, rect));
  if (panels.length >= 2) {
    // 按中心点分组：优先按 x 中位切开，x 相同（同列）则按 y 中位切开；递归继续切分其余
    const byCX = [...panels].sort((a, b) => centerX(a.box) - centerX(b.box));
    const cx1 = centerX(byCX[0].box);
    const cx2 = centerX(byCX[1].box);
    if (cx2 - cx1 > TOL) {
      const mid = (cx1 + cx2) / 2;
      return splitOn(tree, area, rect, inRect, 'vertical', { panel: null, box: { x: mid - 20, y: rect.y, w: 40, h: rect.h } });
    }
    const byCY = [...panels].sort((a, b) => centerY(a.box) - centerY(b.box));
    const cy1 = centerY(byCY[0].box);
    const cy2 = centerY(byCY[1].box);
    if (cy2 - cy1 > TOL) {
      const mid = (cy1 + cy2) / 2;
      return splitOn(tree, area, rect, inRect, 'horizontal', { panel: null, box: { x: rect.x, y: mid - 20, w: rect.w, h: 40 } });
    }
    // 完全重叠面板（异常）：仅保留第一个
    const panel = panels[0].panel;
    if (panel) {
      area.sash = sashOf(panel);
      area.label = panel.label;
    }
    return area;
  }

  // 4) 叶子：单面板 → 构件
  const panel = panels[0]?.panel ?? null;
  if (panel) {
    area.sash = sashOf(panel);
    area.label = panel.label;
  }
  return area;
}

/**
 * 斜梃分割：子区是三角形/五边形，矩形分数表达不了——与 splitArea 同口径只存占位，
 * 真实几何由 layoutTree/layoutContours 按斜带裁剪计算。子区归属按面板中心落在哪一侧判定。
 */
function splitOnSlope(
  area: WindowTreeArea,
  rect: WindowBox,
  items: Item[],
  mullionItem: Item,
  tree: WindowTree,
): WindowTreeArea | null {
  const panel = mullionItem.panel;
  if (!panel?.slope) return null;
  const slope = panel.slope as MuntinSlope;
  const thickness = mullionThickness(panel, false);
  const ratio = diagonalRatio(panel, rect, slope);
  const cut = clipByDiagonalBand(rectPtsOf(rect), slope, ratio, thickness);
  if (!cut) return null;
  const rest = items.filter((it) => it !== mullionItem);
  const aItems = rest.filter((it) => pointInPoly(centerOf(it.box), cut.a));
  const bItems = rest.filter((it) => pointInPoly(centerOf(it.box), cut.b));
  const muntin: WindowMuntin = {
    id: randomId(),
    kind: 'muntin',
    direction: slope,
    ratio,
    thicknessMm: thickness,
  };
  area.children = [buildArea(bBoxOf(cut.a), aItems, tree), muntin, buildArea(bBoxOf(cut.b), bItems, tree)];
  return area;
}

function splitOn(
  tree: WindowTree,
  area: WindowTreeArea,
  rect: WindowBox,
  items: Item[],
  direction: 'vertical' | 'horizontal',
  mullionItem: Item,
): WindowTreeArea {
  const vertical = direction === 'vertical';
  const mullionBox = mullionItem.box;
  const thickness = mullionThickness(mullionItem.panel, vertical, mullionBox);
  // 已消费的中梃从递归项中排除，避免部分重叠导致无限递归
  const rest = items.filter((it) => it !== mullionItem);
  const sagitta = mullionItem.panel?.sagittaMm;
  const muntin: WindowMuntin = {
    id: randomId(),
    kind: 'muntin',
    direction,
    ratio: clampRatio(
      vertical
        ? (centerX(mullionBox) - rect.x) / Math.max(rect.w, 1)
        : (centerY(mullionBox) - rect.y) / Math.max(rect.h, 1),
    ),
    thicknessMm: thickness,
    // 弧梃的 bbox 是直线带（layout 按弦位摆放），比例直接取 bbox 中心即可；弧高必须显式带回
    curve: sagitta && Math.abs(sagitta) > 1e-6 ? { sagittaMm: sagitta } : undefined,
  };
  // 递归左右/上下子区
  const [leftOrTop, rightOrBottom] = vertical
    ? [
        { x: rect.x, y: rect.y, w: mullionBox.x - rect.x, h: rect.h },
        { x: mullionBox.x + mullionBox.w, y: rect.y, w: rect.x + rect.w - (mullionBox.x + mullionBox.w), h: rect.h },
      ]
    : [
        { x: rect.x, y: rect.y, w: rect.w, h: mullionBox.y - rect.y },
        { x: rect.x, y: mullionBox.y + mullionBox.h, w: rect.w, h: rect.y + rect.h - (mullionBox.y + mullionBox.h) },
      ];
  area.children = [buildArea(leftOrTop, rest, tree), muntin, buildArea(rightOrBottom, rest, tree)];
  return area;
}

/** 中梃料厚：显式 thicknessMm 优先（斜/弧带的 bbox 看不出真实厚度），否则按轴对齐 bbox 短边 */
function mullionThickness(panel: DesignComponent | null, vertical: boolean, box?: WindowBox): number {
  if (panel?.thicknessMm) return Math.max(1, Math.round(panel.thicknessMm));
  if (!box) return DEFAULT_MUNTIN_MM;
  return Math.max(1, Math.round(vertical ? box.w : box.h));
}

/** 斜梃在父矩形里的对角线族偏移：f = v∓u 的带中心 → ratio = (1 − f) / 2 */
function diagonalRatio(panel: DesignComponent, rect: WindowBox, slope: MuntinSlope): number {
  const pts = pointsOf(panel.contour);
  const base = pts && pts.length >= 3 ? pts : [{ x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 }];
  const f = base.reduce((s, p) => s + slopeF(p, rect, slope), 0) / base.length;
  return clampRatio((1 - f) / 2);
}

function slopeF(p: Pt, box: WindowBox, slope: MuntinSlope): number {
  const u = (p.x - box.x) / Math.max(1e-6, box.w);
  const v = (p.y - box.y) / Math.max(1e-6, box.h);
  return slope === 'diagonal' ? v - u : v + u - 1;
}

function pointsOf(flat: number[] | undefined): Pt[] | undefined {
  if (!flat || flat.length < 6) return undefined;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts.length >= 3 ? pts : undefined;
}

function rectPtsOf(b: WindowBox): Pt[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

function centerOf(b: WindowBox): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function intersects(a: WindowBox, b: WindowBox, tol: number): boolean {
  return a.x < b.x + b.w + tol && a.x + a.w > b.x - tol && a.y < b.y + b.h + tol && a.y + a.h > b.y - tol;
}

function centerX(b: WindowBox): number {
  return b.x + b.w / 2;
}

function centerY(b: WindowBox): number {
  return b.y + b.h / 2;
}

function centerInside(box: WindowBox, rect: WindowBox): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= rect.x - TOL && cx <= rect.x + rect.w + TOL && cy >= rect.y - TOL && cy <= rect.y + rect.h + TOL;
}

/** 反推（DesignModel → 树）只认轴对齐中梃：斜梃走 splitOnSlope，不能按 w/h 比较 */
function isVerticalMullion(c: DesignComponent | null): boolean {
  return !!c && !c.slope && c.h > c.w;
}

function isHorizontalMullion(c: DesignComponent | null): boolean {
  return !!c && !c.slope && c.w >= c.h;
}

function spansY(box: WindowBox, rect: WindowBox): boolean {
  const overlap = Math.max(0, Math.min(box.y + box.h, rect.y + rect.h) - Math.max(box.y, rect.y));
  return rect.h > 0 && overlap / rect.h >= 0.8;
}

function spansX(box: WindowBox, rect: WindowBox): boolean {
  const overlap = Math.max(0, Math.min(box.x + box.w, rect.x + rect.w) - Math.max(box.x, rect.x));
  return rect.w > 0 && overlap / rect.w >= 0.8;
}

function sashOf(panel: DesignComponent): WindowSashSpec {
  const label = panel.label ?? defaultLabel(panel.kind);
  const spec: WindowSashSpec = {
    windowType: sashWindowType(panel),
    label,
    roleType: panel.roleType,
    leaves: panel.leaves === 2 ? 2 : undefined,
    infill: panel.infill === 'louver' || panel.infill === 'panel' ? panel.infill : undefined,
  };
  if (spec.windowType !== 'screen') {
    spec.hingeSide = panel.hingeSide ?? defaultHingeSide(spec.windowType);
    spec.openDirection = panel.openDirection ?? 'out';
  }
  return spec;
}

/** 构件窗口类型：显式 windowType 优先（内开内倒/上悬等业务属性不能丢），否则按 kind 回退 */
function sashWindowType(panel: DesignComponent): SashType {
  if (panel.kind === 'screen') return 'screen';
  if (panel.windowType) return panel.windowType;
  switch (panel.kind) {
    case 'slidingSash':
      return 'sliding';
    case 'topHungSash':
      return 'topHinged';
    case 'casementSash':
      return 'casement';
    case 'fixedGlass':
      return 'fixed';
    default:
      return 'casement';
  }
}

function defaultHingeSide(type: SashType): 'left' | 'top' {
  return type === 'topHinged' ? 'top' : 'left';
}

function defaultLabel(kind: DesignComponent['kind']): string {
  switch (kind) {
    case 'screen':
      return 'WC';
    case 'casementSash':
    case 'topHungSash':
      return 'A1';
    case 'slidingSash':
      return 'S1';
    default:
      return 'F1';
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 比例夹到 (0,1) 开区间内部：0/1 会被裁剪器当成 0.5 兜底，反而丢失真实位置 */
function clampRatio(value: number): number {
  return Math.min(0.999, Math.max(0.001, Number.isFinite(value) ? value : 0.5));
}

function randomId(): string {
  return `n-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
