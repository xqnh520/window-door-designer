/**
 * 门窗客户管理系统 Zustand Store
 * 独立于设计器 useStore；两者仅在「保存方案 / 加载回显」时经 crm/konva.ts 互读
 */
import { create } from 'zustand';
import { crmApi } from './api';
import type {
  CreateCustomerDto,
  CreateFollowUpDto,
  CreateOrderDto,
  Customer,
  CustomerStatus,
  DesignScheme,
  FollowUp,
  Order,
  UpdateOrderDto,
} from './types';

const PAGE_SIZE = 20;

export interface CrmState {
  // 客户列表
  customers: Customer[];
  customerTotal: number;
  page: number;
  pageSize: number;
  keyword: string;
  statusFilter: CustomerStatus | undefined;
  loadingList: boolean;

  // 当前客户（详情页聚合）
  selectedCustomerId: string | null;
  currentCustomer: Customer | null;
  followUps: FollowUp[];
  schemes: DesignScheme[];
  currentScheme: DesignScheme | null;
  orders: Order[];
  loadingDetail: boolean;
  error: string | null;

  // actions
  fetchCustomers: (p?: { page?: number; pageSize?: number; keyword?: string; status?: CustomerStatus }) => Promise<void>;
  createCustomer: (dto: CreateCustomerDto) => Promise<Customer>;
  updateCustomer: (id: string, dto: Partial<CreateCustomerDto>) => Promise<void>;
  removeCustomer: (id: string) => Promise<void>;

  openCustomer: (id: string) => void;
  /** 设计器属性面板选择“保存方案”的归属客户（null = 清除选择） */
  setSchemeCustomer: (id: string | null) => void;
  loadCustomerDetail: (id: string) => Promise<void>;

  addFollowUp: (customerId: string, dto: CreateFollowUpDto) => Promise<void>;
  removeFollowUp: (id: string) => Promise<void>;

  refreshSchemes: (customerId: string) => Promise<void>;
  setCurrentScheme: (scheme: DesignScheme | null) => void;
  setSchemeSaved: (scheme: DesignScheme) => void;
  removeScheme: (customerId: string, schemeId: string) => Promise<void>;

  fetchOrders: (customerId: string) => Promise<void>;
  createOrder: (dto: CreateOrderDto) => Promise<void>;
  updateOrder: (id: string, dto: UpdateOrderDto) => Promise<void>;
}

export const useCrmStore = create<CrmState>((set, get) => ({
  customers: [],
  customerTotal: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  keyword: '',
  statusFilter: undefined,
  loadingList: false,

  selectedCustomerId: null,
  currentCustomer: null,
  followUps: [],
  schemes: [],
  currentScheme: null,
  orders: [],
  loadingDetail: false,
  error: null,

  // ---------- 客户列表 ----------
  fetchCustomers: async (p) => {
    set({ loadingList: true, error: null });
    try {
      const page = p?.page ?? get().page;
      const pageSize = p?.pageSize ?? get().pageSize;
      const keyword = p?.keyword ?? get().keyword;
      const statusFilter = p?.status ?? get().statusFilter;
      const data = await crmApi.listCustomers({ page, pageSize, keyword, status: statusFilter });
      set({
        customers: data.list,
        customerTotal: data.total,
        page: data.page,
        pageSize: data.pageSize,
        keyword,
        statusFilter,
      });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loadingList: false });
    }
  },

  createCustomer: async (dto) => {
    const created = await crmApi.createCustomer(dto);
    await get().fetchCustomers();
    return created;
  },

  updateCustomer: async (id, dto) => {
    await crmApi.updateCustomer(id, dto);
    const current = get().currentCustomer;
    if (current?.id === id) {
      const updated = await crmApi.getCustomer(id);
      set({ currentCustomer: updated });
    }
    await get().fetchCustomers();
  },

  removeCustomer: async (id) => {
    await crmApi.removeCustomer(id);
    if (get().currentCustomer?.id === id) set({ currentCustomer: null });
    await get().fetchCustomers();
  },

  // ---------- 客户详情 ----------
  openCustomer: (id) => set({ selectedCustomerId: id, currentCustomer: null, error: null }),

  setSchemeCustomer: (id) => set({ selectedCustomerId: id, error: null }),

  loadCustomerDetail: async (id) => {
    set({ loadingDetail: true, error: null });
    try {
      const [customer, followUps, schemes, orders] = await Promise.all([
        crmApi.getCustomer(id),
        crmApi.listFollowUps(id),
        crmApi.listSchemes(id),
        crmApi.listOrders({ customerId: id, pageSize: 50 }),
      ]);
      set({
        currentCustomer: customer,
        followUps,
        schemes,
        orders: orders.list,
        loadingDetail: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loadingDetail: false });
    }
  },

  // ---------- 跟进 ----------
  addFollowUp: async (customerId, dto) => {
    await crmApi.createFollowUp(customerId, dto);
    const list = await crmApi.listFollowUps(customerId);
    set({ followUps: list });
  },

  removeFollowUp: async (id) => {
    await crmApi.removeFollowUp(id);
    const customerId = get().currentCustomer?.id;
    if (customerId) set({ followUps: await crmApi.listFollowUps(customerId) });
  },

  // ---------- 方案 ----------
  refreshSchemes: async (customerId) => {
    set({ schemes: await crmApi.listSchemes(customerId) });
  },

  setCurrentScheme: (scheme) => set({ currentScheme: scheme }),

  setSchemeSaved: (scheme) => {
    set({ currentScheme: scheme });
    set((state) => ({
      schemes: state.schemes.some((s) => s.id === scheme.id)
        ? state.schemes.map((s) => (s.id === scheme.id ? { ...s, ...scheme } : s))
        : [scheme, ...state.schemes],
    }));
  },

  removeScheme: async (customerId, schemeId) => {
    await crmApi.removeScheme(schemeId);
    set({ schemes: get().schemes.filter((s) => s.id !== schemeId) });
    if (get().currentScheme?.id === schemeId) set({ currentScheme: null });
    void customerId;
  },

  // ---------- 订单 ----------
  fetchOrders: async (customerId) => {
    const data = await crmApi.listOrders({ customerId, pageSize: 50 });
    set({ orders: data.list });
  },

  createOrder: async (dto) => {
    await crmApi.createOrder(dto);
    if (get().currentCustomer) await get().fetchOrders(dto.customerId);
  },

  updateOrder: async (id, dto) => {
    await crmApi.updateOrder(id, dto);
    const customerId = get().currentCustomer?.id;
    if (customerId) await get().fetchOrders(customerId);
  },
}));
