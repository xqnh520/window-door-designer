/**
 * BOM → 领料出库行的匹配算法（纯函数，便于单测）。
 *
 * 难点：设计器算料得到的 BomItem.materialId 来自样例库（'p-frame-60' / 'g-5mm'），
 * 与仓库物料档案的 uuid 完全是两套 id，编码风格也不同（'LK60-01' vs 'AL-6063-T5-01'），
 * 且玻璃行的 code 实际等于玻璃名称（见 bom.ts 的玻璃出料）。
 * 因此这里按「编码精确 → 名称精确 → 名称互含 → 同分类且规格互含」逐级降级匹配，
 * 匹配不上的行交给用户在领料弹窗里手工指定或一键建档。
 */
import type { IInventory, IMaterial, MaterialCategory, MaterialUnit } from '@wdd/schema';
import type { BomItem } from './bom.js';

export type PickMatchBy = 'code' | 'name' | 'spec' | 'manual';

export type PickStatus = 'matched' | 'unmatched' | 'no-stock';

export interface PickLine {
  /** BOM 行 key（表格 rowKey） */
  key: string;
  category: MaterialCategory;
  /** 样例库 id（如 p-frame-60）：仅用于展示与回填，**不可**提交给服务端 */
  bomMaterialId: string;
  /** BOM 编码（玻璃行等于玻璃名称） */
  bomCode: string;
  name: string;
  spec: string;
  unit: MaterialUnit;
  /** 单樘用量 */
  quantityPerSet: number;
  /** 匹配到的档案物料 id（服务端 uuid）；未匹配为 null */
  materialId: string | null;
  materialCode: string | null;
  materialUnit: MaterialUnit | null;
  matchBy: PickMatchBy | null;
  status: PickStatus;
  /** 出库目标库存行（无库存行时为 null，需先入库） */
  warehouseId: string | null;
  locationCode: string | null;
  availableQty: number;
  /** 需要人工注意的提示（单位语义不一致等） */
  warning: string | null;
}

export interface PickContext {
  materials: IMaterial[];
  inventory: IInventory[];
  /** 优先出库的仓库；缺省则挑可用量最大的库存行 */
  preferredWarehouseId?: string;
}

const norm = (s: string): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 按编码 / 名称 / 规格逐级匹配档案物料；只认启用状态的档案 */
export function matchMaterial(
  item: Pick<BomItem, 'code' | 'name' | 'spec' | 'category'>,
  materials: IMaterial[],
): { material: IMaterial; by: PickMatchBy } | null {
  const alive = materials.filter((m) => !m.isDeleted && m.status === 'active');
  const code = norm(item.code);
  const name = norm(item.name);
  const spec = norm(item.spec);

  if (code) {
    const byCode = alive.find((m) => norm(m.code) === code);
    if (byCode) return { material: byCode, by: 'code' };
  }

  if (name) {
    const exact = alive.find((m) => norm(m.name) === name);
    if (exact) return { material: exact, by: 'name' };
    // 名称互含：档案名常带系列/颜色前后缀（如「5+12A+5 中空玻璃 5mm」）
    const contains = alive
      .map((m) => ({ m, n: norm(m.name) }))
      .filter(({ n }) => n && (n.includes(name) || name.includes(n)))
      .sort((a, b) => b.n.length - a.n.length)[0];
    if (contains) return { material: contains.m, by: 'name' };
  }

  if (spec) {
    const bySpec = alive
      .filter((m) => m.category === item.category)
      .map((m) => ({ m, s: norm(m.specModel) }))
      .filter(({ s }) => s && (s.includes(spec) || spec.includes(s)))
      .sort((a, b) => b.s.length - a.s.length)[0];
    if (bySpec) return { material: bySpec.m, by: 'spec' };
  }

  return null;
}

/** 选出库库存行：优先指定仓库，其次可用量最大；完全没有库存行则返回 null */
export function pickStockLine(
  materialId: string,
  inventory: IInventory[],
  preferredWarehouseId?: string,
): IInventory | null {
  const rows = inventory.filter((i) => i.materialId === materialId);
  if (!rows.length) return null;
  if (preferredWarehouseId) {
    const preferred = rows.filter((i) => i.warehouseId === preferredWarehouseId);
    if (preferred.length) return byAvailable(preferred);
  }
  return byAvailable(rows);
}

function byAvailable(rows: IInventory[]): IInventory {
  return rows.slice().sort((a, b) => b.availableQty - a.availableQty)[0];
}

/** 单位语义提示：BOM 按「块」领料而档案按「平方米」计价时必须人工换算 */
function unitWarning(bomUnit: MaterialUnit, materialUnit: MaterialUnit | null): string | null {
  if (!materialUnit || materialUnit === bomUnit) return null;
  return `单位不一致：BOM 按「${bomUnit}」，档案按「${materialUnit}」，请确认数量口径`;
}

/** 把 BOM 结果转成领料行（数量为单樘用量，樘数在提交时相乘） */
export function buildPickLines(items: BomItem[], ctx: PickContext): PickLine[] {
  return items.map((item) => {
    const hit = matchMaterial(item, ctx.materials);
    const base: PickLine = {
      key: item.key,
      category: item.category as MaterialCategory,
      bomMaterialId: item.materialId,
      bomCode: item.code,
      name: item.name,
      spec: item.spec,
      unit: item.unit,
      quantityPerSet: item.quantity,
      materialId: null,
      materialCode: null,
      materialUnit: null,
      matchBy: null,
      status: 'unmatched',
      warehouseId: null,
      locationCode: null,
      availableQty: 0,
      warning: null,
    };
    if (!hit) return base;
    const stock = pickStockLine(hit.material.id, ctx.inventory, ctx.preferredWarehouseId);
    return {
      ...base,
      materialId: hit.material.id,
      materialCode: hit.material.code,
      materialUnit: hit.material.unit,
      matchBy: hit.by,
      status: stock ? 'matched' : 'no-stock',
      warehouseId: stock?.warehouseId ?? null,
      locationCode: stock?.locationCode ?? null,
      availableQty: stock?.availableQty ?? 0,
      warning: unitWarning(item.unit, hit.material.unit),
    };
  });
}

/** 用户手工指定档案物料后回填该行（重新挑库存行） */
export function applyManualMaterial(line: PickLine, material: IMaterial | null, ctx: PickContext): PickLine {
  if (!material) {
    return {
      ...line,
      materialId: null,
      materialCode: null,
      materialUnit: null,
      matchBy: null,
      status: 'unmatched',
      warehouseId: null,
      locationCode: null,
      availableQty: 0,
      warning: null,
    };
  }
  const stock = pickStockLine(material.id, ctx.inventory, ctx.preferredWarehouseId);
  return {
    ...line,
    materialId: material.id,
    materialCode: material.code,
    materialUnit: material.unit,
    matchBy: 'manual',
    status: stock ? 'matched' : 'no-stock',
    warehouseId: stock?.warehouseId ?? null,
    locationCode: stock?.locationCode ?? null,
    availableQty: stock?.availableQty ?? 0,
    warning: unitWarning(line.unit, material.unit),
  };
}

/** 提交数量 = 单樘用量 × 樘数（保留两位） */
export function pickQuantity(line: PickLine, sets: number): number {
  const n = Number.isFinite(sets) && sets > 0 ? sets : 1;
  return Math.round(line.quantityPerSet * n * 100) / 100;
}

/** 提交前预检：返回阻断原因（未匹配 / 无库存行 / 数量非正） */
export function validatePickLines(lines: PickLine[], sets: number): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    if (!line.materialId) problems.push(`「${line.name}」未匹配到物料档案，请手工选择或快速建档`);
    else if (!line.warehouseId || !line.locationCode) problems.push(`「${line.name}」在所选仓库没有库存行，请先入库`);
    else if (pickQuantity(line, sets) <= 0) problems.push(`「${line.name}」领料数量必须大于 0`);
  }
  return problems;
}
