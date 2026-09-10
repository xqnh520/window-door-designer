import Konva from 'konva';
import { renderWindowTree, drawFittingBadge, type WindowTreeRenderOptions } from './window-tree-render.js';
import { layoutAssembly, type WindowAssembly } from './window-assembly.js';
import { rotateDeg, type UnitPlacement, type Vec2 } from './window-assembly-corner.js';
import type { WindowBox } from './window-tree.js';

/**
 * 装配体 → Konva 物化（浏览器画布）：逐单元复用 renderWindowTree（绝对坐标 = 布局烘焙的 offset），
 * 并把拼樘料绘制为独立可命中矩形（data-combiner）。
 *
 * M2 转角：节点几何一律按**加工空间（展开态）**生成，再经 placeNode 套 layoutAssembly 的
 * **显示变换**（placement / combinerPlacement）。全 180° 时变换恒等，绘制结果与 M1b 逐像素一致。
 *
 * 用途：
 * - 画布「显示全部 / 编辑其一」：控制器对聚焦单元走交互式 renderWindowTree，对其余单元 + 拼樘走本模块
 *   （传 skipUnitId=聚焦单元 只画上下文，且整体 listening:false）。
 * - 图纸/预览整体导出可一次性画全部单元。
 * 命中路由约定：单元容器携带 data-unit=unitId，拼樘携带 data-combiner=combinerId。
 */
export interface AssemblyRenderOptions extends WindowTreeRenderOptions {
  /** 跳过该单元（由调用方另行以可编辑方式绘制） */
  skipUnitId?: string | null;
  /** 上下文单元是否可交互（默认 false：只读，靠透明命中矩形切换聚焦） */
  interactiveUnits?: boolean;
}

export interface AssemblyRenderResult {
  group: Konva.Group;
  /** 单元 id → 该单元渲染组 */
  units: Map<string, Konva.Group>;
  /** 拼樘/转角料 id → 其节点 */
  combiners: Map<string, Konva.Node>;
  /** 单元 id → 外框绝对矩形（加工空间，用于聚焦高亮环 / 命中矩形） */
  frames: Map<string, WindowBox>;
  /** 本次布局（含 placement/combinerPlacement/displayBbox），供编辑器复用免重复布局 */
  layout: ReturnType<typeof layoutAssembly>;
}

/**
 * 把节点从加工空间搬到显示空间：实现 f(p)=R·p+t。
 * Konva 的变换次序为 position + R·(p − offset)，故取 offset=anchor、position=R·anchor+t 即可，
 * 结果与 anchor 取值无关（仅影响数值条件）。恒等变换直接返回，保持节点默认值不动。
 */
export function placeNode(node: Konva.Node, p: UnitPlacement | undefined, anchor: Vec2): void {
  if (!p || (p.rotationDeg === 0 && p.translate.x === 0 && p.translate.y === 0)) return;
  const rotated = rotateDeg(anchor, p.rotationDeg);
  node.offset({ x: anchor.x, y: anchor.y });
  node.rotation(p.rotationDeg);
  node.position({ x: rotated.x + p.translate.x, y: rotated.y + p.translate.y });
}

export function renderAssembly(a: WindowAssembly, opts: AssemblyRenderOptions): AssemblyRenderResult {
  const layout = layoutAssembly(a, { installGap: opts.installGap });
  const group = new Konva.Group({ listening: true });
  const units = new Map<string, Konva.Group>();
  const combiners = new Map<string, Konva.Node>();
  const frames = new Map<string, WindowBox>();

  for (const u of a.units) {
    const baked = layout.trees.get(u.id);
    const frame = layout.units.get(u.id)?.frame;
    if (!baked || !frame) continue;
    frames.set(u.id, frame);
    if (opts.skipUnitId && u.id === opts.skipUnitId) continue;

    const { group: unitGroup } = renderWindowTree(baked, opts);
    const interactive = !!opts.interactiveUnits;
    unitGroup.listening(interactive);
    unitGroup.setAttr('data-unit', u.id);
    if (!interactive) {
      // 只读上下文：透明命中矩形覆盖外框，用于点击切换聚焦。
      // 必须挂在 unitGroup 之外——unitGroup 已 listening(false)，Konva 的 isListening()
      // 会向祖先回溯，子节点即便 listening:true 也收不到事件。写法与下方拼樘 wrapper 对齐。
      const hit = new Konva.Rect({
        x: frame.x,
        y: frame.y,
        width: Math.max(1, frame.w),
        height: Math.max(1, frame.h),
        fill: 'rgba(0,0,0,0)',
      });
      hit.setAttr('data-unit', u.id);
      const hitWrapper = new Konva.Group();
      hitWrapper.add(hit);
      hitWrapper.setAttr('data-unit', u.id);
      group.add(hitWrapper);
      placeNode(hitWrapper, layout.placement.get(u.id), { x: frame.x, y: frame.y });
    }
    group.add(unitGroup);
    placeNode(unitGroup, layout.placement.get(u.id), { x: frame.x, y: frame.y });
    units.set(u.id, unitGroup);
  }

  for (const c of a.combiners) {
    const r = layout.combiners.get(c.id);
    if (!r) continue;
    const rect = new Konva.Rect({
      x: r.x,
      y: r.y,
      width: Math.max(1, r.w),
      height: Math.max(1, r.h),
      fill: '#8a8a92',
      stroke: '#000',
      strokeWidth: 1,
      cornerRadius: 2,
    });
    rect.setAttr('data-combiner', c.id);
    const wrapper = new Konva.Group();
    wrapper.add(rect);
    wrapper.setAttr('data-combiner', c.id);
    const fc = c.fittings?.length ?? 0;
    if (fc > 0) {
      const rad = Math.max(9, Math.min(18, Math.max(r.w, r.h) / 24));
      drawFittingBadge(wrapper, r.x + r.w / 2, r.y + r.h / 2, rad, fc);
    }
    group.add(wrapper);
    placeNode(wrapper, layout.combinerPlacement.get(c.id), { x: r.x, y: r.y });
    combiners.set(c.id, wrapper);
  }

  return { group, units, combiners, frames, layout };
}
