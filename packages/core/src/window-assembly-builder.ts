import type { DesignComponent, DesignModel } from '@wdd/schema';
import { treeFromDesignModel } from './window-tree-builder.js';
import { DEFAULT_COMBINER_MM, type Combiner, type FrameUnit, type WindowAssembly } from './window-assembly.js';
import { DEFAULT_CORNER_ANGLE_DEG } from './window-assembly-corner.js';

/**
 * DesignModel → 装配体反推（修复单框树 treeFromDesignModel 只取第一个外框、丢弃组合窗其余框的问题）。
 *
 * 做法：识别全部 outerFrame，按主延展方向线性排序；把每个非框构件按其中心点归属到所在/最近的外框；
 * 对每个外框用「子模型 = 该框 + 归属构件」走既有 treeFromDesignModel 反推出一棵单框树，并把框的绝对位置
 * 烘焙进该树的 offsetX/offsetY；相邻框之间按主间距方向插入线性拼樘。
 */
export interface AssemblyFromDesignOptions {
  installGap: number;
  name: string;
  seriesId: string;
  glassId: string;
  frameWidthMm: number;
}

function center(c: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

function containsPoint(f: DesignComponent, p: { x: number; y: number }): boolean {
  return p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h;
}

function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function assemblyFromDesignModel(
  model: DesignModel,
  opts: AssemblyFromDesignOptions,
): WindowAssembly | null {
  const frames = model.components.filter((c) => c.kind === 'outerFrame');
  if (!frames.length) return null;

  const hostables = model.components.filter((c) => c.kind !== 'outerFrame' && c.kind !== 'combiner');

  // 线性定序：按中心点主延展方向排序（横向并排按 x，纵向叠放按 y）
  const fc = frames.map((f) => center(f));
  const spanX = Math.max(...fc.map((p) => p.x)) - Math.min(...fc.map((p) => p.x));
  const spanY = Math.max(...fc.map((p) => p.y)) - Math.min(...fc.map((p) => p.y));
  const horizontal = spanX >= spanY;
  const ordered = [...frames].sort((a, b) => {
    const ca = center(a);
    const cb = center(b);
    return horizontal ? ca.x - cb.x || ca.y - cb.y : ca.y - cb.y || ca.x - cb.x;
  });

  // 构件归属：中心点落在哪个框，否则归最近框
  const hosted = new Map<string, DesignComponent[]>();
  for (const f of frames) hosted.set(f.id, []);
  for (const c of hostables) {
    const p = center(c);
    let host = ordered.find((f) => containsPoint(f, p));
    if (!host) {
      host = ordered.reduce((best, f) => (!best || distSq(p, center(f)) < distSq(p, center(best)) ? f : best));
    }
    hosted.get(host.id)?.push(c);
  }

  const units: FrameUnit[] = [];
  for (const f of ordered) {
    const sub: DesignModel = {
      id: model.id,
      name: opts.name,
      openingW: f.w + 2 * opts.installGap,
      openingH: f.h + 2 * opts.installGap,
      seriesId: opts.seriesId,
      glassId: opts.glassId,
      components: [f, ...(hosted.get(f.id) ?? [])],
    };
    const tree = treeFromDesignModel(sub, opts);
    if (!tree) continue;
    tree.name = f.label ?? opts.name;
    tree.openingW = f.w + 2 * opts.installGap;
    tree.openingH = f.h + 2 * opts.installGap;
    tree.offsetX = f.x - opts.installGap;
    tree.offsetY = f.y - opts.installGap;
    units.push({ id: `u-${f.id}`, tree, label: f.label ?? tree.name });
  }

  if (!units.length) return null;

  const combiners: Combiner[] = [];
  for (let i = 1; i < units.length; i++) {
    const a = center(ordered[i - 1]);
    const b = center(ordered[i]);
    const axis: 'x' | 'y' = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y';
    combiners.push({
      id: `comb-${units[i - 1].id}-${units[i].id}`,
      between: [units[i - 1].id, units[i].id],
      axis,
      thicknessMm: DEFAULT_COMBINER_MM,
      // 反向路径按设计丢弃转角：DesignComponent 无角度字段，只能还原成直线拼樘
      angleDeg: DEFAULT_CORNER_ANGLE_DEG,
    });
  }

  return {
    id: model.id,
    name: opts.name,
    seriesId: opts.seriesId,
    glassId: opts.glassId,
    units,
    combiners,
  };
}
