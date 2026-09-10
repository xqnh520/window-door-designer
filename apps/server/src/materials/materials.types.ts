/**
 * 物料 / 库存领域类型（与 packages/schema/src/material-catalog.ts 保持一致，
 * 服务端保持零外部依赖，故本地复制类型与编码生成器；后续接入 @wdd/schema 可替换）。
 */
export type MaterialCategory = 'profile' | 'glass' | 'hardware' | 'accessory' | 'finished';
export type MaterialStatus = 'active' | 'inactive';
export type MaterialUnit = '米' | '平方米' | '个' | '公斤' | '只' | '套' | '包' | '盒' | '卷' | '支' | '块' | '把';
export type CostType = 'fixed' | 'variable';
export type TransactionType = 'inbound' | 'outbound' | 'adjust' | 'transfer';

export const MATERIAL_CATEGORY_PREFIX: Record<MaterialCategory, string> = {
  profile: 'AL',
  glass: 'GL',
  hardware: 'HW',
  accessory: 'AU',
  finished: 'FG',
};

/** 物料基础信息（IMaterial + 审计字段） */
export interface Material {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  specModel: string;
  color: string;
  unit: MaterialUnit;
  brand: string;
  description?: string;
  barcode?: string;
  status: MaterialStatus;
  weightKg?: number; // ★ 单件重量（kg/单位）
  volumeM3?: number; // ★ 单件体积（m³/单位）
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  isDeleted: boolean;
}

export interface InventoryItem {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  currentQty: number;
  lockedQty: number;
  availableQty: number;
  safetyStock: number;
  maxStock?: number;
  lastInboundTime?: string;
  lastOutboundTime?: string;
}

/** 仓库档案（多仓库 + 库位主数据；库位为仓库下的编码数组，库存复合键保持不变） */
export interface Warehouse {
  id: string;
  code: string; // 仓库编码（唯一，如 WH01）
  name: string;
  address?: string;
  manager?: string;
  phone?: string;
  locations: string[]; // 库位编码列表（如 A-01-02）
  isDefault: boolean; // 默认仓（全库仅一个）
  status: MaterialStatus;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  isDeleted: boolean;
}

export interface MaterialCost {
  materialId: string;
  defaultSupplierId: string;
  unitPrice: number;
  currency: string;
  leadTimeDays: number;
  moq: number;
  costType: CostType;
  lastPurchasePrice: number;
  lastPurchaseDate?: string;
}

export interface InventoryTransaction {
  id: string;
  transactionType: TransactionType;
  materialId: string;
  warehouseId?: string; // 可选：兼容早期未记录仓库的流水
  locationCode?: string;
  quantity: number;
  beforeQty: number;
  afterQty: number;
  relatedDocNo: string;
  operatorId: string;
  operateTime: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

/** 持久化数据库结构（JSON 文件） */
export interface MaterialDb {
  materials: Material[];
  inventory: InventoryItem[];
  costs: MaterialCost[];
  transactions: InventoryTransaction[];
  warehouses: Warehouse[];
}

// ---------- DTO ----------

export interface CreateMaterialDto {
  code?: string; // 为空时自动生成（分类前缀-规格-序号）
  name: string;
  category: MaterialCategory;
  specModel?: string;
  color?: string;
  unit: MaterialUnit;
  brand?: string;
  description?: string;
  barcode?: string;
  status?: MaterialStatus;
  weightKg?: number;
  volumeM3?: number;
  createdBy?: string;
}

export type UpdateMaterialDto = Partial<Omit<CreateMaterialDto, 'code'>>;

export interface InventoryOpDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  quantity: number; // >0
  relatedDocNo?: string;
  operatorId?: string;
  remark?: string;
}

/** 盘点：把 currentQty 设为实盘数 countedQty，流水记「实盘 - 账面」差额 */
export interface AdjustInventoryDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  countedQty: number; // >=0
  relatedDocNo?: string;
  operatorId?: string;
  remark?: string;
}

/** 库存主数据维护（安全库存 / 上限 / 锁定量），不产生流水 */
export interface UpdateInventoryMetaDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  safetyStock?: number;
  maxStock?: number;
  lockedQty?: number;
}

/** 批量领料出库：一张单据多行明细 */
export interface BatchOutboundDto {
  lines: InventoryOpDto[];
  relatedDocNo: string;
  operatorId?: string;
  remark?: string;
  /** true = 逐行提交、失败行跳过；缺省 false = 全成功才落盘 */
  allowPartial?: boolean;
}

export interface BatchLineResult {
  index: number;
  materialId: string;
  code: string;
  name: string;
  ok: boolean;
  transaction?: InventoryTransaction;
  error?: string;
}

/** 批量结果恒以 200 返回：哪几行失败属于业务数据，由前端渲染成明细表 */
export interface BatchResult {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  relatedDocNo: string;
  results: BatchLineResult[];
}

/** 分页容器（与 crm.types.ts 的 Page 同构，模块间不互相 import） */
export interface Page<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryQuery {
  warehouseId?: string;
  category?: MaterialCategory;
  onlyWarning?: boolean;
}

export interface TransactionQuery {
  materialId?: string;
  transactionType?: TransactionType;
  warehouseId?: string;
  keyword?: string; // 单据号 / 备注 模糊匹配
  from?: string; // operateTime 起（ISO）
  to?: string; // operateTime 止（ISO）
  page?: number;
  pageSize?: number;
}

/** 库存行：库存 + 物料 + 仓库名 + 缺料预警标记 */
export type InventoryRow = InventoryItem & { material?: Material; warehouseName?: string; warning: boolean };

/** 流水行：流水 + 物料 + 仓库名 */
export type TransactionRow = InventoryTransaction & { material?: Material; warehouseName?: string };

export interface InventorySummaryWarehouse {
  warehouseId: string;
  warehouseName: string;
  skuCount: number;
  totalQty: number;
  warningCount: number;
}

export interface InventorySummary {
  warningCount: number;
  warehouses: InventorySummaryWarehouse[];
}

export interface CreateWarehouseDto {
  code?: string; // 为空时自动生成 WH01 / WH02 …
  name: string;
  address?: string;
  manager?: string;
  phone?: string;
  locations?: string[];
  isDefault?: boolean;
  status?: MaterialStatus;
  remark?: string;
  createdBy?: string;
}

export type UpdateWarehouseDto = Partial<CreateWarehouseDto>;

export interface UpsertCostDto {
  defaultSupplierId: string;
  unitPrice: number;
  currency?: string;
  leadTimeDays?: number;
  moq?: number;
  costType?: CostType;
  lastPurchasePrice: number;
  lastPurchaseDate?: string;
}

// ---------- 物料编码生成器（与 @wdd/schema 对齐） ----------

export function normalizeSpec(spec: string): string {
  return spec.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseCode(code: string): { category?: MaterialCategory; spec?: string; seq?: number } {
  const parts = code.trim().toUpperCase().split('-').filter(Boolean);
  if (parts.length < 2) return {};
  const category = (Object.keys(MATERIAL_CATEGORY_PREFIX) as MaterialCategory[]).find(
    (k) => MATERIAL_CATEGORY_PREFIX[k] === parts[0],
  );
  const seq = Number(parts[parts.length - 1]);
  return {
    category,
    spec: parts.slice(1, -1).join('-'),
    seq: Number.isInteger(seq) && seq >= 0 ? seq : undefined,
  };
}

export function generateCode(category: MaterialCategory, spec: string, seq = 1): string {
  const prefix = MATERIAL_CATEGORY_PREFIX[category] ?? 'MT';
  const clean = normalizeSpec(spec);
  const seqStr = String(Math.max(1, Math.floor(seq))).padStart(2, '0');
  return clean ? [prefix, clean, seqStr].join('-') : [prefix, seqStr].join('-');
}

export function nextCode(category: MaterialCategory, spec: string, existingCodes: string[]): string {
  const target = normalizeSpec(spec);
  let max = 0;
  for (const c of existingCodes) {
    const p = parseCode(c);
    if (p.category === category && p.spec === target && p.seq != null) max = Math.max(max, p.seq);
  }
  return generateCode(category, spec, max + 1);
}

// ---------- 仓库编码生成器（与 @wdd/schema 对齐） ----------

export function generateWarehouseCode(seq = 1): string {
  return `WH${String(Math.max(1, Math.floor(seq))).padStart(2, '0')}`;
}

export function nextWarehouseCode(existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    const m = /^WH0*(\d+)$/i.exec(code.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return generateWarehouseCode(max + 1);
}
