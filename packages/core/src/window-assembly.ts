import type { DesignComponent, DesignFitting, DesignModel } from '@wdd/schema';
import { randomId } from './util.js';
import {
  autoFittingsOfTree,
  layoutTree,
  toDesignComponents,
  walkAreas,
  type TreeToDesignOptions,
  type WindowBox,
  type WindowFitting,
  type WindowLayoutResult,
  type WindowTree,
} from './window-tree.js';
import {
  combinerDisplayLabel,
  composePlacementChain,
  DEFAULT_CORNER_ANGLE_DEG,
  jointDeflectionDeg,
  normalizeAngleDeg,
  transformBox,
  type JointKinematic,
  type UnitPlacement,
} from './window-assembly-corner.js';

/**
 * 外框拼接装配体模型（M1：直线拼樘）。
 *
 * 背景：WindowTree 是「一樘一框」的单框容器树，无法表达多樘窗用拼樘料组合。
 * 本层在单框树之上引入 WindowAssembly = 若干 FrameUnit（每单元一棵普通树）+
 * Combiner（相邻单元间的拼樘料），线性链按 units 数组顺序串接。
 *
 * 设计要点：
 * - 单元在装配内不存绝对坐标：offsetX/offsetY 由 layoutAssembly 依「链顺序 + 拼樘轴/厚度」派生，
 *   因此增删单元 / 改尺寸后几何始终自洽贴合。
 * - 下游（BOM/报价/校验）已多框就绪：toDesignModelAssembly 吐 N 个 outerFrame + 拼樘（kind='combiner'）
 *   即可复用现有链路。单窗 = 1 单元 0 拼樘的装配体，向后兼容。
 * - 全部节点 id 命名空间化（`${unitId}:${internalId}`），避免克隆单元后 id 冲突。
 *
 * M2（转角拼接）空间分离不变式：
 * - layoutAssembly 的 units/trees/combiners/bbox 是**加工空间（展开态）**，永不旋转，继续喂 BOM/校验/下料。
 * - Combiner.angleDeg（180/135/90）只驱动新增的**显示变换** placement/combinerPlacement/displayBbox，
 *   唯一消费者是 2D 渲染器 / 编辑器叠加层与指针逆变换 / 3D。angleDeg=180 时显示 ≡ 加工（M1b 行为）。
 */

export interface FrameUnit {
  /** 稳定单元 id，作为该单元内全部构件的 id 命名空间 */
  id: string;
  /** 普通单框容器树；其 offsetX/offsetY 由 layoutAssembly 派生（存 0 即可） */
  tree: WindowTree;
  /** 导航显示名（如「樘1」） */
  label?: string;
}

export interface Combiner {
  id: string;
  /** 相邻两单元 id：[前单元, 后单元]（按 units 数组顺序） */
  between: [string, string];
  /** 'x'=竖拼樘条（左右并框）；'y'=横拼樘条（上下叠框） */
  axis: 'x' | 'y';
  /** 拼樘料厚度（mm） */
  thicknessMm: number;
  /** 夹角（度）：180=直线拼樘；135/90=转角。仅 axis==='x' 生效。 */
  angleDeg: number;
  /** 拼樘级配件（连接件/转角/拼框配件） */
  fittings?: WindowFitting[];
}

export interface WindowAssembly {
  id: string;
  name: string;
  seriesId: string;
  glassId: string;
  /** 线性链按数组顺序，units.length >= 1 */
  units: FrameUnit[];
  /** 纯线性：combiners 与 units 一一对应（units[i] 与 units[i+1] 之间，i 从 0 起） */
  combiners: Combiner[];
}

/** 默认拼樘料厚度（mm） */
export const DEFAULT_COMBINER_MM = 40;

// ── 构造 / 兼容转换 ──────────────────────────────────────────

/** 单框树 → 1 单元装配体（向后兼容入口） */
export function assemblyFromWindowTree(tree: WindowTree): WindowAssembly {
  return {
    id: randomId(),
    name: tree.name,
    seriesId: tree.seriesId,
    glassId: tree.glassId,
    units: [{ id: 'u1', tree, label: tree.name }],
    combiners: [],
  };
}

/** 装配体 → 单框树（仅 1 单元时还原原树；多单元返回 null） */
export function windowTreeOfAssembly(a: WindowAssembly): WindowTree | null {
  return a.units.length === 1 ? a.units[0].tree : null;
}

export function createAssembly(o: {
  seriesId: string;
  glassId: string;
  name: string;
  seedTree: WindowTree;
}): WindowAssembly {
  const a = assemblyFromWindowTree(o.seedTree);
  return { ...a, name: o.name, seriesId: o.seriesId, glassId: o.glassId };
}

function makeCombiner(
  idA: string,
  idB: string,
  axis: 'x' | 'y',
  thicknessMm: number,
  angleDeg: number = DEFAULT_CORNER_ANGLE_DEG,
): Combiner {
  return { id: `comb-${randomId()}`, between: [idA, idB], axis, thicknessMm, angleDeg };
}

/** 相邻单元对（顺序无关）是否等于该拼樘的 between */
function samePair(c: Combiner, x: string, y: string): boolean {
  return (c.between[0] === x && c.between[1] === y) || (c.between[0] === y && c.between[1] === x);
}

/** 依 units 顺序重建线性 combiners，尽量按「相邻对」复用已有 combiner 的轴/厚度/id */
function normalizeCombiners(units: FrameUnit[], existing: Combiner[]): Combiner[] {
  const out: Combiner[] = [];
  const used = new Set<string>();
  for (let i = 1; i < units.length; i++) {
    const a = units[i - 1].id;
    const b = units[i].id;
    const reuse = existing.find((c) => !used.has(c.id) && samePair(c, a, b));
    if (reuse) {
      used.add(reuse.id);
      out.push({ ...reuse, between: [a, b] });
    } else {
      out.push(makeCombiner(a, b, 'x', DEFAULT_COMBINER_MM));
    }
  }
  return out;
}

// ── 结构操作（全部不可变，返回新装配体） ────────────────────

export interface LinearAddOptions {
  /** 新单元锚定到该单元；默认插入其后 */
  anchorUnitId: string;
  /** 相对锚单元的拼接方向轴：'x'=并排右移，'y'=下移叠放 */
  axis: 'x' | 'y';
  /** true=插到锚单元之前（拼在锚的左/上方），默认 false=插后 */
  before?: boolean;
  /** 新单元的树（通常克隆自锚单元或空白） */
  tree: WindowTree;
  label?: string;
  thicknessMm?: number;
  /** 夹角（度），仅 axis==='x' 生效；缺省 180=直线 */
  angleDeg?: number;
  /** 是否添加拼樘料连接，默认 true；false 时两框直接相邻无拼樘 */
  withCombiner?: boolean;
}

/** 在锚单元之后（或 before=true 时之前）追加一个线性单元 + 拼樘，重接链并保持 combiners 与 units 对齐 */
export function addLinearUnit(
  a: WindowAssembly,
  o: LinearAddOptions,
): { assembly: WindowAssembly; newUnitId: string; newCombinerId: string } {
  const idx = a.units.findIndex((u) => u.id === o.anchorUnitId);
  if (idx < 0) return { assembly: a, newUnitId: '', newCombinerId: '' };

  const newUnitId = `u-${randomId()}`;
  const units = [...a.units];
  units.splice(o.before ? idx : idx + 1, 0, { id: newUnitId, tree: o.tree, label: o.label });

  // 先按新顺序重建 combiners，再定位「锚↔新」这条，写入用户指定的轴/厚度/夹角
  // （插前时 between 顺序为 [newUnitId, anchorUnitId]，用 samePair 对称匹配）
  let newCombinerId = '';
  let combiners = normalizeCombiners(units, a.combiners);
  combiners = combiners.map((c) => {
    if (samePair(c, o.anchorUnitId, newUnitId)) {
      newCombinerId = c.id;
      // withCombiner=false 时标记删除（厚度设为 0，后续过滤）
      if (o.withCombiner === false) {
        return { ...c, thicknessMm: 0 };
      }
      return {
        ...c,
        axis: o.axis,
        thicknessMm: o.thicknessMm ?? DEFAULT_COMBINER_MM,
        angleDeg: normalizeAngleDeg({ axis: o.axis, angleDeg: o.angleDeg }),
      };
    }
    return c;
  });

  // 过滤掉厚度为 0 的拼樘（withCombiner=false 的情况）
  if (o.withCombiner === false) {
    combiners = combiners.filter((c) => c.thicknessMm > 0);
    newCombinerId = '';
  }

  return { assembly: { ...a, units, combiners }, newUnitId, newCombinerId };
}

/** 删除单元及其相邻拼樘，剩余链重接（不可变） */
export function removeUnit(a: WindowAssembly, unitId: string): WindowAssembly {
  if (a.units.length <= 1) return a;
  const units = a.units.filter((u) => u.id !== unitId);
  const combiners = normalizeCombiners(units, a.combiners);
  return { ...a, units, combiners };
}

/** 回写聚焦单元编辑后的树，并保持 combiners 与 units 对齐（不可变） */
export function setUnitTree(a: WindowAssembly, unitId: string, tree: WindowTree): WindowAssembly {
  const units = a.units.map((u) => (u.id === unitId ? { ...u, tree } : u));
  const combiners = normalizeCombiners(units, a.combiners);
  return { ...a, units, combiners };
}

/** 修改拼樘厚度（不可变） */
export function setCombinerThickness(a: WindowAssembly, combinerId: string, thicknessMm: number): WindowAssembly {
  return { ...a, combiners: a.combiners.map((c) => (c.id === combinerId ? { ...c, thicknessMm } : c)) };
}

/** 设置拼接夹角（不可变）。非预设值 / axis==='y' 归一化为 180，永不产生非法角度 */
export function setCombinerAngle(a: WindowAssembly, combinerId: string, angleDeg: number): WindowAssembly {
  return {
    ...a,
    combiners: a.combiners.map((c) =>
      c.id === combinerId ? { ...c, angleDeg: normalizeAngleDeg({ ...c, angleDeg }) } : c,
    ),
  };
}

/** 修改拼樘配件（不可变）；空数组归一为 undefined，避免下游读到空数组 */
export function setCombinerFittings(a: WindowAssembly, combinerId: string, fittings: WindowFitting[]): WindowAssembly {
  return { ...a, combiners: a.combiners.map((c) => (c.id === combinerId ? { ...c, fittings: fittings.length ? fittings : undefined } : c)) };
}

// ── 几何布局（装配级权威） ──────────────────────────────────

export interface AssemblyLayout {
  /** 单元 id → 该单元绝对几何（offset 已烘焙）——加工空间，永不旋转 */
  units: Map<string, WindowLayoutResult>;
  /** 单元 id → offset 已烘焙的克隆树（供 toDesignComponents 使用）——加工空间 */
  trees: Map<string, WindowTree>;
  /** 拼樘 id → 绝对矩形（mm）——加工空间 */
  combiners: Map<string, WindowBox>;
  /** 全部框 + 拼樘的外接矩形（mm）——加工空间（洞口尺寸来源，勿改为显示外接） */
  bbox: WindowBox;
  /** 单元 id → 显示变换（加工空间→显示空间；180° 链全为恒等） */
  placement: Map<string, UnitPlacement>;
  /** 拼樘/转角料 id → 其上游单元的显示变换（转角料随上游腿） */
  combinerPlacement: Map<string, UnitPlacement>;
  /** 显示态外接（含转角旋转 + 归一化平移）；全 180° 时严格 == bbox */
  displayBbox: WindowBox;
}

export interface AssemblyLayoutContext {
  installGap: number;
}

function combinerForPair(combiners: Combiner[], idA: string, idB: string): Combiner | undefined {
  return combiners.find(
    (c) =>
      (c.between[0] === idA && c.between[1] === idB) || (c.between[0] === idB && c.between[1] === idA),
  );
}

/**
 * 派生每个单元的绝对 offset，并计算拼樘矩形与整体外接（加工空间）。
 * 沿 units 数组顺序走链：首单元沿用其自身 offset 作为装配锚点，
 * 后续单元依「上一单元矩形 + 本段拼樘轴/厚度」定位（'x' 并排右移、顶部对齐；'y' 下移叠放、左侧对齐）。
 *
 * 加工空间（units/trees/combiners/bbox）与角度无关、永不旋转 → BOM/校验安全。
 * 另在链上收集各段夹角，走完后合成**显示变换** placement/combinerPlacement/displayBbox（M2 转角）。
 */
export function layoutAssembly(a: WindowAssembly, ctx: AssemblyLayoutContext): AssemblyLayout {
  const unitLayouts = new Map<string, WindowLayoutResult>();
  const bakedTrees = new Map<string, WindowTree>();
  const combinerBoxes = new Map<string, WindowBox>();

  // 链式运动学收集：与 units 同下标
  const frames: WindowBox[] = [];
  const joints: JointKinematic[] = [];
  // 拼樘 id → 其上游单元在链中的下标（转角料随上游腿）
  const combUpstream = new Map<string, number>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const absorb = (r: WindowBox): void => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };

  let prev: WindowBox | null = null;
  for (let i = 0; i < a.units.length; i++) {
    const u = a.units[i];

    let ox: number;
    let oy: number;
    let axis: 'x' | 'y' = 'x';
    let thickness = DEFAULT_COMBINER_MM;
    let angleDeg = DEFAULT_CORNER_ANGLE_DEG;

    if (i === 0 || !prev) {
      ox = u.tree.offsetX ?? 0;
      oy = u.tree.offsetY ?? 0;
    } else {
      const comb = combinerForPair(a.combiners, a.units[i - 1].id, u.id);
      axis = comb?.axis ?? 'x';
      thickness = comb?.thicknessMm ?? DEFAULT_COMBINER_MM;
      angleDeg = comb ? normalizeAngleDeg(comb) : DEFAULT_CORNER_ANGLE_DEG;
      if (axis === 'x') {
        ox = prev.x + prev.w + thickness - ctx.installGap; // 本框左缘贴拼樘右缘
        oy = prev.y - ctx.installGap; // 顶部对齐
      } else {
        ox = prev.x - ctx.installGap; // 左侧对齐
        oy = prev.y + prev.h + thickness - ctx.installGap; // 本框顶缘贴拼樘下缘
      }
    }

    const baked: WindowTree = { ...u.tree, offsetX: ox, offsetY: oy };
    const layout = layoutTree(baked, ctx);
    bakedTrees.set(u.id, baked);
    unitLayouts.set(u.id, layout);
    absorb(layout.frame);
    frames[i] = layout.frame;
    // 铰点 = 下游框左上角（与拼樘内缘重合）；锚单元偏转为 0
    joints[i] = { pivotUnfolded: { x: layout.frame.x, y: layout.frame.y }, deflectionDeg: jointDeflectionDeg(angleDeg) };

    if (prev) {
      const comb = combinerForPair(a.combiners, a.units[i - 1].id, u.id);
      if (comb) {
        const cur = layout.frame;
        if (comb.axis === 'x') {
          const y = Math.max(prev.y, cur.y);
          const bottom = Math.min(prev.y + prev.h, cur.y + cur.h);
          const box: WindowBox = { x: prev.x + prev.w, y, w: comb.thicknessMm, h: Math.max(1, bottom - y) };
          combinerBoxes.set(comb.id, box);
          absorb(box);
        } else {
          const x = Math.max(prev.x, cur.x);
          const right = Math.min(prev.x + prev.w, cur.x + cur.w);
          const box: WindowBox = { x, y: prev.y + prev.h, w: Math.max(1, right - x), h: comb.thicknessMm };
          combinerBoxes.set(comb.id, box);
          absorb(box);
        }
        combUpstream.set(comb.id, i - 1);
      }
    }

    prev = layout.frame;
  }

  const bbox: WindowBox =
    Number.isFinite(minX) && Number.isFinite(minY)
      ? { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
      : { x: 0, y: 0, w: 1, h: 1 };

  // ── 显示变换合成（M2 转角）──
  const placements = composePlacementChain(joints);
  // 每张表各持独立副本：拼樘/转角料与其上游腿变换相同但对象不复用，避免下面的归一化平移被叠加两次
  const clonePlacement = (p: UnitPlacement | undefined): UnitPlacement => ({
    rotationDeg: p?.rotationDeg ?? 0,
    translate: { x: p?.translate.x ?? 0, y: p?.translate.y ?? 0 },
  });
  const placement = new Map<string, UnitPlacement>();
  const combinerPlacement = new Map<string, UnitPlacement>();
  a.units.forEach((u, i) => placement.set(u.id, clonePlacement(placements[i])));
  for (const [combId, upIdx] of combUpstream) combinerPlacement.set(combId, clonePlacement(placements[upIdx]));

  // 显示外接 + 归一化平移（把显示外接推回非负，180° 时位移为 0，可证恒等）
  let dminX = Infinity;
  let dminY = Infinity;
  let dmaxX = -Infinity;
  let dmaxY = -Infinity;
  const unionBox = (b: WindowBox): void => {
    dminX = Math.min(dminX, b.x);
    dminY = Math.min(dminY, b.y);
    dmaxX = Math.max(dmaxX, b.x + b.w);
    dmaxY = Math.max(dmaxY, b.y + b.h);
  };
  a.units.forEach((u, i) => {
    const p = placement.get(u.id);
    if (p) unionBox(transformBox(p, frames[i]));
  });
  for (const [combId, box] of combinerBoxes) {
    const p = combinerPlacement.get(combId);
    if (p) unionBox(transformBox(p, box));
  }
  const dispAabb: WindowBox = Number.isFinite(dminX)
    ? { x: dminX, y: dminY, w: Math.max(1, dmaxX - dminX), h: Math.max(1, dmaxY - dminY) }
    : bbox;
  const sx = Math.max(0, bbox.x - dispAabb.x);
  const sy = Math.max(0, bbox.y - dispAabb.y);
  if (sx !== 0 || sy !== 0) {
    for (const p of placement.values()) {
      p.translate.x += sx;
      p.translate.y += sy;
    }
    for (const p of combinerPlacement.values()) {
      p.translate.x += sx;
      p.translate.y += sy;
    }
  }
  const displayBbox: WindowBox = {
    x: dispAabb.x + sx,
    y: dispAabb.y + sy,
    w: dispAabb.w,
    h: dispAabb.h,
  };

  return {
    units: unitLayouts,
    trees: bakedTrees,
    combiners: combinerBoxes,
    bbox,
    placement,
    combinerPlacement,
    displayBbox,
  };
}

/** 装配体 → 平铺 DesignModel（N 框 + 拼樘），喂现成 BOM/报价/校验 */
export function toDesignModelAssembly(a: WindowAssembly, ctx: TreeToDesignOptions): DesignModel {
  const layout = layoutAssembly(a, { installGap: ctx.installGap });
  const components: DesignComponent[] = [];
  const fittings: DesignFitting[] = [];

  for (const u of a.units) {
    const baked = layout.trees.get(u.id);
    if (!baked) continue;
    components.push(...toDesignComponents(baked, ctx, u.id));
    // 单元内配件：整窗级（tree）+ 叶子级（area），tree 配件宿主指向单元 frame
    for (const f of baked.fittings ?? []) {
      fittings.push({ type: f.type, hostId: `${u.id}:frame`, hostKind: 'tree', hostLabel: baked.name, count: f.count, side: f.side });
    }
    walkAreas(baked, (area) => {
      for (const f of area.fittings ?? []) fittings.push({ type: f.type, hostId: `${u.id}:${area.id}`, hostKind: 'area', count: f.count, side: f.side });
    });
    fittings.push(...autoFittingsOfTree(baked, { installGap: ctx.installGap }, (id) => `${u.id}:${id}`));
  }

  for (const c of a.combiners) {
    const rect = layout.combiners.get(c.id);
    if (!rect) continue;
    components.push({
      id: c.id,
      kind: 'combiner',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h)),
      windowType: 'fixed',
      label: combinerDisplayLabel(c),
    });
    // 拼樘级配件（连接件/转角/拼框配件）
    for (const f of c.fittings ?? []) {
      fittings.push({ type: f.type, hostId: c.id, hostKind: 'combiner', hostLabel: combinerDisplayLabel(c), count: f.count, side: f.side });
    }
  }

  return {
    id: a.id,
    name: ctx.name || a.name,
    openingW: Math.max(1, layout.bbox.w + 2 * ctx.installGap),
    openingH: Math.max(1, layout.bbox.h + 2 * ctx.installGap),
    seriesId: ctx.seriesId,
    glassId: ctx.glassId,
    components,
    fittings: fittings.length ? fittings : undefined,
  };
}
