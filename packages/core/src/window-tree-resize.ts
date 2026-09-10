import type { WindowTree, WindowBox, WindowMuntin, WindowTreeArea } from './window-tree.js';
import { findArea, layoutTree, slopeOf, MIN_RATIO, walkAreas, type WindowLayoutResult } from './window-tree.js';

/**
 * 图形边拖拽调尺寸（R6）：支持外框四边与分格区域四边。
 *
 * - 外框 right/bottom：增大 openingW/H（左/上边不动）；
 *   外框 left/top：offsetX/Y 变化（对边不动，窗口向左/上扩展，洞尺寸同步调整）。
 * - 分格叶子：拖动某边 → 沿祖先链找对应分割线（中梃 ratio 调整）；
 *   落到最外层 → 交由外框（尺寸/偏移）处理，天然支持多级嵌套。
 */

export type TreeEdge = 'left' | 'right' | 'top' | 'bottom';

export interface ResizeEdgeOptions {
  /** 安装间隙（mm），与 layoutTree 一致 */
  installGap: number;
  /** 构件最小尺寸（mm） */
  minSize?: number;
}

const DEFAULT_MIN_SIZE = 200;

const VERTICAL_EDGES: TreeEdge[] = ['left', 'right'];

/**
 * 拖动 nodeId 的 edge 到目标绝对坐标 newPos（left/right → x 坐标，top/bottom → y 坐标）。
 * 就地修改 tree（窗口尺寸/中梃比例/偏移），返回是否发生变更。
 */
export function resizeTreeEdge(
  tree: WindowTree,
  nodeId: string,
  edge: TreeEdge,
  newPos: number,
  opts: ResizeEdgeOptions,
): boolean {
  const layout = layoutTree(tree, { installGap: opts.installGap });
  const minSize = opts.minSize ?? DEFAULT_MIN_SIZE;

  // 外框四边
  if (nodeId === 'frame') {
    return resizeFrame(tree, edge, newPos, layout, opts.installGap, minSize);
  }

  // 叶子区域：沿祖先链解析该边界
  return resizeAreaPath(tree, nodeId, edge, newPos, layout, opts.installGap, minSize);
}

// ── 外框 ──────────────────────────────────────────────────

function resizeFrame(
  tree: WindowTree,
  edge: TreeEdge,
  newPos: number,
  layout: WindowLayoutResult,
  gap: number,
  minSize: number,
): boolean {
  const f = layout.frame;
  let changed = false;
  if (edge === 'right') {
    const w = Math.max(minSize, newPos - f.x);
    const next = w + 2 * gap;
    if (Math.abs(next - tree.openingW) > 1) {
      tree.openingW = Math.round(next);
      changed = true;
    }
  } else if (edge === 'bottom') {
    const h = Math.max(minSize, newPos - f.y);
    const next = h + 2 * gap;
    if (Math.abs(next - tree.openingH) > 1) {
      tree.openingH = Math.round(next);
      changed = true;
    }
  } else if (edge === 'left') {
    const newX = Math.min(newPos, f.x + f.w - gap);
    const delta = newX - f.x;
    if (Math.abs(delta) > 1) {
      tree.offsetX = (tree.offsetX ?? 0) + delta;
      tree.openingW = Math.round(Math.max(minSize + 2 * gap, tree.openingW - delta));
      changed = true;
    }
  } else if (edge === 'top') {
    const newY = Math.min(newPos, f.y + f.h - gap);
    const delta = newY - f.y;
    if (Math.abs(delta) > 1) {
      tree.offsetY = (tree.offsetY ?? 0) + delta;
      tree.openingH = Math.round(Math.max(minSize + 2 * gap, tree.openingH - delta));
      changed = true;
    }
  }
  return changed;
}

// ── 分格区域：沿祖先链递归 ─────────────────────────────────

function resizeAreaPath(
  tree: WindowTree,
  areaId: string,
  edge: TreeEdge,
  newPos: number,
  layout: WindowLayoutResult,
  gap: number,
  minSize: number,
): boolean {
  const area = findArea(tree, areaId);
  if (!area) return false;

  // 找到含该区域的直接父分割（含中梃的最内层）
  const parent = findParentSplit(tree, areaId);
  const box = layout.boxes.get(areaId);
  if (!box) return false;

  const vertical = VERTICAL_EDGES.includes(edge);
  // 斜梃没有"落在料上"的轴对齐边：单坐标投影调不了它，其边一律归属宿主区
  const sloped = !!parent && !!slopeOf(parent.muntin.direction);
  if (parent && sloped) {
    return resizeAreaPath(tree, parent.area.id, edge, newPos, layout, gap, minSize);
  }

  if (parent) {
    const { area: host, muntin } = parent;
    const hostBox = layout.boxes.get(host.id)!;
    const isFirst = host.children![0].id === areaId;

    if (vertical) {
      // 竖分割：a1 的右边界、a2 的左边界 落在中梃上
      const tunable = (isFirst && edge === 'right') || (!isFirst && edge === 'left');
      if (tunable) {
        const ratio = (newPos - hostBox.x) / Math.max(hostBox.w, 1);
        const clamped = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio));
        if (Math.abs(clamped - muntin.ratio) > 0.002) {
          muntin.ratio = clamped;
          reflowChildren(host, muntin);
          return true;
        }
        return false;
      }
      // a1.left / a2.right：边界属于更高层 → 递归宿主
      if (isFirst && edge === 'left') {
        return resizeAreaPath(tree, host.id, 'left', newPos, layout, gap, minSize);
      }
      return resizeAreaPath(tree, host.id, 'right', newPos, layout, gap, minSize);
    }
    // 横分割：a1.bottom / a2.top 落在中梃上
    const tunable = (isFirst && edge === 'bottom') || (!isFirst && edge === 'top');
    if (tunable) {
      const ratio = (newPos - hostBox.y) / Math.max(hostBox.h, 1);
      const clamped = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio));
      if (Math.abs(clamped - muntin.ratio) > 0.002) {
        muntin.ratio = clamped;
        reflowChildren(host, muntin);
        return true;
      }
      return false;
    }
    if (isFirst && edge === 'top') {
      return resizeAreaPath(tree, host.id, 'top', newPos, layout, gap, minSize);
    }
    return resizeAreaPath(tree, host.id, 'bottom', newPos, layout, gap, minSize);
  }

  // 无父分割：面积即 root 的一部分 → 边界直接对外框。
  // 注意内外缘差：分格边界是外框内缘，外框边界是外缘，差一个 frameWidthMm。
  const fw = tree.frameWidthMm;
  if (vertical) {
    if (edge === 'right') return resizeFrame(tree, 'right', newPos + fw, layout, gap, minSize);
    return resizeFrame(tree, 'left', newPos - fw, layout, gap, minSize);
  }
  if (edge === 'bottom') return resizeFrame(tree, 'bottom', newPos + fw, layout, gap, minSize);
  return resizeFrame(tree, 'top', newPos - fw, layout, gap, minSize);
}

/** 找到持有该区域（作为 a1/a2）的外层分割 */
function findParentSplit(tree: WindowTree, areaId: string): { area: WindowTreeArea; muntin: WindowMuntin } | null {
  let found: { area: WindowTreeArea; muntin: WindowMuntin } | null = null;
  walkAreas(tree, (a) => {
    if (found || !a.children) return;
    if (a.children[0].id === areaId || a.children[2].id === areaId) {
      found = { area: a, muntin: a.children[1] };
    }
  });
  return found;
}

/** 中梃移动后同步两侧子区比例（与 moveMuntin 一致） */
function reflowChildren(host: WindowTreeArea, muntin: WindowMuntin): void {
  const [a1, , a2] = host.children!;
  const ratio = muntin.ratio;
  if (muntin.direction === 'vertical') {
    a1.wr = ratio;
    a2.xr = ratio;
    a2.wr = 1 - ratio;
  } else {
    a1.hr = ratio;
    a2.yr = ratio;
    a2.hr = 1 - ratio;
  }
}

export type { WindowBox };