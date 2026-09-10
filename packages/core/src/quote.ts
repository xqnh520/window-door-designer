import type { MaterialLibrary, SeriesSpec, WindowDesign } from '@wdd/schema';
import type { BomItem } from './bom.js';
import { computeBilledArea } from './bom.js';
import { computeGeometry } from './geometry.js';

export interface QuoteOptions {
  windowCount: number;
  minAreaPerPanel: number;
  includeInstall: boolean;
  laborPricePerM2: number;
  installPricePerM2: number;
  accessoryPricePerM2: number;
  wasteRate: number;
  discountRate: number;
}

export const defaultQuoteOptions: QuoteOptions = {
  windowCount: 1,
  minAreaPerPanel: 1.5,
  includeInstall: false,
  laborPricePerM2: 120,
  installPricePerM2: 60,
  accessoryPricePerM2: 15,
  wasteRate: 0.06,
  discountRate: 0,
};

export interface QuoteLine {
  key: string;
  name: string;
  detail: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuoteResult {
  openingAreaM2: number;
  billedAreaM2: number;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
}

export function computeQuote(
  design: WindowDesign,
  series: SeriesSpec,
  library: MaterialLibrary,
  bom: BomItem[],
  options: QuoteOptions = defaultQuoteOptions,
): QuoteResult {
  const geometry = computeGeometry(design, series);
  const openingAreaM2 = round2((design.openingW * design.openingH) / 1e6);
  const billedAreaM2 = round2(computeBilledArea(geometry.sizes.panels, options.minAreaPerPanel));

  const lines: QuoteLine[] = [];

  // 材料费 = 型材 + 玻璃 + 五金（不含辅料，辅料单独计价）
  const mainMaterialAmount = bom
    .filter((item) => item.category !== 'accessory')
    .reduce((sum, item) => sum + item.amount, 0);
  lines.push({ key: 'material', name: '材料费', detail: `${countBy(bom, 'profile')} 项型材 / ${countBy(bom, 'glass')} 项玻璃 / ${countBy(bom, 'hardware')} 项五金`, unit: '项', quantity: 1, unitPrice: round2(mainMaterialAmount), amount: round2(mainMaterialAmount) });

  const accessoryItems = bom.filter((item) => item.category === 'accessory');
  const accessoryAmount = accessoryItems.length
    ? round2(accessoryItems.reduce((sum, item) => sum + item.amount, 0))
    : round2(billedAreaM2 * options.accessoryPricePerM2);
  lines.push({ key: 'accessory', name: '辅料费', detail: accessoryItems.length ? `${accessoryItems.length} 项辅料` : '密封胶条 / 毛条 / 垫块', unit: '㎡', quantity: billedAreaM2, unitPrice: round2(accessoryAmount / Math.max(billedAreaM2, 0.01)), amount: accessoryAmount });

  const laborAmount = round2(billedAreaM2 * options.laborPricePerM2);
  lines.push({ key: 'labor', name: '加工费', detail: '切割 / 组装 / 五金装配', unit: '㎡', quantity: billedAreaM2, unitPrice: options.laborPricePerM2, amount: laborAmount });

  let subtotal = round2(mainMaterialAmount + accessoryAmount + laborAmount);
  if (options.includeInstall) {
    const installAmount = round2(billedAreaM2 * options.installPricePerM2);
    lines.push({ key: 'install', name: '安装费', detail: '现场安装', unit: '㎡', quantity: billedAreaM2, unitPrice: options.installPricePerM2, amount: installAmount });
    subtotal = round2(subtotal + installAmount);
  }

  const wasteAmount = round2(mainMaterialAmount * options.wasteRate);
  lines.push({ key: 'waste', name: '损耗费', detail: `按材料费 ${Math.round(options.wasteRate * 100)}%`, unit: '项', quantity: 1, unitPrice: wasteAmount, amount: wasteAmount });
  subtotal = round2(subtotal + wasteAmount);

  subtotal = round2(subtotal * options.windowCount);
  const discount = round2(subtotal * options.discountRate);
  const total = round2(subtotal - discount);

  if (discount > 0) {
    lines.push({ key: 'discount', name: '优惠折扣', detail: `${Math.round(options.discountRate * 100)}%`, unit: '项', quantity: 1, unitPrice: -discount, amount: -discount });
  }

  return {
    openingAreaM2,
    billedAreaM2,
    lines,
    subtotal,
    discount,
    total,
  };
}

function countBy(bom: BomItem[], category: string): number {
  return bom.filter((item) => item.category === category).length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}