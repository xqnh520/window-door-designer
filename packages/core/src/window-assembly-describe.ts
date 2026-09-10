import { describeWindowTree, type TreeRenderElement } from './window-tree-describe.js';
import { combinerDisplayLabel } from './window-assembly-corner.js';
import { layoutAssembly, type WindowAssembly } from './window-assembly.js';

/**
 * 装配体 → 渲染元素描述（纯数据，供 Konva 物化层与命中路由消费）。
 * 逐单元复用 describeWindowTree（对 offset 已烘焙的克隆树求绝对几何），
 * 并把单元内全部 id 命名空间化为 `${unitId}:${internalId}`；命中路由用 id.split(':')[0] 归属单元。
 * 拼樘料作为额外元素（kind/type='combiner'），id 即 combiner id。
 */
export function describeAssembly(a: WindowAssembly, installGap: number): TreeRenderElement[] {
  const layout = layoutAssembly(a, { installGap });
  const out: TreeRenderElement[] = [];

  for (const u of a.units) {
    const baked = layout.trees.get(u.id);
    if (!baked) continue;
    for (const el of describeWindowTree(baked, installGap)) {
      out.push({ ...el, id: `${u.id}:${el.id}` });
    }
  }

  for (const c of a.combiners) {
    const r = layout.combiners.get(c.id);
    if (!r) continue;
    out.push({
      id: c.id,
      kind: 'combiner',
      type: 'combiner',
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.max(1, Math.round(r.w)),
      h: Math.max(1, Math.round(r.h)),
      label: combinerDisplayLabel(c),
    });
  }

  return out;
}
