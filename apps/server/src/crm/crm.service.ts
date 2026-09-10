import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaCrmRepository } from './prisma.crm.repository';
import {
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  type CreateCustomerDto,
  type CreateFollowUpDto,
  type CreateOrderDto,
  type CreateSchemeDto,
  type Customer,
  type DesignScheme,
  type FollowUp,
  type Order,
  type Page,
  type UpdateCustomerDto,
  type UpdateOrderDto,
  type UpdateSchemeDto,
} from './crm.types';

const nowIso = () => new Date().toISOString();

/** 列表分页辅助 */
function paginate<T>(list: T[], page = 1, pageSize = 20): Page<T> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 20));
  const start = (safePage - 1) * safeSize;
  return {
    list: list.slice(start, start + safeSize),
    total: list.length,
    page: safePage,
    pageSize: safeSize,
  };
}

@Injectable()
export class CrmService {
  constructor(private readonly repo: PrismaCrmRepository) {}

  // ==================== 客户 ====================

  async listCustomers(params: { page?: number; pageSize?: number; status?: string; keyword?: string }): Promise<Page<Customer>> {
    const db = await this.repo.getDb();
    const status = (params.status ?? '') as Customer['status'];
    const keyword = (params.keyword ?? '').trim().toLowerCase();
    const filtered = db.customers.filter((c) => {
      if (params.status && CUSTOMER_STATUSES.includes(status) && c.status !== status) return false;
      if (keyword) {
        const hit = [c.name, c.phone, c.community ?? ''].some((v) => v.toLowerCase().includes(keyword));
        if (!hit) return false;
      }
      return true;
    });
    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return paginate(filtered, params.page, params.pageSize);
  }

  async getCustomer(id: string): Promise<Customer> {
    const db = await this.repo.getDb();
    const c = db.customers.find((x) => x.id === id);
    if (!c) throw new NotFoundException(`客户 ${id} 不存在`);
    return c;
  }

  async createCustomer(dto: CreateCustomerDto): Promise<Customer> {
    const db = await this.repo.getDb();
    if (db.customers.some((c) => c.phone === dto.phone)) {
      throw new ConflictException(`电话 ${dto.phone} 已建档`);
    }
    const now = nowIso();
    const customer: Customer = {
      id: randomUUID(),
      name: dto.name,
      phone: dto.phone,
      community: dto.community ?? null,
      houseType: dto.houseType ?? null,
      budget: dto.budget ?? null,
      source: dto.source ?? null,
      status: dto.status ?? 'C_COLD',
      createdAt: now,
      updatedAt: now,
    };
    db.customers.push(customer);
    await this.repo.persist();
    return customer;
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const db = await this.repo.getDb();
    const c = db.customers.find((x) => x.id === id);
    if (!c) throw new NotFoundException(`客户 ${id} 不存在`);
    if (dto.phone && dto.phone !== c.phone && db.customers.some((x) => x.phone === dto.phone)) {
      throw new ConflictException(`电话 ${dto.phone} 已建档`);
    }
    Object.assign(c, omitUndefined(dto), { updatedAt: nowIso() });
    await this.repo.persist();
    return c;
  }

  /** 删除客户（级联删除跟进/方案/订单） */
  async removeCustomer(id: string): Promise<{ id: string; deleted: boolean }> {
    const db = await this.repo.getDb();
    const idx = db.customers.findIndex((x) => x.id === id);
    if (idx < 0) throw new NotFoundException(`客户 ${id} 不存在`);
    db.customers.splice(idx, 1);
    db.followUps = db.followUps.filter((f) => f.customerId !== id);
    db.schemes = db.schemes.filter((s) => s.customerId !== id);
    db.orders = db.orders.filter((o) => o.customerId !== id);
    await this.repo.persist();
    return { id, deleted: true };
  }

  // ==================== 跟进 ====================

  async listFollowUps(customerId: string): Promise<FollowUp[]> {
    await this.getCustomer(customerId);
    const db = await this.repo.getDb();
    return db.followUps
      .filter((f) => f.customerId === customerId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createFollowUp(customerId: string, dto: CreateFollowUpDto): Promise<FollowUp> {
    await this.getCustomer(customerId);
    const db = await this.repo.getDb();
    const followUp: FollowUp = {
      id: randomUUID(),
      customerId,
      content: dto.content,
      nextFollowDate: dto.nextFollowDate ?? null,
      createdAt: nowIso(),
    };
    db.followUps.push(followUp);
    await this.repo.persist();
    return followUp;
  }

  async removeFollowUp(id: string): Promise<{ id: string; deleted: boolean }> {
    const db = await this.repo.getDb();
    const before = db.followUps.length;
    db.followUps = db.followUps.filter((f) => f.id !== id);
    if (db.followUps.length === before) throw new NotFoundException(`跟进记录 ${id} 不存在`);
    await this.repo.persist();
    return { id, deleted: true };
  }

  // ==================== 方案（Konva） ====================

  /** 方案列表（摘要，不含 designData 大字段） */
  async listSchemes(customerId: string): Promise<Omit<DesignScheme, 'designData'>[]> {
    await this.getCustomer(customerId);
    const db = await this.repo.getDb();
    return db.schemes
      .filter((s) => s.customerId === customerId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map(({ designData: _dd, ...rest }) => rest);
  }

  async getScheme(id: string): Promise<DesignScheme> {
    const db = await this.repo.getDb();
    const s = db.schemes.find((x) => x.id === id);
    if (!s) throw new NotFoundException(`方案 ${id} 不存在`);
    return s;
  }

  async createScheme(dto: CreateSchemeDto): Promise<DesignScheme> {
    await this.getCustomer(dto.customerId);
    const db = await this.repo.getDb();
    const now = nowIso();
    const scheme: DesignScheme = {
      id: randomUUID(),
      customerId: dto.customerId,
      name: dto.name,
      totalWidth: dto.totalWidth,
      totalHeight: dto.totalHeight,
      seriesName: dto.seriesName,
      colorConfig: dto.colorConfig,
      designData: dto.designData,
      schemaVersion: dto.schemaVersion ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    db.schemes.push(scheme);
    await this.repo.persist();
    return scheme;
  }

  async updateScheme(id: string, dto: UpdateSchemeDto): Promise<DesignScheme> {
    const db = await this.repo.getDb();
    const s = db.schemes.find((x) => x.id === id);
    if (!s) throw new NotFoundException(`方案 ${id} 不存在`);
    Object.assign(s, omitUndefined(dto), { updatedAt: nowIso() });
    await this.repo.persist();
    return s;
  }

  async removeScheme(id: string): Promise<{ id: string; deleted: boolean }> {
    const db = await this.repo.getDb();
    const before = db.schemes.length;
    db.schemes = db.schemes.filter((s) => s.id !== id);
    db.orders.forEach((o) => {
      if (o.schemeId === id) o.schemeId = null;
    });
    if (db.schemes.length === before) throw new NotFoundException(`方案 ${id} 不存在`);
    await this.repo.persist();
    return { id, deleted: true };
  }

  // ==================== 订单 ====================

  async listOrders(params: { customerId?: string; status?: string; page?: number; pageSize?: number }): Promise<Page<Order>> {
    const db = await this.repo.getDb();
    const status = (params.status ?? '') as Order['status'];
    const filtered = db.orders.filter((o) => {
      if (params.customerId && o.customerId !== params.customerId) return false;
      if (params.status && ORDER_STATUSES.includes(status) && o.status !== status) return false;
      return true;
    });
    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return paginate(filtered, params.page, params.pageSize);
  }

  async getOrder(id: string): Promise<Order> {
    const db = await this.repo.getDb();
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new NotFoundException(`订单 ${id} 不存在`);
    return o;
  }

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    // 先校验客户/方案，再取最新快照写入（getDb 每次全量重载，提前取引用会过期）
    await this.getCustomer(dto.customerId);
    const db = await this.repo.getDb();
    if (dto.schemeId) {
      const scheme = db.schemes.find((s) => s.id === dto.schemeId);
      if (!scheme) throw new BadRequestException(`方案 ${dto.schemeId} 不存在`);
      if (scheme.customerId !== dto.customerId) throw new BadRequestException('方案不属于该客户，禁止串单');
    }
    const now = nowIso();
    const order: Order = {
      id: randomUUID(),
      customerId: dto.customerId,
      schemeId: dto.schemeId ?? null,
      status: dto.status ?? 'PENDING_PRODUCTION',
      totalAmount: dto.totalAmount,
      deposit: dto.deposit ?? 0,
      balance: dto.balance ?? 0,
      remark: dto.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    db.orders.push(order);
    await this.repo.persist();
    return order;
  }

  async updateOrder(id: string, dto: UpdateOrderDto): Promise<Order> {
    const db = await this.repo.getDb();
    const o = db.orders.find((x) => x.id === id);
    if (!o) throw new NotFoundException(`订单 ${id} 不存在`);
    Object.assign(o, omitUndefined(dto), { updatedAt: nowIso() });
    await this.repo.persist();
    return o;
  }

  async removeOrder(id: string): Promise<{ id: string; deleted: boolean }> {
    const db = await this.repo.getDb();
    const before = db.orders.length;
    db.orders = db.orders.filter((o) => o.id !== id);
    if (db.orders.length === before) throw new NotFoundException(`订单 ${id} 不存在`);
    await this.repo.persist();
    return { id, deleted: true };
  }
}

function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}
