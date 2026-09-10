/**
 * 门窗客户管理系统（CRM）前端类型 —— 与 apps/server/prisma/schema.prisma 中 CRM 模型一一对应
 */
export type CustomerStatus = 'A_HOT' | 'B_WARM' | 'C_COLD' | 'MEASURED' | 'SIGNED' | 'LOST';
export type OrderStatus =
  | 'PENDING_PRODUCTION'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'PENDING_INSTALL'
  | 'COMPLETED'
  | 'AFTER_SALES';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  community: string | null;
  houseType: string | null;
  budget: number | null; // 万元
  source: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  customerId: string;
  content: string;
  nextFollowDate: string | null;
  createdAt: string;
}

export interface ColorConfig {
  outerColor: string;
  innerColor: string;
}

/** designData：与设计器 ShapeModel / SketchShape 同构的对象数组 */
export interface ShapeModelJson {
  id: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
  topRatio?: number;
  corners?: Array<{ x: number; y: number }>;
  p1?: { x: number; y: number };
  p2?: { x: number; y: number };
  text?: string;
  side?: 'left' | 'right';
  openDir?: 'in' | 'out';
  isDoor?: boolean;
  label?: string;
  sashes?: Array<{
    hingeSide: 'left' | 'right' | 'top' | 'bottom';
    openDirection: 'in' | 'out';
    rect: { x: number; y: number; w: number; h: number };
    label: string;
  }>;
  seriesId?: string;
  frameWidth?: number;
  glassInset?: number;
  componentKind?: string;
  materialRole?: string;
  windowType?: string;
}

export interface DesignScheme {
  id: string;
  customerId: string;
  name: string;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
  colorConfig: ColorConfig;
  designData: ShapeModelJson[]; // ★ Konva 画布数据
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  schemeId: string | null;
  status: OrderStatus;
  totalAmount: number;
  deposit: number;
  balance: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 保存方案输入（由设计器收集，见 crm/konva.ts） */
export interface SaveSchemeInput {
  schemeId?: string;
  name: string;
  shapes: ShapeModelJson[];
  colorConfig: ColorConfig;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
}

export interface CreateCustomerDto {
  name: string;
  phone: string;
  community?: string;
  houseType?: string;
  budget?: number;
  source?: string;
  status?: CustomerStatus;
}

export interface CreateFollowUpDto {
  content: string;
  nextFollowDate?: string;
}

export interface CreateSchemeDto {
  customerId: string;
  name: string;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
  colorConfig: ColorConfig;
  designData: ShapeModelJson[];
  schemaVersion?: number;
}

export interface UpdateSchemeDto {
  name?: string;
  totalWidth?: number;
  totalHeight?: number;
  seriesName?: string;
  colorConfig?: ColorConfig;
  designData?: ShapeModelJson[];
  schemaVersion?: number;
}

export interface CreateOrderDto {
  customerId: string;
  schemeId?: string;
  status?: OrderStatus;
  totalAmount: number;
  deposit?: number;
  balance?: number;
  remark?: string;
}

export interface UpdateOrderDto {
  status?: OrderStatus;
  deposit?: number;
  balance?: number;
  remark?: string;
}

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  A_HOT: 'A类（高意向）',
  B_WARM: 'B类（在对比）',
  C_COLD: 'C类（长期跟进）',
  MEASURED: '已量尺',
  SIGNED: '已签约',
  LOST: '已流失',
};

export const CUSTOMER_STATUS_COLOR: Record<CustomerStatus, string> = {
  A_HOT: 'red',
  B_WARM: 'orange',
  C_COLD: 'default',
  MEASURED: 'blue',
  SIGNED: 'green',
  LOST: 'default',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PRODUCTION: '待排产',
  IN_PRODUCTION: '生产中',
  SHIPPED: '已发货',
  PENDING_INSTALL: '待安装',
  COMPLETED: '已完成',
  AFTER_SALES: '售后中',
};

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING_PRODUCTION: 'default',
  IN_PRODUCTION: 'processing',
  SHIPPED: 'cyan',
  PENDING_INSTALL: 'blue',
  COMPLETED: 'green',
  AFTER_SALES: 'purple',
};

export const HOUSE_TYPES = ['新房', '旧改', '别墅', '商铺', '办公', '其他'];
export const LEAD_SOURCES = ['自然进店', '转介绍', '抖音', '小区地推', '老客户', '其他'];
