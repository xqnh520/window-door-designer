/**
 * 仓库 / 库位主数据领域模型（仓库管理模块）
 *
 * 覆盖：
 * - IWarehouse（仓库档案 + 库位编码列表 + 默认仓标记）
 * - 枚举联合类型（status）与中文 Label
 * - 仓库编码生成器 generateWarehouseCode() / nextWarehouseCode()
 * - Zod 运行时校验 schema（与 material-catalog.ts 同风格，供前后端复用）
 *
 * 设计取舍：库位不做独立实体，而是仓库下的字符串数组 ——
 * 库存复合键 (materialId, warehouseId, locationCode) 保持不变，改动面最小；
 * 日后库位需要挂容量 / 负责人时再拆 Location 实体。
 */
import { z } from 'zod';
import type { IBaseEntity } from './material-catalog.js';

// =====================================================================
// ① 枚举 / 联合类型
// =====================================================================

export const WarehouseStatusSchema = z.enum(['active', 'inactive']);
export type WarehouseStatus = z.infer<typeof WarehouseStatusSchema>;
export const WarehouseStatusLabel: Record<WarehouseStatus, string> = {
  active: '启用',
  inactive: '停用',
};

/** 仓库状态选项（表单 Select 用） */
export const WAREHOUSE_STATUSES: readonly WarehouseStatus[] = ['active', 'inactive'];

// =====================================================================
// ② 核心接口
// =====================================================================

/**
 * 仓库档案（多仓库 + 库位主数据）
 */
export interface IWarehouse extends IBaseEntity {
  id: string; // 唯一标识符 (UUID)
  code: string; // 仓库编码（唯一，如 WH01）
  name: string; // 仓库名称（如 主仓库 / 型材仓）
  address?: string; // 仓库地址
  manager?: string; // 负责人
  phone?: string; // 联系电话
  /** 库位编码列表（如 A-01-02）；库存按 (仓库, 库位) 定位 */
  locations: string[];
  isDefault: boolean; // 默认仓（出入库弹窗的默认选项，全库仅一个）
  status: WarehouseStatus; // 状态：启用 / 停用
  remark?: string; // 备注
}

// =====================================================================
// ③ Zod 运行时校验 schema
// =====================================================================

export const WarehouseSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1, '仓库名称必填'),
  address: z.string().optional(),
  manager: z.string().optional(),
  phone: z.string().optional(),
  locations: z.array(z.string().min(1)).default([]),
  isDefault: z.boolean().default(false),
  status: WarehouseStatusSchema.default('active'),
  remark: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  isDeleted: z.boolean().default(false),
});
export type WarehouseRecord = z.infer<typeof WarehouseSchema>;

/** 新增仓库输入（id / 审计字段由服务端生成；code 为空则自动生成） */
export const WarehouseCreateSchema = WarehouseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  isDeleted: true,
}).extend({
  code: z.string().min(1).or(z.literal('')),
});
export type WarehouseCreateInput = z.infer<typeof WarehouseCreateSchema>;

// =====================================================================
// ④ 仓库编码生成器
// =====================================================================

/** 生成仓库编码：`WH` + 两位序号（WH01 / WH02 …，超过 99 自然进位为 WH100） */
export function generateWarehouseCode(seq = 1): string {
  return `WH${String(Math.max(1, Math.floor(seq))).padStart(2, '0')}`;
}

/** 生成下一个可用仓库编码：扫描已有 WH 序号取最大值 +1 */
export function nextWarehouseCode(existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    const m = /^WH0*(\d+)$/i.exec(code.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return generateWarehouseCode(max + 1);
}
