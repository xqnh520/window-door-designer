import type { WindowAssembly } from './window-assembly.js';
import { assemblyFromWindowTree } from './window-assembly.js';
import { assemblyFromDesignModelWithReport } from './window-assembly-builder.js';
import { treeFromDesignModel } from './window-tree-builder.js';
import {
  buildDesignModelFromLegacyShapesWithReport,
  type LegacyImportContext,
  type LegacyIssue,
  type LegacyShape,
} from './legacy-shapes.js';

/**
 * 旧 ShapeModel → WindowAssembly 的完整迁移入口。
 *
 * 单框沿用历史口径（整模型反推一棵树）；多框逐框建树后走装配体反推，
 * 且要求拼接关系由几何明确证明（strictJoins）。任何关键几何丢失都会体现在
 * issues（critical=true）与 complete=false 上，调用方不得静默采用部分结果。
 */
export interface LegacyMigrationOptions {
  installGap: number;
  frameWidthMm: number;
}

export interface LegacyMigrationResult {
  assembly: WindowAssembly | null;
  issues: LegacyIssue[];
  /** 仅当无关键丢失且装配体构建成功时为 true */
  complete: boolean;
}

export function migrateLegacyShapes(
  shapes: LegacyShape[],
  ctx: LegacyImportContext,
  opts: LegacyMigrationOptions,
): LegacyMigrationResult {
  const built = buildDesignModelFromLegacyShapesWithReport(shapes, ctx);
  const issues: LegacyIssue[] = [...built.issues];
  if (!built.model) return { assembly: null, issues, complete: false };

  const treeOpts = {
    installGap: opts.installGap,
    name: ctx.design.name,
    seriesId: ctx.design.seriesId,
    glassId: ctx.design.glassId,
    frameWidthMm: opts.frameWidthMm,
  };
  const frameCount = built.model.components.filter((c) => c.kind === 'outerFrame').length;

  if (frameCount <= 1) {
    const tree = treeFromDesignModel(built.model, treeOpts);
    if (!tree) {
      issues.push({ code: 'frame-tree-failed', critical: true, message: '外框无法反推容器树' });
      return { assembly: null, issues, complete: false };
    }
    return {
      assembly: assemblyFromWindowTree(tree),
      issues,
      complete: !issues.some((i) => i.critical),
    };
  }

  const checked = assemblyFromDesignModelWithReport(built.model, { ...treeOpts, strictJoins: true });
  issues.push(...checked.issues);
  return {
    assembly: checked.assembly,
    issues,
    complete: !!checked.assembly && !issues.some((i) => i.critical),
  };
}
