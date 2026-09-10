/**
 * 仓库管理 Zustand Store（独立于设计器 useStore 与 useCrmStore，纯内存不持久化）
 *
 * 约定：载入类 action 内部捕获异常写入 error（页面用 Alert 展示）；
 * 变更类 action 直接抛出，由调用方（弹窗）用 message.error 提示具体原因。
 */
import { create } from 'zustand';
import type { MaterialCategory } from '@wdd/schema';
import { warehouseApi } from './api';
import type {
  AdjustInventoryDto,
  BatchOutboundDto,
  BatchResult,
  CreateMaterialDto,
  CreateWarehouseDto,
  InventoryOpDto,
  InventoryRow,
  InventorySummary,
  Material,
  Page,
  TransactionQuery,
  TransactionRow,
  UpdateInventoryMetaDto,
  UpdateMaterialDto,
  UpdateWarehouseDto,
  Warehouse,
} from './types';

/** 仓库筛选：'all' = 全部仓库 */
export const ALL_WAREHOUSES = 'all';

const TX_PAGE_SIZE = 20;

export interface WarehouseState {
  warehouses: Warehouse[];
  activeWarehouseId: string;
  inventory: InventoryRow[];
  summary: InventorySummary | null;
  categoryFilter?: MaterialCategory;
  onlyWarning: boolean;
  loadingInventory: boolean;

  materials: Material[];
  loadingMaterials: boolean;

  transactions: Page<TransactionRow> | null;
  txQuery: TransactionQuery;
  loadingTx: boolean;

  loadingWarehouses: boolean;
  error: string | null;

  // ---- actions ----
  bootstrap: () => Promise<void>;
  loadWarehouses: () => Promise<void>;
  setActiveWarehouse: (id: string) => void;
  loadInventory: () => Promise<void>;
  loadSummary: () => Promise<void>;
  setInventoryFilter: (patch: { category?: MaterialCategory; onlyWarning?: boolean }) => void;

  submitInbound: (dto: InventoryOpDto) => Promise<void>;
  submitOutbound: (dto: InventoryOpDto) => Promise<void>;
  submitAdjust: (dto: AdjustInventoryDto) => Promise<void>;
  submitBatch: (dto: BatchOutboundDto) => Promise<BatchResult>;
  updateMeta: (dto: UpdateInventoryMetaDto) => Promise<void>;

  loadMaterials: () => Promise<void>;
  saveMaterial: (dto: CreateMaterialDto | UpdateMaterialDto, id?: string) => Promise<void>;
  removeMaterial: (id: string) => Promise<void>;

  saveWarehouse: (dto: CreateWarehouseDto | UpdateWarehouseDto, id?: string) => Promise<void>;
  removeWarehouse: (id: string) => Promise<void>;

  loadTransactions: (patch?: TransactionQuery) => Promise<void>;
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  warehouses: [],
  activeWarehouseId: ALL_WAREHOUSES,
  inventory: [],
  summary: null,
  categoryFilter: undefined,
  onlyWarning: false,
  loadingInventory: false,

  materials: [],
  loadingMaterials: false,

  transactions: null,
  txQuery: { page: 1, pageSize: TX_PAGE_SIZE },
  loadingTx: false,

  loadingWarehouses: false,
  error: null,

  bootstrap: async () => {
    await get().loadWarehouses();
    await Promise.all([get().loadInventory(), get().loadSummary(), get().loadMaterials()]);
  },

  loadWarehouses: async () => {
    set({ loadingWarehouses: true, error: null });
    try {
      const warehouses = await warehouseApi.listWarehouses();
      const active = get().activeWarehouseId;
      // 当前选中的仓库被删除后回退到「全部」
      const stillThere = active === ALL_WAREHOUSES || warehouses.some((w) => w.id === active);
      set({ warehouses, activeWarehouseId: stillThere ? active : ALL_WAREHOUSES });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loadingWarehouses: false });
    }
  },

  setActiveWarehouse: (id) => {
    set({ activeWarehouseId: id });
    void get().loadInventory();
    void get().loadSummary();
  },

  loadInventory: async () => {
    set({ loadingInventory: true, error: null });
    try {
      const { activeWarehouseId, categoryFilter, onlyWarning } = get();
      const inventory = await warehouseApi.listInventory({
        warehouseId: activeWarehouseId === ALL_WAREHOUSES ? undefined : activeWarehouseId,
        category: categoryFilter,
        onlyWarning,
      });
      set({ inventory });
    } catch (err) {
      set({ error: (err as Error).message, inventory: [] });
    } finally {
      set({ loadingInventory: false });
    }
  },

  loadSummary: async () => {
    try {
      const { activeWarehouseId } = get();
      const summary = await warehouseApi.summary(
        activeWarehouseId === ALL_WAREHOUSES ? undefined : activeWarehouseId,
      );
      set({ summary });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setInventoryFilter: (patch) => {
    // 用 `in` 而不是 !== undefined 判断：Select 的 allowClear 清空时回调值就是 undefined，
    // 那代表「显式清空该筛选」，不能被当成「没传这个字段」而保留旧值
    const next: { categoryFilter?: MaterialCategory; onlyWarning?: boolean } = {};
    if ('category' in patch) next.categoryFilter = patch.category;
    if ('onlyWarning' in patch) next.onlyWarning = patch.onlyWarning;
    set(next);
    void get().loadInventory();
  },

  submitInbound: async (dto) => {
    await warehouseApi.inbound(dto);
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  submitOutbound: async (dto) => {
    await warehouseApi.outbound(dto);
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  submitAdjust: async (dto) => {
    await warehouseApi.adjust(dto);
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  submitBatch: async (dto) => {
    const result = await warehouseApi.batchOutbound(dto);
    await Promise.all([get().loadInventory(), get().loadSummary()]);
    return result;
  },

  updateMeta: async (dto) => {
    await warehouseApi.updateMeta(dto);
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  loadMaterials: async () => {
    set({ loadingMaterials: true, error: null });
    try {
      set({ materials: await warehouseApi.listMaterials() });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loadingMaterials: false });
    }
  },

  saveMaterial: async (dto, id) => {
    if (id) await warehouseApi.updateMaterial(id, dto as UpdateMaterialDto);
    else await warehouseApi.createMaterial(dto as CreateMaterialDto);
    await get().loadMaterials();
  },

  removeMaterial: async (id) => {
    await warehouseApi.removeMaterial(id);
    await Promise.all([get().loadMaterials(), get().loadInventory(), get().loadSummary()]);
  },

  saveWarehouse: async (dto, id) => {
    if (id) await warehouseApi.updateWarehouse(id, dto as UpdateWarehouseDto);
    else await warehouseApi.createWarehouse(dto as CreateWarehouseDto);
    await get().loadWarehouses();
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  removeWarehouse: async (id) => {
    await warehouseApi.removeWarehouse(id);
    await get().loadWarehouses();
    await Promise.all([get().loadInventory(), get().loadSummary()]);
  },

  loadTransactions: async (patch) => {
    set({ loadingTx: true, error: null });
    const txQuery = { ...get().txQuery, ...patch };
    try {
      const transactions = await warehouseApi.listTransactions(txQuery);
      set({ transactions, txQuery: { ...txQuery, page: transactions.page, pageSize: transactions.pageSize } });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loadingTx: false });
    }
  },
}));
