import type { BomItem } from './bom.js';
import { computeBilledArea } from './bom.js';
import { computeGeometry } from './geometry.js';
import type { MaterialLibrary, SeriesSpec, WindowDesign } from '@wdd/schema';

/**
 * 报价规则集（配置化）：全部费用项按单樘计，最终随 windowCount 一并放大。
 * - areaPricePerM2 > 0 时进入「面积报价模式」，报价与 BOM 解耦，直接按洞口面积计价；
 * - 否则按「材料成本加成模式」，叠加开启扇/颜色/异形/玻璃/五金/包装/运输加价项。
 */
export interface QuoteRuleSet {
  laborPricePerM2: number;
  installPricePerM2: number;
  accessoryPricePerM2: number;
  wasteRate: number;
  minAreaPerPanel: number;
  includeInstall: boolean;
  /** 开启扇加价（元/扇） */
  sashUpcharge: number;
  /** 异形窗加价（元/樘） */
  specialShapeUpcharge: number;
  /** 包装费（元/樘） */
  packagingPerUnit: number;
  /** 运输费（元/㎡，按计价面积） */
  transportPerM2: number;
  /** 玻璃加价（元/㎡，按计价面积） */
  glassUpchargePerM2: number;
  /** 颜色加价表：颜色名 → 元/㎡ */
  colorUpcharges: Record<string, number>;
  /** 五金档位加价表：档位名 → 元/樘 */
  hardwareUpcharges: Record<string, number>;
  /** 面积报价单价（元/㎡），>0 时启用面积报价模式 */
  areaPricePerM2: number;
}

export const defaultQuoteRuleSet: QuoteRuleSet = {
  laborPricePerM2: 120,
  installPricePerM2: 60,
  accessoryPricePerM2: 15,
  wasteRate: 0.06,
  minAreaPerPanel: 1.5,
  includeInstall: false,
  sashUpcharge: 0,
  specialShapeUpcharge: 0,
  packagingPerUnit: 0,
  transportPerM2: 0,
  glassUpchargePerM2: 0,
  colorUpcharges: {},
  hardwareUpcharges: {},
  areaPricePerM2: 0,
};

/** 报价业务上下文：画布/设计模型推导的额外信息，用于命中加价项 */
export interface QuoteExtra {
  /** 开启扇数量（默认从 design.panels 统计） */
  sashCount?: number;
  /** 是否异形窗（梯形/尖拱/拱形），命中 specialShapeUpcharge */
  specialShape?: boolean;
  /** 选中颜色名，命中 colorUpcharges 时按计价面积加价 */
  color?: string;
  /** 五金档位名，命中 hardwareUpcharges 时按樘加价 */
  hardware?: string;
  /** 玻璃规格 ID，显示在玻璃加价明细中 */
  glassId?: string;
}

export interface QuoteEngineLine {
  key: string;
  name: string;
  detail: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuoteEngineResult {
  openingAreaM2: number;
  billedAreaM2: number;
  /** 采用的报价模式：面积单价 / 材料成本加成 */
  mode: 'area' | 'cost';
  lines: QuoteEngineLine[];
  subtotal: number;
  discount: number;
  total: number;
}

export function quoteFromBom(
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  bom: BomItem[],
  rules: QuoteRuleSet,
  windowCount: number,
  discountRate: number,
  extra: QuoteExtra = {},
): QuoteEngineResult {
  const geometry = computeGeometry(design, series);
  const openingAreaM2 = round2((design.openingW * design.openingH) / 1e6);
  const billedAreaM2 = round2(computeBilledArea(geometry.sizes.panels, rules.minAreaPerPanel));
  const sashCount = extra.sashCount ?? design.panels.filter((p) => p.hasSash || p.windowType !== 'fixed').length;
  const ctx = { openingAreaM2, billedAreaM2, sashCount };

  if (rules.areaPricePerM2 > 0) {
    return buildAreaQuote(openingAreaM2, billedAreaM2, rules, windowCount, discountRate, extra, ctx);
  }

  const lines: QuoteEngineLine[] = [];

  const mainMaterialAmount = bom.filter((item) => item.category !== 'accessory').reduce((sum, item) => sum + item.amount, 0);
  lines.push({
    key: 'material',
    name: '材料费',
    detail: `${countBy(bom, 'profile')} 项型材 / ${countBy(bom, 'glass')} 项玻璃 / ${countBy(bom, 'hardware')} 项五金`,
    unit: '项',
    quantity: 1,
    unitPrice: round2(mainMaterialAmount),
    amount: round2(mainMaterialAmount),
  });

  const accessoryItems = bom.filter((item) => item.category === 'accessory');
  const accessoryAmount = accessoryItems.length
    ? round2(accessoryItems.reduce((sum, item) => sum + item.amount, 0))
    : round2(billedAreaM2 * rules.accessoryPricePerM2);
  lines.push({
    key: 'accessory',
    name: '辅料费',
    detail: accessoryItems.length ? `${accessoryItems.length} 项辅料` : '密封胶条 / 毛条 / 垫块',
    unit: '㎡',
    quantity: billedAreaM2,
    unitPrice: round2(accessoryAmount / Math.max(billedAreaM2, 0.01)),
    amount: accessoryAmount,
  });

  const laborAmount = round2(billedAreaM2 * rules.laborPricePerM2);
  lines.push({
    key: 'labor',
    name: '加工费',
    detail: '切割 / 组装 / 五金装配',
    unit: '㎡',
    quantity: billedAreaM2,
    unitPrice: rules.laborPricePerM2,
    amount: laborAmount,
  });

  let subtotal = round2(mainMaterialAmount + accessoryAmount + laborAmount);
  if (rules.includeInstall) {
    const installAmount = round2(billedAreaM2 * rules.installPricePerM2);
    lines.push({
      key: 'install',
      name: '安装费',
      detail: '现场安装',
      unit: '㎡',
      quantity: billedAreaM2,
      unitPrice: rules.installPricePerM2,
      amount: installAmount,
    });
    subtotal = round2(subtotal + installAmount);
  }

  const extras = collectExtras(rules, extra, ctx);
  if (extras.lines.length) lines.push(...extras.lines);
  subtotal = round2(subtotal + extras.amount);

  const wasteAmount = round2(mainMaterialAmount * rules.wasteRate);
  lines.push({
    key: 'waste',
    name: '损耗费',
    detail: `按材料费 ${Math.round(rules.wasteRate * 100)}%`,
    unit: '项',
    quantity: 1,
    unitPrice: wasteAmount,
    amount: wasteAmount,
  });
  subtotal = round2(subtotal + wasteAmount);

  return finishQuote(lines, subtotal, windowCount, discountRate, openingAreaM2, billedAreaM2, 'cost');
}

function buildAreaQuote(
  openingAreaM2: number,
  billedAreaM2: number,
  rules: QuoteRuleSet,
  windowCount: number,
  discountRate: number,
  extra: QuoteExtra,
  ctx: { openingAreaM2: number; billedAreaM2: number; sashCount: number },
): QuoteEngineResult {
  const lines: QuoteEngineLine[] = [];
  const areaAmount = round2(openingAreaM2 * rules.areaPricePerM2);
  lines.push({
    key: 'area',
    name: '面积单价',
    detail: `洞口面积 ${openingAreaM2}㎡ × ¥${rules.areaPricePerM2}/㎡（不含材料 BOM）`,
    unit: '㎡',
    quantity: openingAreaM2,
    unitPrice: rules.areaPricePerM2,
    amount: areaAmount,
  });

  const extras = collectExtras(rules, extra, ctx);
  if (extras.lines.length) lines.push(...extras.lines);

  return finishQuote(lines, round2(areaAmount + extras.amount), windowCount, discountRate, openingAreaM2, billedAreaM2, 'area');
}

/** 附加费用：开启扇/异形/包装/颜色/五金/玻璃/运输（单樘口径） */
function collectExtras(
  rules: QuoteRuleSet,
  extra: QuoteExtra,
  ctx: { openingAreaM2: number; billedAreaM2: number; sashCount: number },
): { lines: QuoteEngineLine[]; amount: number } {
  const lines: QuoteEngineLine[] = [];
  let amount = 0;

  if (rules.sashUpcharge > 0 && ctx.sashCount > 0) {
    const amt = round2(ctx.sashCount * rules.sashUpcharge);
    lines.push({
      key: 'sash-upcharge',
      name: '开启扇加价',
      detail: `${ctx.sashCount} 扇 × ¥${rules.sashUpcharge}/扇`,
      unit: '扇',
      quantity: ctx.sashCount,
      unitPrice: rules.sashUpcharge,
      amount: amt,
    });
    amount += amt;
  }

  if ((extra.specialShape ?? false) && rules.specialShapeUpcharge > 0) {
    const amt = round2(rules.specialShapeUpcharge);
    lines.push({ key: 'special-shape', name: '异形窗加价', detail: '梯形/尖拱/拱形异形工艺', unit: '樘', quantity: 1, unitPrice: rules.specialShapeUpcharge, amount: amt });
    amount += amt;
  }

  if (rules.packagingPerUnit > 0) {
    const amt = round2(rules.packagingPerUnit);
    lines.push({ key: 'packaging', name: '包装费', detail: '木架/泡沫防护', unit: '樘', quantity: 1, unitPrice: rules.packagingPerUnit, amount: amt });
    amount += amt;
  }

  if (extra.color && rules.colorUpcharges[extra.color] != null && rules.colorUpcharges[extra.color] > 0) {
    const price = rules.colorUpcharges[extra.color];
    const amt = round2(ctx.billedAreaM2 * price);
    lines.push({ key: 'color', name: '颜色加价', detail: `${extra.color} × ¥${price}/㎡`, unit: '㎡', quantity: ctx.billedAreaM2, unitPrice: price, amount: amt });
    amount += amt;
  }

  if (extra.hardware && rules.hardwareUpcharges[extra.hardware] != null && rules.hardwareUpcharges[extra.hardware] > 0) {
    const price = rules.hardwareUpcharges[extra.hardware];
    const amt = round2(price);
    lines.push({ key: 'hardware', name: '五金加价', detail: `${extra.hardware}五金 ¥${price}/樘`, unit: '樘', quantity: 1, unitPrice: price, amount: amt });
    amount += amt;
  }

  if (rules.glassUpchargePerM2 > 0 && extra.glassId) {
    const amt = round2(ctx.billedAreaM2 * rules.glassUpchargePerM2);
    lines.push({
      key: 'glass',
      name: '玻璃加价',
      detail: `玻璃 ${extra.glassId} 按计价面积 ¥${rules.glassUpchargePerM2}/㎡`,
      unit: '㎡',
      quantity: ctx.billedAreaM2,
      unitPrice: rules.glassUpchargePerM2,
      amount: amt,
    });
    amount += amt;
  }

  if (rules.transportPerM2 > 0) {
    const amt = round2(ctx.billedAreaM2 * rules.transportPerM2);
    lines.push({ key: 'transport', name: '运输费', detail: `按计价面积 ¥${rules.transportPerM2}/㎡`, unit: '㎡', quantity: ctx.billedAreaM2, unitPrice: rules.transportPerM2, amount: amt });
    amount += amt;
  }

  return { lines, amount };
}

/** 统一收尾：按樘数放大、应用折扣，产出最终结果 */
function finishQuote(
  lines: QuoteEngineLine[],
  subtotalPerUnit: number,
  windowCount: number,
  discountRate: number,
  openingAreaM2: number,
  billedAreaM2: number,
  mode: 'area' | 'cost',
): QuoteEngineResult {
  let subtotal = round2(subtotalPerUnit * windowCount);
  const discount = round2(subtotal * discountRate);
  const total = round2(subtotal - discount);

  if (discount > 0) {
    lines.push({
      key: 'discount',
      name: '优惠折扣',
      detail: `${Math.round(discountRate * 100)}%`,
      unit: '项',
      quantity: 1,
      unitPrice: -discount,
      amount: -discount,
    });
  }

  return { openingAreaM2, billedAreaM2, mode, lines, subtotal, discount, total };
}

function countBy(bom: BomItem[], category: string): number {
  return bom.filter((item) => item.category === category).length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}