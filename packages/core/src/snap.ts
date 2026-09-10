/**
 * 画布吸附系统（纯函数，无 Konva 依赖）：
 * 拖拽中梃调位 / 拖拽分割 / 时把指针坐标吸附到参考线——框边·中线、邻接元素边·中线、
 * 以及宿主的 k 等分线，对齐 windoorcraft 的拖拽吸附手感。参考线统一来自 describeWindowTree 的布局几何。
 *
 * 吸附是**单轴**的：竖中梃只吸 x（竖向线），横中梃只吸 y（横向线），故按轴取 lines.v / lines.h。
 */
import type { TreeRenderElement } from './window-tree-describe.js';

/** 收集全部参考线（竖向线=世界 x，横向线=世界 y；矩形几何）。
 *  excludeIds 内的元素跳过：拖中梃时排除宿主自身（移动）子树，避免中梃吸到自己刚产生的边导致抖动/自锁。 */
export function collectSnapLines(
  elements: TreeRenderElement[],
  frame: { x: number; y: number; w: number; h: number },
  excludeIds?: ReadonlySet<string>,
): { v: number[]; h: number[] } {
  const v = new Set<number>([frame.x, frame.x + frame.w / 2, frame.x + frame.w]);
  const h = new Set<number>([frame.y, frame.y + frame.h / 2, frame.y + frame.h]);
  for (const el of elements) {
    if (el.kind !== 'area') continue;
    if (excludeIds?.has(el.id)) continue;
    v.add(el.x).add(el.x + el.w / 2).add(el.x + el.w);
    h.add(el.y).add(el.y + el.h / 2).add(el.y + el.h);
  }
  return { v: [...v].sort((a, b) => a - b), h: [...h].sort((a, b) => a - b) };
}

/** 把坐标吸附到最近的参考线；阈值内（含）返回吸附值，否则 null。lines 无需有序。 */
export function snapTo(value: number, lines: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestD = threshold;
  for (const l of lines) {
    const d = Math.abs(l - value);
    if (d <= bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * 宿主区间 [origin, origin+span] 内可用的吸附参考线（去重升序，直接喂给 snapTo）：
 *  ① 均分线：k=2..kMax 的 origin+span·i/k（i=1..k-1）——画梃/调梃最常吸的等分手感；
 *  ② 落在**开区间**内的全局参考线（框中线、邻接元素边·中线）——对齐相邻构件。
 * 端点 origin / origin+span 不计入：吸到端点等于把中梃推到宿主边界，无意义且随后被 ratio clamp 兜底。
 */
export function hostSnapLines(origin: number, span: number, globalLines: number[], kMax = 6): number[] {
  const set = new Set<number>();
  for (let k = 2; k <= kMax; k++) {
    for (let i = 1; i < k; i++) set.add(origin + (span * i) / k);
  }
  const eps = 1e-6;
  for (const l of globalLines) {
    if (l > origin + eps && l < origin + span - eps) set.add(l);
  }
  return [...set].sort((a, b) => a - b);
}
