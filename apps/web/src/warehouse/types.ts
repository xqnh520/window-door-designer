/**
 * 仓库管理前端类型。
 * 实体复用 @wdd/schema（IWarehouse / IMaterial / IInventory / IInventoryTransaction），
 * 此处只补充「服务端返回的行视图」与「请求 DTO」。
 */
import type {
  IInventory,
  IInventoryTransaction,
  IMaterial,
  IWarehouse,
  MaterialCategory,
  MaterialStatus,
  MaterialUnit,
  TransactionType,
} from '@wdd/schema';

export type Warehouse = IWarehouse;
export type Material = IMaterial;
export type Inventory = IInventory;
export type Transaction = IInventoryTransaction;

/** 分页容器（与 crm/types.ts 的 Page 同构） */
export interface Page<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /inventory 的行：库存 + 物料 + 仓库名 + 缺料标记 */
export interface InventoryRow extends IInventory {
  material: IMaterial;
  warehouseName?: string;
  /** availableQty < safetyStock（且 safetyStock > 0） */
  warning: boolean;
}

/** GET /inventory/transactions 的行 */
export interface TransactionRow extends IInventoryTransaction {
  material?: IMaterial;
  warehouseName?: string;
}

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

// ---------- 查询参数 ----------

export interface InventoryQuery {
  warehouseId?: string;
  category?: MaterialCategory;
  onlyWarning?: boolean;
}

export interface TransactionQuery {
  materialId?: string;
  transactionType?: TransactionType;
  warehouseId?: string;
  keyword?: string;
  /** ISO 字符串；按日筛选需自行补全为 T00:00:00 / T23:59:59.999 */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// ---------- 出入库 / 盘点 ----------

/** 出入库共用入参；盘点用 countedQty 而非 quantity */
export interface InventoryOpDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  quantity: number;
  relatedDocNo?: string;
  operatorId?: string;
  remark?: string;
}

export interface AdjustInventoryDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  /** 实盘数量（>=0），服务端把 currentQty 设为该值并记差额流水 */
  countedQty: number;
  relatedDocNo?: string;
  operatorId?: string;
  remark?: string;
}

export interface UpdateInventoryMetaDto {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  safetyStock?: number;
  maxStock?: number;
  lockedQty?: number;
}

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
  transaction?: Transaction;
  error?: string;
}

/** 批量结果恒以 2xx 返回，逐行成败在 results 里 */
export interface BatchResult {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  relatedDocNo: string;
  results: BatchLineResult[];
}

/** 出入库弹窗的三种业务类型 */
export type StockOpKind = 'inbound' | 'outbound' | 'adjust';

// ---------- 主数据 DTO ----------

export interface CreateWarehouseDto {
  code?: string; // 留空自动生成 WH01…
  name: string;
  address?: string;
  manager?: string;
  phone?: string;
  locations?: string[];
  isDefault?: boolean;
  status?: MaterialStatus;
  remark?: string;
}

export type UpdateWarehouseDto = Partial<CreateWarehouseDto>;

export interface CreateMaterialDto {
  code?: string; // 留空自动生成
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
}

export type UpdateMaterialDto = Partial<Omit<CreateMaterialDto, 'code'>>;
