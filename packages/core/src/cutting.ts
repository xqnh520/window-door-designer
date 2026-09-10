import type { BomItem } from './bom.js';
import type { SeriesSpec } from '@wdd/schema';
import { optimizeCuttingPacks } from './cutting-optimizer.js';

export interface CuttingItem {
  materialId: string;
  code: string;
  name: string;
  color: string;
  lengthMm: number;
  quantity: number;
  cutAngleLeft?: string;
  cutAngleRight?: string;
  position: string;
  sourceComponentId: string;
}

export interface CuttingResult {
  items: CuttingItem[];
  packs: CuttingPack[];
  /** 余料可再利用清单（每支原料的剩余长度） */
  remnants: CuttingRemnant[];
  totalPieces: number;
  totalLengthMm: number;
  totalStockLengthMm: number;
  /** 全部余料（mm） */
  totalWasteMm: number;
  /** 可再利用余料（≥ minReuseLengthMm，mm） */
  reusableWasteMm: number;
  utilizationRate: number;
}

export interface CuttingPack {
  materialId: string;
  code: string;
  name: string;
  color: string;
  stockLengthMm: number;
  cuts: CuttingPackCut[];
  usedLengthMm: number;
  wasteLengthMm: number;
}

export interface CuttingPackCut {
  lengthMm: number;
  quantity: number;
  sourceComponentId: string;
  position: string;
}

export interface CuttingRemnant {
  materialId: string;
  code: string;
  name: string;
  color: string;
  lengthMm: number;
  /** 达到可再利用阈值（minReuseLengthMm） */
  reusable: boolean;
  /** 对应原料在第几根（packs 下标） */
  sourcePackIndex: number;
}

export interface CuttingOptions {
  defaultColor: string;
  wasteRate: number;
  stockLengthMm: number;
  /** 余料达到该长度(mm)视为可再利用，缺省 300 */
  minReuseLengthMm?: number;
}

export const defaultCuttingOptions: CuttingOptions = {
  defaultColor: '香槟',
  wasteRate: 0.03,
  stockLengthMm: 6000,
  minReuseLengthMm: 300,
};

export function computeCuttingList(
  bom: { items: BomItem[] },
  series: SeriesSpec,
  options: CuttingOptions = defaultCuttingOptions,
): CuttingResult {
  const items: CuttingItem[] = [];
  const groups = new Map<string, CuttingItem[]>();

  for (const item of bom.items) {
    if (item.category !== 'profile') continue;
    // 米行（压线按周长计米）不是逐根料件，跳过下料
    if (item.unit === '米') continue;
    const lengthMm = parseLengthMm(item.spec) ?? inferLengthMm(item.amount, item.unitPrice, item.quantity);
    if (lengthMm <= 0) continue;
    const sourceComponentId = item.sourceComponentId ?? 'unknown';
    const quantity = Math.max(1, Math.round(item.quantity));
    const angles = item.cutAngle ? parseCutAngle(item.cutAngle) : cutAngles(item.name, series);
    items.push({
      materialId: item.materialId,
      code: item.code,
      name: item.name,
      color: options.defaultColor,
      lengthMm: applyWaste(lengthMm, options.wasteRate),
      quantity,
      cutAngleLeft: angles.left,
      cutAngleRight: angles.right,
      position: item.name,
      sourceComponentId,
    });

    const groupKey = [item.materialId, options.defaultColor, item.code].join('|');
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({
      materialId: item.materialId,
      code: item.code,
      name: item.name,
      color: options.defaultColor,
      lengthMm,
      quantity,
      cutAngleLeft: angles.left,
      cutAngleRight: angles.right,
      position: item.name,
      sourceComponentId,
    });
  }

  const packInputs = [...groups.values()].flatMap((group) =>
    group.map((item) => ({
      materialId: item.materialId,
      code: item.code,
      name: item.name,
      color: item.color,
      lengthMm: item.lengthMm,
      quantity: item.quantity,
      sourceComponentId: item.sourceComponentId,
      position: item.position,
    })),
  );
  const packs = optimizeCuttingPacks(packInputs, {
    stockLengthMm: options.stockLengthMm,
    wasteRate: options.wasteRate,
  });

  const remnants: CuttingRemnant[] = [];
  const minReuse = options.minReuseLengthMm ?? 300;
  packs.forEach((pack, idx) => {
    if (pack.wasteLengthMm <= 0) return;
    remnants.push({
      materialId: pack.materialId,
      code: pack.code,
      name: pack.name,
      color: pack.color,
      lengthMm: pack.wasteLengthMm,
      reusable: pack.wasteLengthMm >= minReuse,
      sourcePackIndex: idx,
    });
  });
  remnants.sort((a, b) => b.lengthMm - a.lengthMm);

  const totalStockLengthMm = packs.reduce((sum, pack) => sum + pack.stockLengthMm, 0);
  const totalWasteMm = packs.reduce((sum, pack) => sum + pack.wasteLengthMm, 0);
  const reusableWasteMm = remnants.filter((r) => r.reusable).reduce((sum, r) => sum + r.lengthMm, 0);

  return {
    items,
    packs,
    remnants,
    totalPieces: items.reduce((sum, item) => sum + item.quantity, 0),
    totalLengthMm: items.reduce((sum, item) => sum + item.lengthMm * item.quantity, 0),
    totalStockLengthMm,
    totalWasteMm,
    reusableWasteMm,
    utilizationRate: totalStockLengthMm ? round2(packs.reduce((sum, pack) => sum + pack.usedLengthMm, 0) / totalStockLengthMm) : 0,
  };
}

/** 切角规则：斜中梃两端 45° 拼进框料；直中梃两端直角直切；外框/扇料按系列组角方式 */
function cutAngles(name: string, series: SeriesSpec): { left: string; right: string } {
  if (name.includes('斜中梃')) return { left: '45°', right: '45°' };
  if (name.includes('中梃')) return { left: '90°', right: '90°' };
  const angle = series.cornerType === '45' ? '45°' : '90°';
  return { left: angle, right: angle };
}

/** 出料行行级切角：'45-45' / '90-90' → 两端角度；缺号按直角 */
function parseCutAngle(angle: string): { left: string; right: string } {
  const [l, r] = angle.split('-');
  return { left: l ? `${l}°` : '90°', right: r ? `${r}°` : '90°' };
}

function parseLengthMm(spec: string): number | null {
  const match = spec.match(/(\d+)mm/);
  return match ? Number(match[1]) : null;
}

function inferLengthMm(amount: number, unitPrice: number, quantity: number): number {
  if (!unitPrice || !quantity) return 0;
  const lengthM = amount / (unitPrice * quantity);
  return Math.max(0, Math.round(lengthM * 1000));
}

function applyWaste(lengthMm: number, wasteRate: number): number {
  return Math.max(1, Math.round(lengthMm * (1 + wasteRate)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}