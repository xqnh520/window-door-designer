import type { MaterialLibrary, MaterialUnit, SeriesSpec, WindowDesign } from '@wdd/schema';
import { computeGeometry, type DesignGeometry } from './geometry.js';
import {
  evaluateCutCondition,
  formulaContextFromGeometry,
  formulaContextFromPanel,
  formulaContextWithShowSetting,
  resolveCutCount,
  resolveCutLength,
} from './formula-context.js';

export type BomCategory = 'profile' | 'glass' | 'hardware' | 'accessory';

export interface BomItem {
  key: string;
  category: BomCategory;
  materialId: string;
  code: string;
  name: string;
  spec: string;
  /** 单位复用物料档案枚举，保证 BOM 行可直接用于建档 / 领料出库 */
  unit: MaterialUnit;
  quantity: number;
  unitPrice: number;
  amount: number;
  sourceComponentId?: string;
  parentComponentId?: string;
  /** 行级切角（出料行配置），下料优先于系列默认组角 */
  cutAngle?: string;
}

export interface BomResult {
  items: BomItem[];
  totalAmount: number;
  billedAreaM2: number;
}

export interface BomOptions {
  minAreaPerPanel: number;
}

export const defaultBomOptions: BomOptions = {
  minAreaPerPanel: 1.5,
};

export function computeBom(
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  options: BomOptions = defaultBomOptions,
): BomResult {
  const geometry = computeGeometry(design, series);
  const items: BomItem[] = [];

  addFrameItems(items, design, series, library, geometry);
  addPanelItems(items, design, series, library, geometry);
  addAccessoryItems(items, library, geometry, options);

  const billedAreaM2 = computeBilledArea(geometry.sizes.panels, options.minAreaPerPanel);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  return { items, totalAmount, billedAreaM2 };
}

function addAccessoryItems(
  items: BomItem[],
  library: MaterialLibrary,
  geometry: DesignGeometry,
  options: BomOptions,
): void {
  const area = computeBilledArea(geometry.sizes.panels, options.minAreaPerPanel);
  for (const acc of library.accessory) {
    const quantity = round2(area * acc.perM2);
    items.push({
      key: `acc-${acc.id}`,
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

export function computeBilledArea(
  panels: { glassW: number; glassH: number }[],
  minAreaPerPanel: number,
): number {
  let sum = 0;
  for (const panel of panels) {
    const area = (panel.glassW * panel.glassH) / 1e6;
    sum += Math.max(area, minAreaPerPanel);
  }
  return round2(sum);
}

/** 按出料行角色解析型材：profileRoles 映射优先（兼容 viewEnhance 等），其次按 category 匹配 */
function resolveCutProfile(
  library: MaterialLibrary,
  series: SeriesSpec,
  role: string,
): { id: string; code: string; name: string; unitPrice: number } | null {
  const mapped = series.profileRoles?.[role];
  if (mapped) {
    const p = library.profiles.find((x) => x.id === mapped);
    if (p) return p;
  }
  return resolveProfile(library, series.id, role);
}

/** window 级出料行：side 展开为 side.length × count 根，长度公式仅求值一次；length 空/非法 → 该行跳过 */
function applyWindowCutRows(
  items: BomItem[],
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  geometry: DesignGeometry,
): void {
  const context = formulaContextWithShowSetting(
    series.showSetting,
    formulaContextFromGeometry(geometry, series, design),
  );
  for (const row of series.cuts ?? []) {
    if ((row.scope ?? 'window') !== 'window') continue;
    if (!evaluateCutCondition(row.condition, { windowFamily: series.windowFamily, seriesId: series.id })) continue;
    const profile = resolveCutProfile(library, series, row.role);
    if (!profile) continue;
    // 空/非法公式回退内置：竖边(left/right)取外框高，横边取外框宽
    const useH = (row.side ?? []).some((s) => s === 'left' || s === 'right');
    const length = resolveCutLength(row, series, context, useH ? context.frameOuterH : context.frameOuterW);
    if (!Number.isFinite(length)) continue;
    const count = (row.side?.length ?? 0) * resolveCutCount(row, series, context, 1);
    if (count <= 0) continue;
    pushProfile(items, profile, row.label, length, count, series, row.id, row.angle);
  }
}

function addFrameItems(
  items: BomItem[],
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  geometry: DesignGeometry,
): void {
  const { mullions } = geometry;
  const hasWindowCuts = (series.cuts ?? []).some((r) => (r.scope ?? 'window') === 'window');

  if (hasWindowCuts) {
    applyWindowCutRows(items, design, series, library, geometry);
  } else {
    // 无出料行配置：回退内置算法（保持「无配置也能算」语义）
    const hasSliding = design.panels.some((p) => p.windowType === 'sliding');
    const context = formulaContextFromGeometry(geometry, series, design);
    if (hasSliding) {
      const track = resolveProfile(library, design.seriesId, 'track');
      const sill = resolveProfile(library, design.seriesId, 'sill');
      const frame = resolveProfile(library, design.seriesId, 'frame');
      pushProfile(items, track, '上滑', context.frameOuterW, 1, series);
      pushProfile(items, sill, '下滑', context.frameOuterW, 1, series);
      pushProfile(items, frame, '边框', context.frameOuterH, 2, series);
    } else {
      const frame = resolveProfile(library, design.seriesId, 'frame');
      pushProfile(items, frame, '横框', context.frameOuterW, 2, series);
      pushProfile(items, frame, '竖框', context.frameOuterH, 2, series);
    }
  }

  const mullion = resolveProfile(library, design.seriesId, 'mullion');
  for (const m of mullions) {
    const label = m.orientation === 'vertical' ? '中梃(竖)' : '中梃(横)';
    pushProfile(items, mullion, label, m.length, 1, series);
  }
}

/** panel 级出料行：每扇区求值一次。支行按 side 展开；米行（压线）整圈只记一次、spec 保留玻璃尺寸 */
function applyPanelCutRows(
  items: BomItem[],
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  geometry: DesignGeometry,
  panel: DesignGeometry['sizes']['panels'][number],
): void {
  const context = formulaContextWithShowSetting(
    series.showSetting,
    formulaContextFromPanel(geometry, series, design, panel),
  );
  const enumCtx = { windowFamily: series.windowFamily, seriesId: series.id, windowType: panel.windowType };
  for (const row of series.cuts ?? []) {
    if ((row.scope ?? 'window') !== 'panel') continue;
    if (!evaluateCutCondition(row.condition, enumCtx)) continue;
    const profile = resolveCutProfile(library, series, row.role);
    if (!profile) continue;
    const horizontal = (row.side ?? []).some((s) => s === 'up' || s === 'down');
    const fallback = row.unit === '米' ? 2 * panel.glassW + 2 * panel.glassH : horizontal ? panel.sashW : panel.sashH;
    const length = resolveCutLength(row, series, context, fallback);
    if (!Number.isFinite(length)) continue;
    if (row.unit === '米') {
      items.push({
        key: `bead-${panel.panelId}-${row.id}`,
        category: 'profile',
        materialId: profile.id,
        code: profile.code,
        name: row.label,
        spec: `${panel.glassW}×${panel.glassH}`,
        unit: '米',
        quantity: round2(length / 1000),
        unitPrice: profile.unitPrice,
        amount: round2((length / 1000) * profile.unitPrice),
      });
      continue;
    }
    const count = (row.side?.length ?? 0) * resolveCutCount(row, series, context, 1);
    if (count <= 0) continue;
    pushProfile(items, profile, row.label, length, count, series, row.id, row.angle);
  }
}

function addPanelItems(
  items: BomItem[],
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  geometry: DesignGeometry,
): void {
  const glass = library.glass.find((g) => g.id === design.glassId) ?? library.glass[0];
  const hasPanelCuts = (series.cuts ?? []).some((r) => (r.scope ?? 'window') === 'panel');

  for (const panel of geometry.sizes.panels) {
    if (hasPanelCuts) {
      applyPanelCutRows(items, design, series, library, geometry, panel);
    } else {
      // 无出料行配置：回退内置算法
      const hasSash = panel.sashCount > 0;
      if (hasSash) {
        const sash = resolveProfile(library, design.seriesId, 'sash');
        pushProfile(items, sash, '扇料(横)', panel.sashW, 2 * panel.sashCount, series);
        pushProfile(items, sash, '扇料(竖)', panel.sashH, 2 * panel.sashCount, series);
      }
      const bead = resolveProfile(library, design.seriesId, 'bead');
      for (let i = 0; i < Math.max(panel.sashCount, 1); i++) {
        const beadLen = 2 * panel.glassW + 2 * panel.glassH;
        items.push({
          key: `bead-${panel.panelId}-${i}`,
          category: 'profile',
          materialId: bead.id,
          code: bead.code,
          name: bead.name,
          spec: `${panel.glassW}×${panel.glassH}`,
          unit: '米',
          quantity: round2(beadLen / 1000),
          unitPrice: bead.unitPrice,
          amount: round2((beadLen / 1000) * bead.unitPrice),
        });
      }
    }

    items.push({
      key: `glass-${panel.panelId}`,
      category: 'glass',
      materialId: glass.id,
      code: glass.name,
      name: glass.name,
      spec: `${panel.glassW}×${panel.glassH}`,
      unit: '块',
      quantity: panel.sashCount > 0 ? panel.sashCount : 1,
      unitPrice: glass.unitPrice,
      amount: round2(
        ((panel.glassW * panel.glassH) / 1e6) * (panel.sashCount > 0 ? panel.sashCount : 1) * glass.unitPrice,
      ),
    });

    addHardwareItems(items, design, series, library, panel);
  }
}

function addHardwareItems(
  items: BomItem[],
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  panel: { panelId: string; windowType: string; sashCount: number; sashH: number },
): void {
  const push = (id: string, name: string, unit: '个' | '只' | '套' | '把' | '支', count: number) => {
    const hw = library.hardware.find((h) => h.id === id);
    if (!hw) return;
    items.push({
      key: `${id}-${panel.panelId}`,
      category: 'hardware',
      materialId: hw.id,
      code: hw.code,
      name,
      spec: hw.name,
      unit,
      quantity: count,
      unitPrice: hw.unitPrice,
      amount: round2(count * hw.unitPrice),
    });
  };

  if (panel.windowType === 'fixed' || panel.sashCount === 0) return;

  if (panel.windowType === 'sliding') {
    const perSash = panel.sashCount;
    push('hw-slider', '推拉滑轮', '只', perSash * 2);
    push('hw-slidinglock', '推拉锁', '把', Math.max(1, Math.floor(perSash / 2)));
    return;
  }

  if (panel.windowType === 'topHinged') {
    push('hw-tophinge', '上悬滑撑', '只', 2);
    push('hw-handle', '执手', '支', 1);
    return;
  }

  if (panel.windowType === 'casementUp') {
    push('hw-turn-tilt', '内开内倒五金', '套', 1);
    return;
  }

  // 内倒平移：平开一套五金之上再加滑轨走轮与内开内倒五金（不 return，继续走平开分支）
  if (panel.windowType === 'tiltSlide') {
    push('hw-slider', '推拉滑轮', '只', 2 * panel.sashCount);
    push('hw-turn-tilt', '内开内倒五金', '套', panel.sashCount);
  }

  push('hw-hinge', '平开合页', '只', 2);
  push('hw-handle', '执手', '支', 1);
  const transmissionLen = Math.max(1, Math.ceil(panel.sashH / 400));
  push('hw-transmission', '传动器', '支', transmissionLen);
  push('hw-lockpoint', '锁点', '个', Math.max(2, transmissionLen * 2));
}

function pushProfile(
  items: BomItem[],
  profile: { id: string; code: string; name: string; unitPrice: number },
  name: string,
  lengthMm: number,
  count: number,
  series: SeriesSpec,
  keySeed?: string,
  cutAngle?: string,
): void {
  const length = Math.max(1, Math.round(lengthMm));
  const lengthM = lengthMm / 1000;
  items.push({
    key: `${keySeed ? `${keySeed}:` : ''}${profile.id}-${name}-${lengthMm}`,
    category: 'profile',
    materialId: profile.id,
    code: profile.code,
    name,
    spec: `${series.name}/${profile.name} ${length}mm`,
    unit: '支',
    quantity: count,
    unitPrice: profile.unitPrice,
    amount: round2(lengthM * profile.unitPrice * count),
    cutAngle,
  });
}

export function resolveProfile(
  library: MaterialLibrary,
  seriesId: string,
  category: string,
): { id: string; code: string; name: string; unitPrice: number } {
  const found =
    library.profiles.find((p) => p.seriesId === seriesId && p.category === category) ??
    library.profiles.find((p) => p.seriesId === seriesId && p.category === 'frame');
  if (!found) {
    throw new Error(`未找到系列 ${seriesId} 的 ${category} 型材`);
  }
  return found;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
