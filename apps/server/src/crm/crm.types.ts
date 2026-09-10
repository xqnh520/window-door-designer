/**
 * 门窗客户管理系统（CRM）类型 —— 与 apps/server/prisma/schema.prisma 中 CRM 模型一致
 * 当前持久化为 JSON 文件；接入 Prisma 后由 Repository 层切换（模型不变）
 */
export type CustomerStatus = 'A_HOT' | 'B_WARM' | 'C_COLD' | 'MEASURED' | 'SIGNED' | 'LOST';
export type OrderStatus = 'PENDING_PRODUCTION' | 'IN_PRODUCTION' | 'SHIPPED' | 'PENDING_INSTALL' | 'COMPLETED' | 'AFTER_SALES';

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

/** designData：Konva ShapeModel[] 的 JSON 序列化结果 */
export type ShapeModelJson = Record<string, unknown>;

export interface DesignScheme {
  id: string;
  customerId: string;
  name: string;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
  colorConfig: ColorConfig;
  designData: ShapeModelJson[];
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

export interface CrmDb {
  customers: Customer[];
  followUps: FollowUp[];
  schemes: DesignScheme[];
  orders: Order[];
}

// ---------- DTO ----------

export interface CreateCustomerDto {
  name: string;
  phone: string;
  community?: string;
  houseType?: string;
  budget?: number;
  source?: string;
  status?: CustomerStatus;
}
export type UpdateCustomerDto = Partial<CreateCustomerDto>;

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
export type UpdateSchemeDto = Partial<Omit<CreateSchemeDto, 'customerId'>>;

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

export const CUSTOMER_STATUSES: CustomerStatus[] = ['A_HOT', 'B_WARM', 'C_COLD', 'MEASURED', 'SIGNED', 'LOST'];
export const ORDER_STATUSES: OrderStatus[] = ['PENDING_PRODUCTION', 'IN_PRODUCTION', 'SHIPPED', 'PENDING_INSTALL', 'COMPLETED', 'AFTER_SALES'];
