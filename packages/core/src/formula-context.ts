import type { SeriesCutRow, SeriesSpec, WindowType } from '@wdd/schema';
import type { DesignGeometry } from './geometry.js';
import { evaluateFormula, type FormulaContext } from './formula.js';

/** 型材角色公式配置项：长度公式 / 数量公式（均为可选，缺省时回退内置算法） */
export interface FormulaEntry {
  length?: string;
  count?: string;
}

export type { FormulaContext };

/** 型材角色中文名（前端公式配置入口展示） */
export const PROFILE_ROLE_LABEL: Record<string, string> = {
  frame: '框料',
  sash: '扇料',
  mullion: '中梃',
  track: '上滑轨',
  sill: '下滑框',
  bead: '压线',
  auxiliary: '附框',
};

/** 各窗型参与算料的型材角色（前端配置入口按窗型分组展示） */
export const WINDOW_TYPE_ROLES: Record<WindowType, string[]> = {
  fixed: ['frame', 'mullion', 'bead'],
  casement: ['frame', 'sash', 'mullion', 'bead'],
  sliding: ['frame', 'track', 'sill', 'sash', 'mullion', 'bead'],
  topHinged: ['frame', 'sash', 'mullion', 'bead'],
  casementUp: ['frame', 'sash', 'mullion', 'bead'],
  // 内倒平移扇：既内倒又平移，除扇料外还走滑轨
  tiltSlide: ['frame', 'sash', 'track', 'mullion', 'bead'],
};

interface SizesLike {
  frameOuterW: number;
  frameOuterH: number;
  frameInnerW: number;
  frameInnerH: number;
}

/** 外框尺寸上下文（几何路径与画布构件路径共用） */
export function formulaContextFromSizes(sizes: SizesLike): FormulaContext {
  return {
    frameOuterW: sizes.frameOuterW,
    frameOuterH: sizes.frameOuterH,
    frameInnerW: sizes.frameInnerW,
    frameInnerH: sizes.frameInnerH,
    outerW: sizes.frameOuterW,
    outerH: sizes.frameOuterH,
  };
}

interface GeometryLike {
  sizes: SizesLike;
}

interface DesignLike {
  openingW: number;
  openingH: number;
}

/** 外框 + 洞口 + 系列常量上下文（各型材角色均可使用） */
export function formulaContextFromGeometry(
  geometry: GeometryLike,
  series: SeriesSpec,
  design: DesignLike,
): FormulaContext {
  return {
    ...formulaContextFromSizes(geometry.sizes),
    openingW: design.openingW,
    openingH: design.openingH,
    frameWidth: series.frameWidth,
    sashWidth: series.sashWidth,
    overlap: series.overlap,
    glassGap: series.glassGap,
    beadWidth: series.beadWidth,
  };
}

/** 面板/扇区级上下文：在外框上下文之上叠加扇口、扇料与玻璃尺寸 */
export function formulaContextFromPanel(
  geometry: DesignGeometry,
  series: SeriesSpec,
  design: DesignLike,
  panel: DesignGeometry['sizes']['panels'][number],
): FormulaContext {
  return {
    ...formulaContextFromGeometry(geometry, series, design),
    panelOpenW: panel.panelOpenW,
    panelOpenH: panel.panelOpenH,
    sashW: panel.sashW,
    sashH: panel.sashH,
    glassW: panel.glassW,
    glassH: panel.glassH,
    sashCount: panel.sashCount,
  };
}

/** @deprecated 前端公式配置弹窗（FormulaConfigModal）仍在使用的旧校验；v2 请用 validateCutRows */
export function validateFormulaEntries(
  entries: Record<string, FormulaEntry>,
  context: FormulaContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [role, entry] of Object.entries(entries)) {
    for (const kind of ['length', 'count'] as const) {
      const expr = entry[kind]?.trim();
      if (!expr) continue;
      const result = evaluateFormula(expr, context);
      if (!result.ok) errors[`${role}.${kind}`] = result.error ?? '公式无效';
    }
  }
  return errors;
}

// =====================================================================
// 出料行（cuts）解析 —— 对标 windoorcraft product_bar
// =====================================================================

/** 从系列取出料行（未配置为空数组） */
export function getCutRows(series: SeriesSpec): SeriesCutRow[] {
  return series.cuts ?? [];
}

/** 有效条件上下文：公式求值器只收 number，枚举变量（开向/窗型等）走这里 */
export interface CutEnumContext {
  [key: string]: string;
}

/**
 * 公式库引用解析：`cc-N` → formulaBank[N]；非 cc-N 或 bank 缺失时原样返回（当作内联表达式）。
 * 注意 ref 解析后仍可能为空 → 调用方回退内置。
 */
export function resolveCutFormulaRef(expr: string | undefined, bank: Record<string, string>): string {
  const m = /^cc-(\d+)\s*$/i.exec((expr ?? '').trim());
  if (!m) return expr ?? '';
  return bank[m[1]] ?? '';
}

/** 解析出料行长度（mm）：cc-N → bank → evaluateFormula；空/非法回退 fallback */
export function resolveCutLength(
  row: SeriesCutRow,
  series: SeriesSpec,
  context: FormulaContext,
  fallback: number,
): number {
  const expr = resolveCutFormulaRef(row.length, series.formulaBank ?? {});
  if (!expr) return fallback;
  const result = evaluateFormula(expr, context);
  return result.ok ? result.value : fallback;
}

/**
 * 解析出料行数量（每边根数）：cc-N → bank → evaluateFormula；未配置/非法回退 fallback（缺省 1）。
 * 表达式结果为 0 表示该行不产出（如固定窗的 sashCount=0），调用方按 count<=0 跳过，不做 max(1) 抬高。
 */
export function resolveCutCount(
  row: SeriesCutRow,
  series: SeriesSpec,
  context: FormulaContext,
  fallback = 1,
): number {
  const expr = resolveCutFormulaRef(row.count, series.formulaBank ?? {});
  if (!expr) return fallback;
  const result = evaluateFormula(expr, context);
  return result.ok ? Math.max(0, Math.round(result.value)) : fallback;
}

/**
 * 有效条件求值：`变量="枚举值"` 用 && 连接，全部匹配才生效（空条件 = 永真）。
 * 无法解析的分支按「不生效」处理（保守：宁缺毋滥）。
 */
export function evaluateCutCondition(condition: string | undefined, enumCtx: CutEnumContext): boolean {
  const cond = (condition ?? '').trim();
  if (!cond) return true;
  const parts = cond.split('&&');
  for (const part of parts) {
    const m = /^\s*([^=\s"]+)\s*=\s*"([^"]*)"\s*$/.exec(part);
    if (!m) return false;
    if (enumCtx[m[1]] !== m[2]) return false;
  }
  return true;
}

/** 从 showSetting 料宽字典生成公式变量上下文（只收有限数值） */
export function contextFromShowSetting(showSetting: Record<string, number> | undefined): FormulaContext {
  const out: FormulaContext = {};
  for (const [k, v] of Object.entries(showSetting ?? {})) {
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** 完整公式上下文：showSetting 垫底，显式几何/系列变量覆盖（避免与 geometry 口径打架） */
export function formulaContextWithShowSetting(
  showSetting: Record<string, number> | undefined,
  base: FormulaContext,
): FormulaContext {
  return { ...contextFromShowSetting(showSetting), ...base };
}

/** v1 profileFormulas（role → {length?,count?}）迁移为 v2 出料行表：
 * frame 旧 count 是「总 N 根」，side 展开会吸收（固定 count 1）；sash 旧每扇 count ×sashCount → panel 行 count='sashCount*N' */
export function migrateLegacyFormulaConfig(
  legacy: Record<string, { length?: string; count?: string }>,
): { cuts: SeriesCutRow[]; formulaBank: Record<string, string> } {
  const cuts: SeriesCutRow[] = [];
  let seq = 0;
  const next = () => `legacy-${seq++}`;
  for (const [role, entry] of Object.entries(legacy ?? {})) {
    if (role === 'frame') {
      cuts.push({ id: next(), label: '横框', role: 'frame', side: ['up', 'down'], length: entry.length ?? '', count: '1', scope: 'window' });
      cuts.push({ id: next(), label: '竖框', role: 'frame', side: ['left', 'right'], length: '', count: '1', scope: 'window' });
    } else if (role === 'sash') {
      const perSash = entry.count && /^\d+$/.test(entry.count.trim()) ? `sashCount*${entry.count.trim()}` : 'sashCount';
      cuts.push({ id: next(), label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: entry.length ?? '', count: perSash, scope: 'panel' });
      cuts.push({ id: next(), label: '扇料(竖)', role: 'sash', side: ['left', 'right'], length: '', count: perSash, scope: 'panel' });
    } else {
      cuts.push({ id: next(), label: role, role, side: [], length: entry.length ?? '', count: entry.count ?? '1', scope: 'window' });
    }
  }
  return { cuts, formulaBank: {} };
}

/** 校验出料行表：返回 {行id.字段: 错误}；cc-N 引用须在 formulaBank 中存在，length/count 可求值 */
export function validateCutRows(
  rows: SeriesCutRow[],
  bank: Record<string, string>,
  context: FormulaContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    for (const kind of ['length', 'count'] as const) {
      const raw = row[kind];
      if (!raw || !raw.trim()) continue;
      const ref = resolveCutFormulaRef(raw, bank);
      if (/^cc-\d+$/i.test(raw.trim()) && !ref) {
        errors[`${row.id}.${kind}`] = `公式库缺少引用 ${raw.trim()}`;
        continue;
      }
      const result = evaluateFormula(ref, context);
      if (!result.ok) errors[`${row.id}.${kind}`] = result.error ?? '公式无效';
    }
  }
  return errors;
}