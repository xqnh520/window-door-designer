export interface OrderPayload {
  customer: string;
  phone?: string;
  designName: string;
  designId: string;
  openingW?: number;
  openingH?: number;
  seriesId?: string;
  total: number;
  bom: unknown[];
}

export interface Order extends OrderPayload {
  id: number;
  createdAt: string;
}

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

export async function fetchOrders(): Promise<Order[]> {
  const res = await fetch(`${BASE}/orders`);
  if (!res.ok) throw new Error(`获取订单失败: ${res.status}`);
  return res.json();
}

export async function createOrder(payload: OrderPayload): Promise<Order> {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`提交订单失败: ${res.status}`);
  return res.json();
}
