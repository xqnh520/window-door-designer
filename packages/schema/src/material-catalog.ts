/**
 * 物料档案 / 库存管理领域模型（材料库「未完成功能」补全）
 *
 * 覆盖：
 * - IMaterial / IInventory / IMaterialCost / IInventoryTransaction / IBaseEntity
 * - 枚举联合类型（category / status / transactionType / costType / unit）
 * - 物料编码生成器 generateMaterialCode()
 * - Zod 运行时校验 schema（与 material.ts 同风格，供前后端复用）
 *
 * ★ 已按需求补充「重量 / 体积」字段：IMaterial.weightKg（kg/单位）、volumeM3（m³/单位）。
 */
import { z } from 'zod';

// =====================================================================
// ① 枚举 / 联合类型（替代裸字符串，提升类型安全）
// =====================================================================

export const MaterialCategorySchema = z.enum(['profile', 'glass', 'hardware', 'accessory', 'finished']);
export type MaterialCategory = z.infer<typeof MaterialCategorySchema>;
export const MaterialCategoryLabel: Record<MaterialCategory, string> = {
  profile: '型材',
  glass: '玻璃',
  hardware: '五金',
  accessory: '辅料',
  finished: '成品',
};

export const MaterialStatusSchema = z.enum(['active', 'inactive']);
export type MaterialStatus = z.infer<typeof MaterialStatusSchema>;
export const MaterialStatusLabel: Record<MaterialStatus, string> = {
  active: '启用',
  inactive: '停用',
};

/** 基本单位（米 / 平方米 / 个 / 公斤 …，可扩展）。末尾 '块' | '把' 为 BOM 语义单位：玻璃按块、锁具按把 */
export const MaterialUnitSchema = z.enum(['米', '平方米', '个', '公斤', '只', '套', '包', '盒', '卷', '支', '块', '把']);
export type MaterialUnit = z.infer<typeof MaterialUnitSchema>;

export const CostTypeSchema = z.enum(['fixed', 'variable']);
export type CostType = z.infer<typeof CostTypeSchema>;
export const CostTypeLabel: Record<CostType, string> = { fixed: '固定成本', variable: '变动成本' };

export const TransactionTypeSchema = z.enum(['inbound', 'outbound', 'adjust', 'transfer']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;
export const TransactionTypeLabel: Record<TransactionType, string> = {
  inbound: '入库',
  outbound: '出库',
  adjust: '盘点调整',
  transfer: '调拨',
};

/** 物料分类选项（表单 Select 用） */
export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = ['profile', 'glass', 'hardware', 'accessory', 'finished'];
/** 基本单位选项（表单 Select 用）；'块' / '把' 为 BOM 语义单位，仅玻璃与锁具使用 */
export const MATERIAL_UNITS: readonly MaterialUnit[] = ['米', '平方米', '个', '公斤', '只', '套', '包', '盒', '卷', '支', '块', '把'];

/** 物料分类 → 编码前缀 */
export const MATERIAL_CODE_PREFIX: Record<MaterialCategory, string> = {
  profile: 'AL', // AL = 铝合金型材（如 AL-6063-T5-01）
  glass: 'GL',
  hardware: 'HW',
  accessory: 'AU',
  finished: 'FG',
};

// =====================================================================
// ② 系统审计字段（建议所有实体继承）
// =====================================================================

/**
 * 基础审计字段（时间统一用 ISO 8601 字符串对外传输/存储，ORM 层映射为 Date）
 */
export interface IBaseEntity {
  createdAt: string; // 创建时间
  updatedAt: string; // 最后更新时间
  createdBy?: string; // 创建人
  updatedBy?: string; // 最后更新人
  isDeleted: boolean; // 逻辑删除标记
}

// =====================================================================
// ③ 核心接口
// =====================================================================

/**
 * 物料基础信息（材料库核心实体）
 */
export interface IMaterial extends IBaseEntity {
  id: string; // 唯一标识符 (UUID)
  code: string; // 物料编码（唯一，如 AL-6063-T5-01）
  name: string; // 物料名称（如 6063-T5 银白氧化铝型材）
  category: MaterialCategory; // 物料分类：型材 / 玻璃 / 五金 / 辅料 / 成品
  specModel: string; // 规格型号（如 60*40*1.5）
  color: string; // 颜色 / 表面处理（如 氟碳喷涂、木纹转印）
  unit: MaterialUnit; // 基本单位
  brand: string; // 品牌 / 供应商简称
  description?: string; // 物料描述 / 备注
  barcode?: string; // 内部条形码 / 二维码
  status: MaterialStatus; // 状态：启用 / 停用
  /** ★ 单件重量（kg / 单位）：门窗型材/玻璃等按重量计价的物料必填 */
  weightKg?: number;
  /** ★ 单件体积（m³ / 单位）：运输 / 仓储体积测算用 */
  volumeM3?: number;
}

/**
 * 库存管理信息（实时跟踪物料库存状态）
 */
export interface IInventory {
  materialId: string; // 关联物料 ID
  warehouseId: string; // 所在仓库 ID
  locationCode: string; // 库位编码（如 A-01-02）
  currentQty: number; // 当前库存数量
  lockedQty: number; // 锁定数量（已分配给生产单但未出库）
  availableQty: number; // 可用库存（currentQty - lockedQty）
  safetyStock: number; // 安全库存下限
  maxStock?: number; // 最高库存上限
  lastInboundTime?: string; // 最后入库时间
  lastOutboundTime?: string; // 最后出库时间
}

/**
 * 采购与成本信息（采购计划与成本核算）
 */
export interface IMaterialCost {
  materialId: string; // 关联物料 ID
  defaultSupplierId: string; // 默认供应商 ID
  unitPrice: number; // 标准单价（元）
  currency: string; // 币种（如 CNY）
  leadTimeDays: number; // 采购提前期（天）
  moq: number; // 最小起订量
  costType: CostType; // 成本类型：固定 / 变动
  lastPurchasePrice: number; // 最近一次采购价
  lastPurchaseDate?: string; // 最近一次采购日期
}

/**
 * 出入库流水记录（追溯与审计）
 */
export interface IInventoryTransaction extends IBaseEntity {
  id: string; // 流水 ID
  transactionType: TransactionType; // 业务类型：入库 / 出库 / 盘点调整 / 调拨
  materialId: string; // 物料 ID
  quantity: number; // 变动数量（正负号表示方向）
  beforeQty: number; // 变动前库存
  afterQty: number; // 变动后库存
  relatedDocNo: string; // 关联单据号（如 PO-20231001 / WO-20231002）
  operatorId: string; // 操作人 ID
  operateTime: string; // 操作时间
  remark?: string; // 备注
}

// =====================================================================
// ④ Zod 运行时校验 schema
// =====================================================================

export const MaterialSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1, '物料名称必填'),
  category: MaterialCategorySchema,
  specModel: z.string().default(''),
  color: z.string().default(''),
  unit: MaterialUnitSchema,
  brand: z.string().default(''),
  description: z.string().optional(),
  barcode: z.string().optional(),
  status: MaterialStatusSchema.default('active'),
  weightKg: z.number().nonnegative().optional(),
  volumeM3: z.number().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  isDeleted: z.boolean().default(false),
});
export type MaterialRecord = z.infer<typeof MaterialSchema>;

/** 新增物料输入（id / 审计字段由服务端生成或忽略；code 为空则自动生成） */
export const MaterialCreateSchema = MaterialSchema.omit({ id: true, createdAt: true, updatedAt: true, isDeleted: true }).extend({
  code: z.string().min(1).or(z.literal('')),
});
export type MaterialCreateInput = z.infer<typeof MaterialCreateSchema>;

export const InventorySchema = z.object({
  materialId: z.string().min(1),
  warehouseId: z.string().min(1),
  locationCode: z.string().min(1),
  currentQty: z.number().int().nonnegative().default(0),
  lockedQty: z.number().int().nonnegative().default(0),
  availableQty: z.number().int().nonnegative().default(0),
  safetyStock: z.number().int().nonnegative().default(0),
  maxStock: z.number().int().nonnegative().optional(),
  lastInboundTime: z.string().optional(),
  lastOutboundTime: z.string().optional(),
});
export type InventoryRecord = z.infer<typeof InventorySchema>;

export const MaterialCostSchema = z.object({
  materialId: z.string().min(1),
  defaultSupplierId: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  currency: z.string().default('CNY'),
  leadTimeDays: z.number().int().nonnegative().default(7),
  moq: z.number().int().positive().default(1),
  costType: CostTypeSchema.default('variable'),
  lastPurchasePrice: z.number().nonnegative(),
  lastPurchaseDate: z.string().optional(),
});
export type CostRecord = z.infer<typeof MaterialCostSchema>;

export const InventoryTransactionSchema = z.object({
  id: z.string().min(1),
  transactionType: TransactionTypeSchema,
  materialId: z.string().min(1),
  quantity: z.number(),
  beforeQty: z.number(),
  afterQty: z.number(),
  relatedDocNo: z.string().default(''),
  operatorId: z.string().default('system'),
  operateTime: z.string(),
  remark: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  isDeleted: z.boolean().default(false),
});
export type TransactionRecord = z.infer<typeof InventoryTransactionSchema>;

// =====================================================================
// ⑤ 物料编码生成器
// =====================================================================

/** 规格型号规范化：大写、非法字符转 '-'、去首尾 */
export function normalizeMaterialSpec(spec: string): string {
  return spec
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 解析已有编码：{ category?, spec?, seq? }（用于续号，避免人工输入错误） */
export function parseMaterialCode(code: string): { category?: MaterialCategory; spec?: string; seq?: number } {
  const parts = code.trim().toUpperCase().split('-').filter(Boolean);
  if (parts.length < 2) return {};
  const prefix = parts[0];
  const category = (Object.keys(MATERIAL_CODE_PREFIX) as MaterialCategory[]).find((k) => MATERIAL_CODE_PREFIX[k] === prefix);
  const seq = Number(parts[parts.length - 1]);
  return {
    category,
    spec: parts.slice(1, -1).join('-'),
    seq: Number.isInteger(seq) && seq >= 0 ? seq : undefined,
  };
}

/**
 * 按企业规范自动生成物料编码：`分类前缀-规格型号-两位序号`
 * 例：generateMaterialCode('profile', '6063-T5', 1) → 'AL-6063-T5-01'
 */
export function generateMaterialCode(
  category: MaterialCategory,
  spec: string,
  seq = 1,
  opts: { padSeq?: number } = {},
): string {
  const pad = opts.padSeq ?? 2;
  const prefix = MATERIAL_CODE_PREFIX[category] ?? 'MT';
  const cleanSpec = normalizeMaterialSpec(spec);
  const seqStr = String(Math.max(1, Math.floor(seq))).padStart(pad, '0');
  return cleanSpec ? [prefix, cleanSpec, seqStr].join('-') : [prefix, seqStr].join('-');
}

/** 生成下一个可用编码：扫描已有编码中同分类同规格的最大序号 +1 */
export function nextMaterialCode(
  category: MaterialCategory,
  spec: string,
  existingCodes: string[],
  opts?: { padSeq?: number },
): string {
  const targetSpec = normalizeMaterialSpec(spec);
  let max = 0;
  for (const code of existingCodes) {
    const parsed = parseMaterialCode(code);
    if (parsed.category === category && parsed.spec === targetSpec && parsed.seq != null) {
      max = Math.max(max, parsed.seq);
    }
  }
  return generateMaterialCode(category, spec, max + 1, opts);
}
