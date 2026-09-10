import {
  equalDivide,
  layoutContours,
  layoutTree,
  splitArea,
  walkAreas,
  type WindowMuntin,
  type WindowTree,
  type WindowTreeArea,
} from './window-tree.js';
import { polygonArea } from './outline.js';

/**
 * 复合梃预设（对应 windoorcraft 的 `mullion_compound_*` / `mullion_spin` / 四角 / 八角 一族）：
 * 一次点击把选中分格切成整套对称分格。内部只是一串既有分割（直梃 + 斜梃），
 * 所以非矩形子区、扇料/玻璃/压线出料、下料与校验都自动继承，不需要另建模型。
 *
 * 纪律：**全成才生效**。任一步切不出（宿主太小、斜带与已有边界交点数≠2 等）就整单回滚，
 * 不留半套分格。
 */

export type MuntinPattern = 'square2x2' | 'grid3x3' | 'crossX' | 'diamond' | 'octagon' | 'spin';

export const MUNTIN_PATTERN_IDS: readonly MuntinPattern[] = ['square2x2', 'grid3x3', 'crossX', 'diamond', 'octagon', 'spin'];

export const MUNTIN_PATTERN_LABEL: Record<MuntinPattern, string> = {
  square2x2: '田字（2×2）',
  grid3x3: '九宫（3×3·四角）',
  crossX: 'X 双对角',
  diamond: '菱形（深切四角）',
  octagon: '八角（浅切四角）',
  spin: '风车（spin）',
};

/** 对方工具 id（实测统计见 docs §6.3），供规格对照用 */
export const MUNTIN_PATTERN_SOURCE: Record<MuntinPattern, string> = {
  square2x2: 'mullion_compound_square',
  grid3x3: 'mullion_compound_rectangle_single（四角）',
  crossX: 'mullion_diagnoal + mullion_counterdiagnoal',
  diamond: 'mullion_compound_diamond',
  octagon: 'mullion_compound_long_octagon / double_octagon',
  spin: 'mullion_spin / compound_x_square',
};

type Step =
  | { kind: 'split'; dir: WindowMuntin['direction']; ratio: number; on: 'all' | 'bigger' }
  | { kind: 'divide'; dir: 'vertical' | 'horizontal'; n: number; on: 'all' | 'bigger' };

/**
 * 斜梃切角深度：`ratio 0.75` 恰好过两邻边中点（真菱形），但那样第三、四根料会在已有顶点上相交
 * （穿越次数≠2 → 被拒绝），所以菱形取"刚好比中点浅一点"的 0.76；八角再浅一档。
 */
const CORNER_DEEP = 0.76;
const CORNER_SHALLOW = 0.86;

function stepsOf(pattern: MuntinPattern): Step[] {
  switch (pattern) {
    case 'square2x2':
      return [
        { kind: 'divide', dir: 'vertical', n: 2, on: 'all' },
        { kind: 'divide', dir: 'horizontal', n: 2, on: 'all' },
      ];
    case 'grid3x3':
      return [
        { kind: 'divide', dir: 'vertical', n: 3, on: 'all' },
        { kind: 'divide', dir: 'horizontal', n: 3, on: 'all' },
      ];
    case 'crossX':
      return [
        { kind: 'split', dir: 'diagonal', ratio: 0.5, on: 'all' },
        { kind: 'split', dir: 'antiDiagonal', ratio: 0.5, on: 'all' },
      ];
    case 'diamond':
    case 'octagon': {
      const at = pattern === 'diamond' ? CORNER_DEEP : CORNER_SHALLOW;
      return [
        { kind: 'split', dir: 'antiDiagonal', ratio: at, on: 'bigger' },
        { kind: 'split', dir: 'diagonal', ratio: at, on: 'bigger' },
        { kind: 'split', dir: 'diagonal', ratio: 1 - at, on: 'bigger' },
        { kind: 'split', dir: 'antiDiagonal', ratio: 1 - at, on: 'bigger' },
      ];
    }
    case 'spin':
      return [
        { kind: 'divide', dir: 'vertical', n: 2, on: 'all' },
        { kind: 'divide', dir: 'horizontal', n: 2, on: 'all' },
        { kind: 'split', dir: 'diagonal', ratio: 0.75, on: 'all' },
      ];
  }
}

/** 当前所有未分割叶子 */
function leaves(tree: WindowTree): WindowTreeArea[] {
  const out: WindowTreeArea[] = [];
  walkAreas(tree, (a) => {
    if (!a.children) out.push(a);
  });
  return out;
}

function biggestLeaf(tree: WindowTree, ids: Set<string>): WindowTreeArea | null {
  const layout = layoutTree(tree, { installGap: 0 });
  let best: WindowTreeArea | null = null;
  let bestArea = -1;
  for (const leaf of leaves(tree)) {
    if (!ids.has(leaf.id)) continue;
    const box = layout.boxes.get(leaf.id);
    const area = box ? box.w * box.h : 0;
    if (area > bestArea) {
      bestArea = area;
      best = leaf;
    }
  }
  return best;
}

export interface MuntinPatternOptions {
  /** 等分要按 mm 反推比例（扣掉料厚占位），故需安装间隙 */
  installGap?: number;
  /** 料厚（mm）；缺省跟随整窗 `muntinWidthMm` */
  thicknessMm?: number;
}

/**
 * 把复合梃预设套到指定分格上：成功返回 true 并就地更新 `tree`；
 * 任一步失败返回 false 且**原树完全不变**（在深拷贝上试切）。
 */
export function applyMuntinPattern(
  tree: WindowTree,
  areaId: string,
  pattern: MuntinPattern,
  opts: MuntinPatternOptions = {},
): boolean {
  const steps = stepsOf(pattern);
  if (!steps.length) return false;
  const installGap = opts.installGap ?? 20;
  const draft: WindowTree = JSON.parse(JSON.stringify(tree));
  /** 预设一律出直料：整窗的弧高设置不该把田字/九宫变成弧梃（原树的设置原样保留） */
  draft.muntinSagittaMm = 0;
  const host = findLeaf(draft, areaId);
  if (!host) return false;
  /** 本次预设可作用的叶子：严格限定在选中格的子树内（尚未分割时就是它自己），绝不外溢到兄弟格 */
  const grown = (): Set<string> => {
    const ids = new Set<string>();
    const collect = (a: WindowTreeArea): void => {
      if (a.children) {
        for (const c of a.children) if (c.kind === 'area') collect(c);
      } else ids.add(a.id);
    };
    collect(host);
    return ids;
  };

  for (const step of steps) {
    let targets: WindowTreeArea[];
    if (step.on === 'bigger') {
      const big = biggestLeaf(draft, grown());
      targets = big ? [big] : [];
    } else {
      targets = leavesIn(draft, grown());
    }
    if (!targets.length) return false;
    for (const target of targets) {
      /** 把目标的真实尺寸交给 splitArea：斜带切不出（穿越次数≠2 等）就整单失败，不留半套分格 */
      const box = layoutTree(draft, { installGap: 0 }).boxes.get(target.id);
      const mm = box ? { w: box.w, h: box.h } : undefined;
      const ok =
        step.kind === 'divide'
          ? equalDivide(draft, target.id, step.dir, step.n, installGap)
          : splitArea(draft, target.id, step.dir, step.ratio, opts.thicknessMm, undefined, mm);
      if (!ok) return false;
    }
  }
  if (leaves(draft).length <= leaves(tree).length) return false;
  /**
   * 事后校验（只看本次选中格的子树）：被拒绝的切割不会留下带轮廓（子区沿用父轮廓），所以
   * 「每根新中梃都有轮廓 + 每片新叶子面积不退化」才是"这套分格真的切出来了"的判据。
   */
  const contours = layoutContours(draft, { installGap });
  const subMuntins: string[] = [];
  const collectMuntins = (a: WindowTreeArea): void => {
    if (!a.children) return;
    subMuntins.push(a.children[1].id);
    for (const c of a.children) if (c.kind === 'area') collectMuntins(c);
  };
  collectMuntins(host);
  const subLeaves = leaves(draft).filter((l) => grown().has(l.id));
  const leafAreas = subLeaves.map((l) => Math.abs(polygonArea(contours.get(l.id) ?? [])));
  const minArea = Math.max(400, Math.max(...leafAreas, 0) * 0.01);
  const allCut = subMuntins.every((id) => contours.has(id));
  if (!allCut || !leafAreas.length || leafAreas.some((a) => a < minArea)) return false;
  tree.root = JSON.parse(JSON.stringify(draft.root));
  return true;
}

function findLeaf(tree: WindowTree, areaId: string): WindowTreeArea | null {
  let found: WindowTreeArea | null = null;
  walkAreas(tree, (a) => {
    if (a.id === areaId && !a.children) found = a;
  });
  return found;
}

/** 子树内的全部叶子（含尚未分割的目标本身） */
function leavesIn(tree: WindowTree, ids: Set<string>): WindowTreeArea[] {
  return leaves(tree).filter((l) => ids.has(l.id));
}
