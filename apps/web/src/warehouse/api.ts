/**
 * 仓库管理 API 客户端 —— 对接 /warehouses、/inventory、/materials
 * （服务端实现见 apps/server/src/materials/）
 */
import type { IMaterial, IInventory, IInventoryTransaction } from '@wdd/schema';
import type {
  AdjustInventoryDto,
  BatchOutboundDto,
  BatchResult,
  CreateMaterialDto,
  CreateWarehouseDto,
  InventoryQuery,
  InventoryRow,
  InventorySummary,
  InventoryOpDto,
  Page,
  TransactionQuery,
  TransactionRow,
  UpdateInventoryMetaDto,
  UpdateMaterialDto,
  UpdateWarehouseDto,
  Warehouse,
} from './types';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const warehouseApi = {
  // ---- 仓库 / 库位主数据 ----
  listWarehouses(): Promise<Warehouse[]> {
    return request('/warehouses');
  },
  createWarehouse(dto: CreateWarehouseDto): Promise<Warehouse> {
    return request('/warehouses', { method: 'POST', body: JSON.stringify(dto) });
  },
  updateWarehouse(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    return request(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  },
  removeWarehouse(id: string): Promise<{ id: string; deleted: boolean }> {
    return request(`/warehouses/${id}`, { method: 'DELETE' });
  },

  // ---- 库存 ----
  listInventory(params: InventoryQuery = {}): Promise<InventoryRow[]> {
    return request(`/inventory${qs({
      warehouseId: params.warehouseId,
      category: params.category,
      onlyWarning: params.onlyWarning ? 1 : undefined,
    })}`);
  },
  summary(warehouseId?: string): Promise<InventorySummary> {
    return request(`/inventory/summary${qs({ warehouseId })}`);
  },
  updateMeta(dto: UpdateInventoryMetaDto): Promise<IInventory> {
    return request('/inventory', { method: 'PATCH', body: JSON.stringify(dto) });
  },
  inbound(dto: InventoryOpDto): Promise<IInventoryTransaction> {
    return request('/inventory/inbound', { method: 'POST', body: JSON.stringify(dto) });
  },
  outbound(dto: InventoryOpDto): Promise<IInventoryTransaction> {
    return request('/inventory/outbound', { method: 'POST', body: JSON.stringify(dto) });
  },
  adjust(dto: AdjustInventoryDto): Promise<IInventoryTransaction> {
    return request('/inventory/adjust', { method: 'POST', body: JSON.stringify(dto) });
  },
  batchOutbound(dto: BatchOutboundDto): Promise<BatchResult> {
    return request('/inventory/batch-outbound', { method: 'POST', body: JSON.stringify(dto) });
  },
  listTransactions(query: TransactionQuery = {}): Promise<Page<TransactionRow>> {
    return request(`/inventory/transactions${qs({ ...query })}`);
  },

  // ---- 物料档案（与「材料库」页的本地样例数据相互独立） ----
  listMaterials(params: { category?: string; status?: string; keyword?: string } = {}): Promise<IMaterial[]> {
    return request(`/materials${qs({ ...params })}`);
  },
  createMaterial(dto: CreateMaterialDto): Promise<IMaterial> {
    return request('/materials', { method: 'POST', body: JSON.stringify(dto) });
  },
  updateMaterial(id: string, dto: UpdateMaterialDto): Promise<IMaterial> {
    return request(`/materials/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  },
  removeMaterial(id: string): Promise<{ id: string; deleted: boolean }> {
    return request(`/materials/${id}`, { method: 'DELETE' });
  },
};
