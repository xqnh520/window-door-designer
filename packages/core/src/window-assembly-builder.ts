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
 *
 * strictJoins（旧方案迁移用）：只有几何能证明「同一直线、相邻、可串成链」时才生成装配体；
 * 无法可靠判断拼接关系的布局直接返回 null + 诊断，绝不猜测。
 */
export interface AssemblyFromDesignOptions {
  installGap: number;
  name: string;
  seriesId: string;
  glassId: string;
  frameWidthMm: number;
  /** true = 拼接关系必须由几何明确证明，否则不生成装配体 */
  strictJoins?: boolean;
}

export type AssemblyBuildIssueCode =
  | 'component-unhosted'
  | 'frames-not-linear'
  | 'frames-not-joined'
  | 'unit-tree-failed';

export interface AssemblyBuildIssue {
  code: AssemblyBuildIssueCode;
  message: string;
  critical: boolean;
}

export interface AssemblyFromDesignReport {
  assembly: WindowAssembly | null;
  issues: AssemblyBuildIssue[];
}

/** 相邻框的轴向间隙上限（mm）：超过则无法证明是同一条拼樘链 */
const JOIN_MAX_GAP = 200;
/** 相邻框的轴向重叠容忍（mm） */
const JOIN_MAX_OVERLAP = 50;
/** 非主延展方向上允许的中心线偏移（mm） */
const JOIN_CROSS_TOL = 50;

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
  return assemblyFromDesignModelWithReport(model, opts).assembly;
}

export function assemblyFromDesignModelWithReport(
  model: DesignModel,
  opts: AssemblyFromDesignOptions,
): AssemblyFromDesignReport {
  const issues: AssemblyBuildIssue[] = [];
  const frames = model.components.filter((c) => c.kind === 'outerFrame');
  if (!frames.length) return { assembly: null, issues };

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

  if (opts.strictJoins && ordered.length > 1) {
    const primary = ordered.map((f) => (horizontal ? center(f).x : center(f).y));
    const cross = ordered.map((f) => (horizontal ? center(f).y : center(f).x));
    const crossSpread = Math.max(...cross) - Math.min(...cross);
    if (crossSpread > JOIN_CROSS_TOL) {
      issues.push({
        code: 'frames-not-linear',
        critical: true,
        message: `旧方案外框不在同一条直线上（横向偏移 ${Math.round(crossSpread)}mm），无法确定拼接关系`,
      });
    }
    for (let i = 1; i < primary.length; i++) {
      if (Math.abs(primary[i] - primary[i - 1]) < 1e-6) {
        issues.push({
          code: 'frames-not-linear',
          critical: true,
          message: '旧方案存在主方向上完全重叠的外框，无法确定拼接顺序',
        });
        break;
      }
    }
    if (!issues.length) {
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1];
        const b = ordered[i];
        const gap = horizontal ? b.x - (a.x + a.w) : b.y - (a.y + a.h);
        if (gap < -JOIN_MAX_OVERLAP || gap > JOIN_MAX_GAP) {
          issues.push({
            code: 'frames-not-joined',
            critical: true,
            message: `外框 ${a.id} 与 ${b.id} 的轴向间距 ${Math.round(gap)}mm 无法证明是拼樘连接`,
          });
          break;
        }
        const crossOverlap = horizontal
          ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const crossMin = horizontal ? Math.min(a.h, b.h) : Math.min(a.w, b.w);
        if (crossOverlap < crossMin * 0.5) {
          issues.push({
            code: 'frames-not-joined',
            critical: true,
            message: `外框 ${a.id} 与 ${b.id} 在拼接方向上的搭接不足，无法证明是拼樘连接`,
          });
          break;
        }
      }
    }
    if (issues.some((i) => i.critical)) return { assembly: null, issues };
  }

  // 构件归属：中心点落在哪个框；非严格模式最近框兜底，严格模式不允许猜测
  const hosted = new Map<string, DesignComponent[]>();
  for (const f of frames) hosted.set(f.id, []);
  for (const c of hostables) {
    const p = center(c);
    let host = ordered.find((f) => containsPoint(f, p));
    if (!host) {
      if (opts.strictJoins) {
        issues.push({
          code: 'component-unhosted',
          critical: true,
          message: `构件 ${c.id} 不在任何外框内，无法确定归属框`,
        });
        continue;
      }
      host = ordered.reduce((best, f) => (!best || distSq(p, center(f)) < distSq(p, center(best)) ? f : best));
    }
    hosted.get(host.id)?.push(c);
  }
  if (issues.some((i) => i.critical)) return { assembly: null, issues };

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
    if (!tree) {
      issues.push({
        code: 'unit-tree-failed',
        critical: true,
        message: `外框 ${f.id} 无法反推容器树`,
      });
      continue;
    }
    tree.name = f.label ?? opts.name;
    tree.openingW = f.w + 2 * opts.installGap;
    tree.openingH = f.h + 2 * opts.installGap;
    tree.offsetX = f.x - opts.installGap;
    tree.offsetY = f.y - opts.installGap;
    units.push({ id: `u-${f.id}`, tree, label: f.label ?? tree.name });
  }

  if (!units.length) return { assembly: null, issues };
  if (opts.strictJoins && issues.some((i) => i.critical)) return { assembly: null, issues };

  const combiners: Combiner[] = [];
  for (let i = 1; i < units.length; i++) {
    const a = center(ordered[i - 1]);
    const b = center(ordered[i]);
    const axis: 'x' | 'y' = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y';
    // 严格迁移按真实轴向间隙还原拼樘厚度，使迁移后的加工坐标与旧画布一致
    const gap = axis === 'x'
      ? ordered[i].x - (ordered[i - 1].x + ordered[i - 1].w)
      : ordered[i].y - (ordered[i - 1].y + ordered[i - 1].h);
    const thicknessMm = opts.strictJoins
      ? Math.max(1, Math.min(JOIN_MAX_GAP, Math.round(gap)))
      : DEFAULT_COMBINER_MM;
    combiners.push({
      id: `comb-${units[i - 1].id}-${units[i].id}`,
      between: [units[i - 1].id, units[i].id],
      axis,
      thicknessMm,
      // 反向路径按设计丢弃转角：DesignComponent 无角度字段，只能还原成直线拼樘
      angleDeg: DEFAULT_CORNER_ANGLE_DEG,
    });
  }

  return {
    assembly: {
      id: model.id,
      name: opts.name,
      seriesId: opts.seriesId,
      glassId: opts.glassId,
      units,
      combiners,
    },
    issues,
  };
}
