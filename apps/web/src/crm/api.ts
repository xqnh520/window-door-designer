/**
 * CRM API 客户端 —— 对接 /crm/* 接口（服务端实现见 apps/server/src/crm/）
 */
import type {
  CreateCustomerDto,
  CreateFollowUpDto,
  CreateOrderDto,
  CreateSchemeDto,
  Customer,
  CustomerStatus,
  DesignScheme,
  FollowUp,
  Order,
  OrderStatus,
  Page,
  UpdateOrderDto,
  UpdateSchemeDto,
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

export const crmApi = {
  // ---- 客户 ----
  listCustomers(params: { page?: number; pageSize?: number; status?: CustomerStatus; keyword?: string }): Promise<Page<Customer>> {
    return request(`/crm/customers${qs({ ...params })}`);
  },
  createCustomer(dto: CreateCustomerDto): Promise<Customer> {
    return request('/crm/customers', { method: 'POST', body: JSON.stringify(dto) });
  },
  getCustomer(id: string): Promise<Customer> {
    return request(`/crm/customers/${id}`);
  },
  updateCustomer(id: string, dto: Partial<CreateCustomerDto>): Promise<Customer> {
    return request(`/crm/customers/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  },
  removeCustomer(id: string): Promise<void> {
    return request(`/crm/customers/${id}`, { method: 'DELETE' });
  },

  // ---- 跟进 ----
  listFollowUps(customerId: string): Promise<FollowUp[]> {
    return request(`/crm/customers/${customerId}/follow-ups`);
  },
  createFollowUp(customerId: string, dto: CreateFollowUpDto): Promise<FollowUp> {
    return request(`/crm/customers/${customerId}/follow-ups`, { method: 'POST', body: JSON.stringify(dto) });
  },
  removeFollowUp(id: string): Promise<void> {
    return request(`/crm/follow-ups/${id}`, { method: 'DELETE' });
  },

  // ---- 方案（Konva） ----
  listSchemes(customerId: string): Promise<DesignScheme[]> {
    return request(`/crm/customers/${customerId}/schemes`);
  },
  getScheme(id: string): Promise<DesignScheme> {
    return request(`/crm/schemes/${id}`);
  },
  createScheme(dto: CreateSchemeDto): Promise<DesignScheme> {
    return request('/crm/schemes', { method: 'POST', body: JSON.stringify(dto) });
  },
  updateScheme(id: string, dto: UpdateSchemeDto): Promise<DesignScheme> {
    return request(`/crm/schemes/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
  },
  removeScheme(id: string): Promise<void> {
    return request(`/crm/schemes/${id}`, { method: 'DELETE' });
  },

  // ---- 订单 ----
  listOrders(params: { customerId?: string; status?: OrderStatus; page?: number; pageSize?: number }): Promise<Page<Order>> {
    return request(`/crm/orders${qs({ ...params })}`);
  },
  createOrder(dto: CreateOrderDto): Promise<Order> {
    return request('/crm/orders', { method: 'POST', body: JSON.stringify(dto) });
  },
  getOrder(id: string): Promise<Order> {
    return request(`/crm/orders/${id}`);
  },
  updateOrder(id: string, dto: UpdateOrderDto): Promise<Order> {
    return request(`/crm/orders/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  },
};
