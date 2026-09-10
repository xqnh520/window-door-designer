import type { DesignComponent, DesignModel } from '@wdd/schema';
import { createWindowTree, type WindowBox, type WindowSashSpec, type WindowTree, type WindowTreeArea, type WindowMuntin } from './window-tree.js';

/**
 * DesignModel → 容器树反推（R4：旧画布/存量方案一键进入容器树设计）。
 *
 * 算法（基于现有几何的递归划分）：
 * - 外框 → 根容器；
 * - 在每个区域矩形内优先找"贯穿"的中梃（竖中梃跨满整高 / 横中梃跨满整宽）→ 分割出 [子区, 中梃, 子区] 递归；
 * - 无贯穿中梃但有多面板 → 按面板中心分组切开（引入中梃，保证结构自洽）；
 * - 剩余单面板 → 叶子放置构件（固定/平开/推拉/上悬/内开内倒/纱窗）。
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

  const tree = createWindowTree({
    openingW: model.openingW,
    openingH: model.openingH,
    seriesId: opts.seriesId,
    glassId: opts.glassId,
    frameWidthMm: opts.frameWidthMm,
    name: opts.name,
  });

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

/** 递归构建区域（含分割与叶构件） */
function buildArea(rect: WindowBox, items: Item[], tree: WindowTree): WindowTreeArea {
  const area: WindowTreeArea = { id: randomId(), kind: 'area', xr: 0, yr: 0, wr: 1, hr: 1 };
  const inRect = items.filter((it) => intersects(it.box, rect, TOL));

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
  // 已消费的中梃从递归项中排除，避免部分重叠导致无限递归
  const rest = items.filter((it) => it !== mullionItem);
  const muntin: WindowMuntin = {
    id: randomId(),
    kind: 'muntin',
    direction,
    ratio: vertical ? (mullionBox.x + mullionBox.w / 2 - rect.x) / Math.max(rect.w, 1) : (mullionBox.y + mullionBox.h / 2 - rect.y) / Math.max(rect.h, 1),
    thicknessMm: Math.round(vertical ? mullionBox.w : mullionBox.h),
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

/** 反推（DesignModel → 树）只认轴对齐中梃：斜梃的 bbox 近正方形，按 w/h 比较会误判成横梃 */
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
  switch (panel.kind) {
    case 'fixedGlass':
      return { windowType: 'fixed', label };
    case 'slidingSash':
      return { windowType: 'sliding', label };
    case 'topHungSash':
      return { windowType: 'topHinged', hingeSide: panel.hingeSide ?? 'top', openDirection: panel.openDirection ?? 'out', label };
    case 'casementSash':
      return {
        windowType: panel.windowType === 'casementUp' ? 'casementUp' : 'casement',
        hingeSide: panel.hingeSide ?? 'left',
        openDirection: panel.openDirection ?? 'out',
        label,
      };
    case 'screen':
      return { windowType: 'screen', label };
    default:
      return { windowType: 'fixed', label };
  }
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

function randomId(): string {
  return `n-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}