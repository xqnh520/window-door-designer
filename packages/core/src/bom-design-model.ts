import type { DesignComponent, DesignFitting, DesignModel, MaterialLibrary, SeriesSpec, WindowType } from '@wdd/schema';
import { resolveProfile, type BomItem, type BomOptions, type BomResult, defaultBomOptions } from './bom.js';
import {
  evaluateCutCondition,
  formulaContextFromDesignModel,
  formulaContextWithShowSetting,
  resolveCutCount,
  resolveCutLength,
  type FormulaContext,
} from './formula-context.js';
import { PANEL_KINDS, resolveBomCalculator, type BomCalculator, type BomCalculatorContext } from './bom-calculator.js';
import { COMBINER_LABEL, CORNER_LABEL } from './window-assembly-corner.js';
import { outlineFourSides, polygonArea, polygonLen } from './outline.js';
import { resolveComponentType, type ComponentTypeDef } from './component-registry.js';
import { resolveFittingType, type FittingType } from './fitting-registry.js';

const SASH_KINDS = new Set(['casementSash', 'slidingSash', 'topHungSash']);

/** 纱窗纱网单价（元/扇）；后续可迁移到系列/材料库配置 */
const SCREEN_NET_PRICE = 45;
/** 百叶帘片单价（元/扇）；与纱网同一约定，后续可迁移到系列/材料库配置 */
const LOUVER_PRICE = 120;
/** 肯德基门下板（板材）单价（元/扇）；同上，占位价待接入材料库 */
const PANEL_PRICE = 260;
/** 配件默认单价（元/套）：五金与辅料类配件暂无库价，先用默认值进入报价 */
const FITTING_HW_PRICE = 15;
const FITTING_ACC_PRICE = 5;

/**
 * BOM 计算器注册表（按顺序选择第一个适用的）：
 * 观景窗（大玻璃+加强件）→ 推拉窗 → 上悬窗 → 平开/固定窗（兜底）。
 * 新增窗型时注册新的计算器即可，不修改既有计算器。
 * 注：定义在文件末尾，避免计算器声明顺序问题。
 */
export const bomCalculators: BomCalculator[] = [];

export function computeBomFromDesignModel(
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  options: BomOptions = defaultBomOptions,
): BomResult {
  const frames = model.components.filter((c) => c.kind === 'outerFrame');
  const context = modelFormulaContext(model, series);
  const input: BomCalculatorContext = { model, series, library, options, context, frames };
  const calculator = resolveBomCalculator(input, bomCalculators);
  const items = calculator.compute(input);

  const glassHosts = model.components.filter((c) => PANEL_KINDS.has(c.kind));
  addAccessoryItems(items, library, glassHosts, series, options);
  addFittingItems(items, model, series, library, model.fittings ?? []);

  const billedAreaM2 = computeComponentBilledArea(glassHosts, series, options.minAreaPerPanel);
  const totalAmount = round2(items.reduce((sum, item) => sum + item.amount, 0));
  return { items, totalAmount, billedAreaM2 };
}

// ── 计算器：观景窗 ───────────────────────────────────────────

const viewBomCalculator: BomCalculator = {
  id: 'view',
  label: '观景窗',
  supports: ({ model, series }) =>
    !model.components.some((c) => SASH_KINDS.has(c.kind)) &&
    model.components.some((c) => c.kind === 'fixedGlass') &&
    !!series.profileRoles?.viewEnhance,
  compute: (input) => {
    const items = commonCompute(input);
    applyModelViewEnhanceCut(input, items);
    return items;
  },
};

/** 观景窗加强件：有 window 级 viewEnhance 出料行时按行出（count 用 frameCount*4），否则回退旧内置 */
function applyModelViewEnhanceCut(input: BomCalculatorContext, items: BomItem[]): void {
  const { series, library } = input;
  const row = (series.cuts ?? []).find(
    (r) => (r.scope ?? 'window') === 'window' && r.role === 'viewEnhance',
  );
  if (!row) {
    addViewEnhanceItems(input, items);
    return;
  }
  const profile = resolveSeriesProfile(library, series, row.role);
  if (!profile) return;
  const context = formulaContextWithShowSetting(series.showSetting, {
    ...input.context,
    frameCount: Math.max(1, input.frames.length),
  });
  const length = resolveCutLength(row, series, context, 80);
  if (!Number.isFinite(length)) return;
  const count = Math.max(1, (row.side?.length ?? 0)) * resolveCutCount(row, series, context, Math.max(1, input.frames.length) * 4);
  if (count <= 0) return;
  items.push({
    key: `dm-view-${row.id}-${profile.id}`,
    category: 'profile',
    materialId: profile.id,
    code: profile.code,
    name: row.label,
    spec: `${series.name}/${profile.name} ${Math.max(1, Math.round(length))}mm`,
    unit: '支',
    quantity: count,
    unitPrice: profile.unitPrice,
    amount: round2((Math.max(1, Math.round(length)) / 1000) * profile.unitPrice * count),
    sourceComponentId: input.frames[0]?.id,
    parentComponentId: input.frames[0]?.parentId,
  });
}

/** 观景窗加强件：系列配置 viewEnhance 角色时按四角输出加强角码 */
function addViewEnhanceItems(input: BomCalculatorContext, items: BomItem[]): void {
  const roleId = input.series.profileRoles?.viewEnhance;
  if (!roleId) return;
  const profile = input.library.profiles.find((p) => p.id === roleId);
  if (!profile) return;
  const count = Math.max(1, input.frames.length) * 4;
  items.push({
    key: `view-bracket-${profile.id}`,
    category: 'profile',
    materialId: profile.id,
    code: profile.code,
    name: '加强角码(观景)',
    spec: `${input.series.name}/${profile.name}`,
    unit: '支',
    quantity: count,
    unitPrice: profile.unitPrice,
    amount: round2(count * profile.unitPrice),
    sourceComponentId: input.frames[0]?.id,
  });
}

// ── 计算器：推拉窗 ───────────────────────────────────────────

const slidingBomCalculator: BomCalculator = {
  id: 'sliding',
  label: '推拉窗',
  supports: ({ model }) => model.components.some((c) => c.kind === 'slidingSash'),
  compute: commonCompute,
};

// ── 计算器：上悬窗（纯上悬，无平开扇） ──────────────────────

const topHungBomCalculator: BomCalculator = {
  id: 'topHung',
  label: '上悬窗',
  supports: ({ model }) =>
    model.components.some((c) => c.kind === 'topHungSash') && !model.components.some((c) => c.kind === 'casementSash'),
  compute: commonCompute,
};

// ── 计算器：平开/固定窗（兜底） ──────────────────────────────

const casementBomCalculator: BomCalculator = {
  id: 'casement',
  label: '平开/固定窗',
  supports: () => true,
  compute: commonCompute,
};

/** 公共算料流程：按外框 → 中梃 → 面板（玻璃/压线/五金）逐构件输出（兼容任意组合窗多框） */
function commonCompute(input: BomCalculatorContext): BomItem[] {
  const { model, series, library, context, frames } = input;
  const items: BomItem[] = [];
  for (const frame of frames) addOuterFrameItems(items, model, series, library, frame, context);
  const mullions = model.components.filter((c) => c.kind === 'mullion');
  for (const m of mullions) addMullionItem(items, model, series, library, m, context);
  const combiners = model.components.filter((c) => c.kind === 'combiner');
  for (const cb of combiners) addCombinerItem(items, model, series, library, cb, context);
  const glassHosts = model.components.filter((c) => PANEL_KINDS.has(c.kind));
  for (const c of glassHosts) addComponentPanelItems(items, model, series, library, c);
  return items;
}

/** 模型级基础上下文：洞口、外框内/外尺寸与系列常量 */
function modelFormulaContext(model: DesignModel, series: SeriesSpec): FormulaContext {
  return formulaContextFromDesignModel(model, series);
}

/** window 级出料行（model 语境版）：per-frame 应用，side 展开 ×count；viewEnhance 行由观景计算器单独处理 */
function applyModelWindowCutRows(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  context: FormulaContext,
  frameId: string,
  open: ('up' | 'down' | 'left' | 'right')[] = [],
): void {
  const wctx = formulaContextWithShowSetting(series.showSetting, context);
  for (const row of series.cuts ?? []) {
    if ((row.scope ?? 'window') !== 'window' || row.role === 'viewEnhance') continue;
    if (!evaluateCutCondition(row.condition, { windowFamily: series.windowFamily, seriesId: series.id })) continue;
    const profile = resolveSeriesProfile(library, series, row.role);
    if (!profile) continue;
    // 缺边：该行覆盖的边里扣掉被缺的边，全被缺则整行不出
    const sides = (row.side ?? []).filter((s) => !open.includes(s as 'up'));
    if ((row.side ?? []).length > 0 && sides.length === 0) continue;
    const useH = sides.some((s) => s === 'left' || s === 'right');
    const length = resolveCutLength(row, series, wctx, useH ? wctx.frameOuterH : wctx.frameOuterW);
    if (!Number.isFinite(length)) continue;
    const count = sides.length * resolveCutCount(row, series, wctx, 1);
    if (count <= 0) continue;
    pushProfile(items, model, profile, row.label, length, count, series, frameId, row.angle);
  }
}

function addOuterFrameItems(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  frame: DesignComponent,
  context: FormulaContext,
): void {
  type Side = 'up' | 'down' | 'left' | 'right';
  const open: Side[] = (frame.openSides ?? []) as Side[];
  const missing = (sides: Side[]): number => sides.filter((s) => open.includes(s)).length;
  // 异形外框：按采样轮廓的四边链长出料（顶/底/左/右各 1 根），弧/斜边长由轮廓折线折算；缺边不出该行
  if (frame.shape && frame.shape !== 'rect' && frame.contour) {
    const pts = toPtArr(frame.contour);
    const sides = outlineFourSides(pts);
    const profile = resolveSeriesProfile(library, series, 'frame');
    const row = (label: string, len: number): void => {
      pushProfile(items, model, profile, label, Math.max(1, Math.round(len)), 1, series, frame.id);
    };
    if (!open.includes('up')) row('外框顶料(异形)', sides.top);
    if (!open.includes('down')) row('外框底料(异形)', sides.bottom);
    if (!open.includes('left')) row('外框左料(异形)', sides.left);
    if (!open.includes('right')) row('外框右料(异形)', sides.right);
    return;
  }
  const hasWindowCuts = (series.cuts ?? []).some((r) => (r.scope ?? 'window') === 'window' && r.role !== 'viewEnhance');
  if (hasWindowCuts) {
    applyModelWindowCutRows(items, model, series, library, formulaContextFromDesignModel(model, series, frame), frame.id, open);
    return;
  }
  const hasSliding = model.components.some((c) => c.kind === 'slidingSash');
  if (hasSliding) {
    pushProfile(items, model, resolveSeriesProfile(library, series, 'track'), '上滑', frame.w, 1, series, frame.id);
    pushProfile(items, model, resolveSeriesProfile(library, series, 'sill'), '下滑', frame.w, 1, series, frame.id);
    pushProfile(items, model, resolveSeriesProfile(library, series, 'frame'), '边框', frame.h, 2, series, frame.id);
    return;
  }
  const profile = resolveSeriesProfile(library, series, 'frame');
  const hCount = 2 - missing(['up', 'down']);
  const vCount = 2 - missing(['left', 'right']);
  if (hCount > 0) pushProfile(items, model, profile, '外框横料', frame.w, hCount, series, frame.id);
  if (vCount > 0) pushProfile(items, model, profile, '外框竖料', frame.h, vCount, series, frame.id);
}

/** 注册类型构件出料：每 roles 角色一根「轮廓周长」型材 + 需要玻璃时按面板出玻璃 */
function addRoleBomItems(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  c: DesignComponent,
  def: ComponentTypeDef,
): void {
  const len = c.contour && c.contour.length >= 6
    ? Math.max(1, Math.round(polygonLen(toPtArr(c.contour))))
    : Math.max(1, Math.round(2 * (c.w + c.h)));
  for (const roleId of def.roles!) {
    const profile = resolveSeriesProfile(library, series, roleId as 'frame' | 'sash' | 'mullion' | 'bead' | 'track' | 'sill');
    if (!profile) continue;
    pushProfile(items, model, profile, `${def.label}(${roleId})`, len, 1, series, c.id);
  }
  if (def.needsGlass) {
    const glass = library.glass.find((g) => g.id === model.glassId) ?? library.glass[0];
    const unitPrice = glass?.unitPrice ?? 0;
    const openW = Math.max(1, c.w - 2 * series.frameWidth);
    const openH = Math.max(1, c.h - 2 * series.frameWidth);
    const glassW = Math.max(1, Math.round(openW - 2 * series.glassGap));
    const glassH = Math.max(1, Math.round(openH - 2 * series.glassGap));
    const clip = leafClipRatio(c);
    items.push({
      key: `dm-role-glass-${c.id}`,
      category: 'glass',
      materialId: glass?.id ?? model.glassId ?? 'g-5-12a-5',
      code: glass?.name ?? 'GL-001',
      name: `${def.label}玻璃`,
      spec: clip < 1 ? `${glassW}x${glassH}(异形≈${Math.round(clip * 100)}%)` : `${glassW}x${glassH}`,
      unit: '块',
      quantity: 1,
      unitPrice,
      amount: round2(((glassW * glassH) / 1e6) * clip * unitPrice),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
  }
}

/** 配件出料：profile 类按宿主几何出型材；hardware/accessory 按件出辅料/五金行 */
function addFittingItems(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  fittings: DesignFitting[],
): void {
  for (let i = 0; i < fittings.length; i++) {
    const f = fittings[i];
    let def;
    try {
      def = resolveFittingType(f.type as FittingType);
    } catch {
      continue;
    }
    const host = model.components.find((c) => c.id === f.hostId);
    const hostLen = host ? (f.hostKind === 'combiner' ? Math.max(host.w, host.h) : 2 * (host.w + host.h)) : 600;
    const qty = f.count ?? def.count;
    if (def.category === 'profile' && def.role) {
      const profile = resolveSeriesProfile(library, series, def.role);
      if (!profile) continue;
      if (f.lengthsMm?.length) {
        // 逐根下料（如玻璃格条）：按长度分组，下料表里每种长度一行
        const byLen = new Map<number, number>();
        for (const len of f.lengthsMm) {
          const k = Math.max(1, Math.round(len));
          byLen.set(k, (byLen.get(k) ?? 0) + 1);
        }
        for (const [len, n] of [...byLen.entries()].sort((p, q) => q[0] - p[0])) {
          pushProfile(items, model, profile, def.name, len, n, series, f.hostId);
        }
        continue;
      }
      pushProfile(items, model, profile, def.name, Math.max(1, Math.round(hostLen)), qty, series, f.hostId);
      continue;
    }
    const unitPrice = def.category === 'hardware' ? FITTING_HW_PRICE : FITTING_ACC_PRICE;
    items.push({
      key: `fit-${def.id}-${f.hostId}-${i}`,
      category: def.category,
      materialId: `fit-${def.id}`,
      code: `FIT-${def.id.toUpperCase()}`,
      name: def.name,
      spec: `${f.hostLabel ?? host?.label ?? ''} ×${qty}`,
      unit: def.unit,
      quantity: qty,
      unitPrice,
      amount: round2(qty * unitPrice),
      sourceComponentId: f.hostId,
    });
  }
}

const toPtArr = (flat: number[]): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

/**
 * 异形叶裁剪保留比 = 轮廓面积 ÷ 外接矩形面积（0..1]。
 * 矩形叶（无 contour）恒为 1，故矩形 BOM 完全不变；异形叶按真实裁剪后的
 * 多边形面积缩放玻璃与计价面积，修正按 bbox 多算的问题。
 */
function leafClipRatio(c: DesignComponent): number {
  if (!c.contour || c.contour.length < 6) return 1;
  const boxArea = c.w * c.h;
  if (!(boxArea > 0)) return 1;
  const ratio = polygonArea(toPtArr(c.contour)) / boxArea;
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 1;
}

function addMullionItem(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  c: DesignComponent,
  context: FormulaContext,
): void {
  const profile = resolveSeriesProfile(library, series, 'mullion');
  const vertical = c.h >= c.w;
  const arc = c.arcLenMm != null;
  const slopeTag = c.slope === 'diagonal' ? '↘' : c.slope === 'antiDiagonal' ? '↗' : '';
  const name = slopeTag
    ? `斜中梃(${slopeTag})`
    : arc
      ? vertical
        ? '弧中梃(竖)'
        : '弧中梃(横)'
      : vertical
        ? '中梃(竖)'
        : '中梃(横)';
  pushProfile(
    items,
    model,
    profile,
    name,
    // 斜/弧带都按中心线下料：按 bbox 单边算会把 45° 料少算 √2
    arc ? c.arcLenMm! : vertical ? c.h : c.w,
    1,
    series,
    c.id,
  );
}

/**
 * 拼樘/转角料：连接相邻两外框的组合料，成本按中梃角色出。
 * 名称前缀取自构件 label（转角=转角料，直线=拼樘料）；
 * vertical 仍在**加工空间（展开态）**判定，故下料长度=框高，与夹角无关。
 */
function addCombinerItem(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  c: DesignComponent,
  context: FormulaContext,
): void {
  const profile = resolveSeriesProfile(library, series, 'mullion');
  const vertical = c.h >= c.w;
  const prefix = c.label?.startsWith(CORNER_LABEL) ? CORNER_LABEL : COMBINER_LABEL;
  pushProfile(
    items,
    model,
    profile,
    `${prefix}(${vertical ? '竖' : '横'})`,
    vertical ? c.h : c.w,
    1,
    series,
    c.id,
  );
}

/** panel 级出料行（model 语境版）：对普通面板出扇料/压线；异形面板由内置轮廓路径处理 */
function applyModelPanelCutRows(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  c: DesignComponent,
  panelContext: FormulaContext,
): void {
  const ctx = formulaContextWithShowSetting(series.showSetting, panelContext);
  const enumCtx = { windowFamily: series.windowFamily, seriesId: series.id, windowType: componentWindowType(c) };
  for (const row of series.cuts ?? []) {
    if ((row.scope ?? 'window') !== 'panel') continue;
    if (!evaluateCutCondition(row.condition, enumCtx)) continue;
    const profile = resolveSeriesProfile(library, series, row.role);
    if (!profile) continue;
    const horizontal = (row.side ?? []).some((s) => s === 'up' || s === 'down');
    const fallback = row.unit === '米'
      ? 2 * (panelContext.glassW ?? 0) + 2 * (panelContext.glassH ?? 0)
      : horizontal ? (panelContext.sashW ?? panelContext.panelOpenW ?? 0) : (panelContext.sashH ?? panelContext.panelOpenH ?? 0);
    const length = resolveCutLength(row, series, ctx, fallback);
    if (!Number.isFinite(length)) continue;
    if (row.unit === '米') {
      items.push({
        key: `dm-bead-${c.id}-${row.id}`,
        category: 'profile',
        materialId: profile.id,
        code: profile.code,
        name: row.label,
        spec: `${series.name}/${profile.name} ${Math.round(panelContext.glassW)}x${Math.round(panelContext.glassH)}`,
        unit: '米',
        quantity: round2(length / 1000),
        unitPrice: profile.unitPrice,
        amount: round2((length / 1000) * profile.unitPrice),
        sourceComponentId: c.id,
        parentComponentId: c.parentId,
      });
      continue;
    }
    const count = (row.side?.length ?? 0) * resolveCutCount(row, series, ctx, 1);
    if (count <= 0) continue;
    pushProfile(items, model, profile, row.label, length, count, series, c.id, row.angle);
  }
}

function addComponentPanelItems(
  items: BomItem[],
  model: DesignModel,
  series: SeriesSpec,
  library: MaterialLibrary,
  c: DesignComponent,
): void {
  const componentContext = formulaContextFromDesignModel(model, series, c);
  // 构件体系扩展：roleType 命中注册表时按 roles 出料（每角色一圈型材 + 可选玻璃），避免旧 kind 判定误算
  if (c.roleType) {
    const def = resolveComponentType(c.roleType);
    if (def) {
      addRoleBomItems(items, model, series, library, c, def);
      return;
    }
  }
  // 纱窗：纱扇料（复用扇料剖面）+ 纱网（按扇计价），无玻璃/压线/开启五金
  if (c.kind === 'screen') {
    const sashW = Math.max(1, Math.round(c.w - 2 * series.frameWidth + 2 * series.overlap));
    const sashH = Math.max(1, Math.round(c.h - 2 * series.frameWidth + 2 * series.overlap));
    const sash = resolveSeriesProfile(library, series, 'sash');
    pushProfile(items, model, sash, '纱扇料(横)', sashW, 2, series, c.id);
    pushProfile(items, model, sash, '纱扇料(竖)', sashH, 2, series, c.id);
    items.push({
      key: `dm-screen-net-${c.id}`,
      category: 'accessory',
      materialId: 'acc-screen',
      code: 'AC-SC01',
      name: '不锈钢纱网',
      spec: `${sashW}x${sashH}（按扇计价）`,
      unit: '个',
      quantity: 1,
      unitPrice: SCREEN_NET_PRICE,
      amount: round2(SCREEN_NET_PRICE),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
    return;
  }

  const hasSash = c.kind !== 'fixedGlass';
  const leaves = c.leaves ?? 1;
  const meeting = Math.max(1, c.meetingWidthMm ?? 60);
  const sashCount = c.kind === 'slidingSash' ? 2 : hasSash ? leaves : 0;
  const openW = Math.max(1, c.w - 2 * series.frameWidth);
  const openH = Math.max(1, c.h - 2 * series.frameWidth);
  const sashW = c.kind === 'slidingSash'
    ? Math.round((openW + series.overlap) / 2)
    : leaves === 2
      ? Math.round((openW + meeting) / 2) // 对开扇：两叶在中缝重叠一根对开料（实测左扇 799..1349 / 右扇 1289..1876）
      : Math.round(openW - 2 * series.frameWidth + 2 * series.overlap);
  const sashH = c.kind === 'slidingSash'
    ? Math.round(openH - 2 * series.frameWidth + 2 * series.overlap)
    : Math.round(openH - 2 * series.frameWidth + 2 * series.overlap);
  const glassW = hasSash
    ? Math.max(1, Math.round(sashW - (leaves === 2 ? series.sashWidth + meeting : 2 * series.sashWidth) - 2 * series.glassGap))
    : Math.max(1, Math.round(openW - 2 * series.glassGap));
  /** 上玻下板（实测肯德基门下板 200mm）：玻璃只剩上半，还要再让出一根中横档 */
  const panelH = c.infill === 'panel' ? Math.max(1, c.panelHeightMm ?? 200) : 0;
  const glassH = hasSash
    ? Math.max(1, Math.round(sashH - 2 * series.sashWidth - 2 * series.glassGap - (panelH ? panelH + series.sashWidth : 0)))
    : Math.max(1, Math.round(openH - 2 * series.glassGap));
  const panelContext: FormulaContext = {
    ...componentContext,
    panelOpenW: openW,
    panelOpenH: openH,
    sashW,
    sashH,
    glassW,
    glassH,
    sashCount,
  };

  const irregular = !!c.contour && c.contour.length >= 6;
  const hasPanelCuts = (series.cuts ?? []).some((r) => (r.scope ?? 'window') === 'panel');

  if (hasPanelCuts && !irregular) {
    // 普通面板：扇料/压线走出料行表（side 展开、米行按周长/1000）
    applyModelPanelCutRows(items, model, series, library, c, panelContext);
  } else if (hasSash) {
    const sash = resolveSeriesProfile(library, series, 'sash');
    if (irregular && sashCount === 1) {
      // 异形单扇：按轮廓四边出 4 根扇料（顶/底/左/右），贴合斜边/弧边（与异形外框同口径，绕过公式取原始边长）
      const sides = outlineFourSides(toPtArr(c.contour!));
      pushProfile(items, model, sash, '扇料顶(异形)', Math.max(1, Math.round(sides.top)), 1, series, c.id);
      pushProfile(items, model, sash, '扇料底(异形)', Math.max(1, Math.round(sides.bottom)), 1, series, c.id);
      pushProfile(items, model, sash, '扇料左(异形)', Math.max(1, Math.round(sides.left)), 1, series, c.id);
      pushProfile(items, model, sash, '扇料右(异形)', Math.max(1, Math.round(sides.right)), 1, series, c.id);
    } else {
      // 无出料行配置：内置默认每扇横/竖各 2 根
      pushProfile(items, model, sash, '扇料(横)', sashW, 2 * sashCount, series, c.id);
      pushProfile(items, model, sash, '扇料(竖)', sashH, 2 * sashCount, series, c.id);
    }
  }

  // 对开扇：竖料有一半是中缝对开料（更宽，单列一行）——公式行与内置回退两条路径都这样校正
  if (hasSash && leaves === 2) {
    const sashProfile = resolveSeriesProfile(library, series, 'sash');
    for (const item of items) {
      if (item.sourceComponentId === c.id && item.name === '扇料(竖)' && item.quantity >= 2) {
        item.quantity = Math.round(item.quantity / 2);
      }
    }
    if (sashProfile) pushProfile(items, model, sashProfile, '对开料(中缝)', sashH, 2, series, c.id);
  }

  if (!hasPanelCuts || irregular) {
    const bead = resolveSeriesProfile(library, series, 'bead');
    for (let i = 0; i < Math.max(sashCount, 1); i++) {
      const beadLen = irregular
        ? Math.max(1, Math.round(polygonLen(toPtArr(c.contour!))))
        : 2 * glassW + 2 * glassH;
      items.push({
        key: `dm-bead-${c.id}-${i}`,
        category: 'profile',
        materialId: bead.id,
        code: bead.code,
        name: '压线',
        spec: irregular ? `${series.name}/${bead.name} ${glassW}x${glassH}(异形)` : `${series.name}/${bead.name} ${glassW}x${glassH}`,
        unit: '米',
        quantity: round2(beadLen / 1000),
        unitPrice: bead.unitPrice,
        amount: round2((beadLen / 1000) * bead.unitPrice),
        sourceComponentId: c.id,
        parentComponentId: c.parentId,
      });
    }
  }

  // 上玻下板：板顶多一根中横档，下部横板按扇出料
  const glassQuantity = Math.max(sashCount, 1);
  if (hasSash && panelH > 0) {
    const rail = resolveSeriesProfile(library, series, 'sash');
    if (rail) pushProfile(items, model, rail, '中横档(下板顶)', sashW, Math.max(1, sashCount), series, c.id);
    items.push({
      key: `dm-panel-${c.id}`,
      category: 'accessory',
      materialId: 'acc-panel',
      code: 'AC-PL01',
      name: '板材(下板)',
      spec: `${sashW}x${panelH}（按扇计价）`,
      unit: '个',
      quantity: glassQuantity,
      unitPrice: PANEL_PRICE,
      amount: round2(PANEL_PRICE * Math.max(sashCount, 1)),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
  }

  // 百叶扇：无玻璃就没有压线（公式行与内置回退两条路径都按构件归属剔除）
  const louver = c.infill === 'louver';
  if (louver) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].sourceComponentId === c.id && items[i].name === '压线') items.splice(i, 1);
    }
  }

  if (louver) {
    items.push({
      key: `dm-louver-${c.id}`,
      category: 'accessory',
      materialId: 'acc-louver',
      code: 'AC-LV01',
      name: '百叶帘片',
      spec: `${sashW}x${sashH}（按扇计价）`,
      unit: '个',
      quantity: glassQuantity,
      unitPrice: LOUVER_PRICE,
      amount: round2(LOUVER_PRICE * Math.max(sashCount, 1)),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
  } else {
    const glass = library.glass.find((g) => g.id === model.glassId) ?? library.glass[0];
    const clip = leafClipRatio(c);
    const glassAreaM2 = ((glassW * glassH) / 1e6) * clip;
    items.push({
      key: `dm-glass-${c.id}`,
      category: 'glass',
      materialId: glass.id,
      code: glass.name,
      name: glass.name,
      spec: clip < 1 ? `${glassW}x${glassH}(异形≈${Math.round(clip * 100)}%)` : `${glassW}x${glassH}`,
      unit: '块',
      quantity: glassQuantity,
      unitPrice: glass.unitPrice,
      amount: round2(glassAreaM2 * glassQuantity * glass.unitPrice),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
  }

  addHardwareItems(items, library, c, sashCount, sashH, componentWindowType(c));
}

function addHardwareItems(
  items: BomItem[],
  library: MaterialLibrary,
  c: DesignComponent,
  sashCount: number,
  sashH: number,
  windowType: WindowType,
): void {
  if (c.kind === 'fixedGlass' || sashCount === 0) return;
  const push = (id: string, name: string, unit: '个' | '只' | '套' | '把' | '支', count: number) => {
    const hw = library.hardware.find((h) => h.id === id);
    if (!hw) return;
    items.push({
      key: `dm-${id}-${c.id}`,
      category: 'hardware',
      materialId: hw.id,
      code: hw.code,
      name,
      spec: hw.name,
      unit,
      quantity: count,
      unitPrice: hw.unitPrice,
      amount: round2(count * hw.unitPrice),
      sourceComponentId: c.id,
      parentComponentId: c.parentId,
    });
  };

  if (windowType === 'sliding') {
    push('hw-slider', '推拉滑轮', '只', sashCount * 2);
    push('hw-slidinglock', '推拉锁', '把', Math.max(1, Math.floor(sashCount / 2)));
    return;
  }
  if (windowType === 'topHinged') {
    push('hw-tophinge', '上悬滑撑', '只', 2 * sashCount);
    push('hw-handle', '执手', '支', 1 * sashCount);
    return;
  }
  if (windowType === 'tiltSlide') {
    // 内倒平移：平开五金一套 + 滑轨走轮 + 内开内倒五金
    push('hw-slider', '推拉滑轮', '只', 2 * sashCount);
    push('hw-turn-tilt', '内开内倒五金', '套', 1 * sashCount);
  }
  // 每片扇叶各一套五金（对开扇 sashCount=2）
  push('hw-hinge', '平开合页', '只', 2 * sashCount);
  push('hw-handle', '执手', '支', 1 * sashCount);
  const transmissionLen = Math.max(1, Math.ceil(sashH / 400));
  push('hw-transmission', '传动器', '支', transmissionLen * sashCount);
  push('hw-lockpoint', '锁点', '个', Math.max(2, transmissionLen * 2) * sashCount);
}

function addAccessoryItems(
  items: BomItem[],
  library: MaterialLibrary,
  glassHosts: DesignComponent[],
  series: SeriesSpec,
  options: BomOptions,
): void {
  const area = computeComponentBilledArea(glassHosts, series, options.minAreaPerPanel);
  for (const acc of library.accessory) {
    const quantity = round2(area * acc.perM2);
    items.push({
      key: `dm-acc-${acc.id}`,
      category: 'accessory',
      materialId: acc.id,
      code: acc.code,
      name: acc.name,
      spec: `用量 ${acc.perM2}/㎡`,
      unit: acc.unit,
      quantity,
      unitPrice: acc.unitPrice,
      amount: round2(quantity * acc.unitPrice),
    });
  }
}

function componentWindowType(c: DesignComponent): WindowType {
  if (c.windowType) return c.windowType;
  if (c.kind === 'slidingSash') return 'sliding';
  if (c.kind === 'topHungSash') return 'topHinged';
  if (c.kind === 'casementSash') return 'casement';
  return 'fixed';
}

function resolveSeriesProfile(library: MaterialLibrary, series: SeriesSpec, role: string) {
  const mapped = (series as SeriesSpec & { profileRoles?: Record<string, string> }).profileRoles?.[role];
  if (mapped) {
    const found = library.profiles.find((p) => p.id === mapped);
    if (found) return found;
  }
  return resolveProfile(library, series.id, role);
}

function computeComponentBilledArea(glassHosts: DesignComponent[], series: SeriesSpec, minAreaPerPanel: number): number {
  let sum = 0;
  for (const c of glassHosts) {
    const openW = Math.max(1, c.w - 2 * series.frameWidth);
    const openH = Math.max(1, c.h - 2 * series.frameWidth);
    sum += Math.max(((openW * openH) / 1e6) * leafClipRatio(c), minAreaPerPanel);
  }
  return round2(sum);
}

function pushProfile(
  items: BomItem[],
  model: DesignModel,
  profile: { id: string; code: string; name: string; unitPrice: number },
  name: string,
  lengthMm: number,
  count: number,
  series: SeriesSpec,
  sourceComponentId: string,
  cutAngle?: string,
): void {
  const length = Math.max(1, Math.round(lengthMm));
  const lengthM = length / 1000;
  items.push({
    key: `dm-${profile.id}-${sourceComponentId}-${name}-${length}`,
    category: 'profile',
    materialId: profile.id,
    code: profile.code,
    name,
    spec: `${series.name}/${profile.name} ${length}mm`,
    unit: '支',
    quantity: count,
    unitPrice: profile.unitPrice,
    amount: round2(lengthM * profile.unitPrice * count),
    sourceComponentId,
    parentComponentId: model.components.find((c) => c.id === sourceComponentId)?.parentId,
    cutAngle,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// 计算器注册顺序：观景窗 → 推拉窗 → 上悬窗 → 平开/固定窗（兜底）
bomCalculators.push(viewBomCalculator, slidingBomCalculator, topHungBomCalculator, casementBomCalculator);
