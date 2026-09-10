import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { CrmDb, Customer, DesignScheme, FollowUp, Order } from './crm.types';
import type { CrmRepository } from './crm.repository.interface';

const empty: CrmDb = { customers: [], followUps: [], schemes: [], orders: [] };
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * CRM 仓库（PostgreSQL + Prisma）
 * - getDb()：每次从数据库拉取全量快照到内存（规避一致性问题；表小、写少）
 * - persist()：全量对账（事务内 清空 → 重建，显式 id 保证主键与关联不变）
 */
@Injectable()
export class PrismaCrmRepository implements CrmRepository, OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  private db: CrmDb = empty;

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getDb(): Promise<CrmDb> {
    const [customers, followUps, schemes, orders] = await Promise.all([
      this.prisma.customer.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.followUp.findMany(),
      this.prisma.designScheme.findMany(),
      this.prisma.order.findMany(),
    ]);
    this.db = {
      customers: customers.map(toCustomer),
      followUps: followUps.map(toFollowUp),
      schemes: schemes.map(toScheme),
      orders: orders.map(toOrder),
    };
    return this.db;
  }

  async persist(): Promise<void> {
    const { customers, followUps, schemes, orders } = this.db;
    await this.prisma.$transaction(async (tx) => {
      // 删除顺序遵守外键：orders → schemes → followUps → customers
      await tx.order.deleteMany();
      await tx.designScheme.deleteMany();
      await tx.followUp.deleteMany();
      await tx.customer.deleteMany();
      // 重建（显式 id 保持主键/关联不变）
      if (customers.length) await tx.customer.createMany({ data: customers.map(toCustomerCreate) });
      if (schemes.length) await tx.designScheme.createMany({ data: schemes.map(toSchemeCreate) });
      if (followUps.length) await tx.followUp.createMany({ data: followUps.map(toFollowUpCreate) });
      if (orders.length) await tx.order.createMany({ data: orders.map(toOrderCreate) });
    });
  }
}

// ---------- 映射 ----------

function toCustomer(r: {
  id: string; name: string; phone: string; community: string | null; houseType: string | null;
  budget: number | null; source: string | null; status: string; createdAt: Date; updatedAt: Date;
}): Customer {
  return {
    id: r.id, name: r.name, phone: r.phone, community: r.community, houseType: r.houseType,
    budget: r.budget, source: r.source, status: r.status as Customer['status'],
    createdAt: iso(r.createdAt) ?? '', updatedAt: iso(r.updatedAt) ?? '',
  };
}

function toFollowUp(r: {
  id: string; customerId: string; content: string; nextFollowDate: Date | null; createdAt: Date;
}): FollowUp {
  return {
    id: r.id, customerId: r.customerId, content: r.content,
    nextFollowDate: iso(r.nextFollowDate), createdAt: iso(r.createdAt) ?? '',
  };
}

function toScheme(r: {
  id: string; customerId: string; name: string; totalWidth: number; totalHeight: number;
  seriesName: string; colorConfig: unknown; designData: unknown; schemaVersion: number;
  createdAt: Date; updatedAt: Date;
}): DesignScheme {
  return {
    id: r.id, customerId: r.customerId, name: r.name, totalWidth: r.totalWidth, totalHeight: r.totalHeight,
    seriesName: r.seriesName,
    colorConfig: (r.colorConfig ?? { outerColor: '', innerColor: '' }) as DesignScheme['colorConfig'],
    designData: Array.isArray(r.designData) ? (r.designData as DesignScheme['designData']) : [],
    schemaVersion: r.schemaVersion,
    createdAt: iso(r.createdAt) ?? '', updatedAt: iso(r.updatedAt) ?? '',
  };
}

function toOrder(r: {
  id: string; customerId: string; schemeId: string | null; status: string;
  totalAmount: number; deposit: number; balance: number; remark: string | null;
  createdAt: Date; updatedAt: Date;
}): Order {
  return {
    id: r.id, customerId: r.customerId, schemeId: r.schemeId, status: r.status as Order['status'],
    totalAmount: r.totalAmount, deposit: r.deposit, balance: r.balance, remark: r.remark,
    createdAt: iso(r.createdAt) ?? '', updatedAt: iso(r.updatedAt) ?? '',
  };
}

// 写入侧（createMany 字段与模型一致，Date 用 new Date(iso)）
const toCustomerCreate = (c: Customer) => ({
  id: c.id, name: c.name, phone: c.phone, community: c.community, houseType: c.houseType,
  budget: c.budget, source: c.source, status: c.status,
  createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt),
});
const toFollowUpCreate = (f: FollowUp) => ({
  id: f.id, customerId: f.customerId, content: f.content,
  nextFollowDate: f.nextFollowDate ? new Date(f.nextFollowDate) : null,
  createdAt: new Date(f.createdAt),
});
const toSchemeCreate = (s: DesignScheme) => ({
  id: s.id, customerId: s.customerId, name: s.name, totalWidth: s.totalWidth, totalHeight: s.totalHeight,
  seriesName: s.seriesName, colorConfig: s.colorConfig as object, designData: s.designData as object[],
  schemaVersion: s.schemaVersion, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt),
});
const toOrderCreate = (o: Order) => ({
  id: o.id, customerId: o.customerId, schemeId: o.schemeId, status: o.status,
  totalAmount: o.totalAmount, deposit: o.deposit, balance: o.balance, remark: o.remark,
  createdAt: new Date(o.createdAt), updatedAt: new Date(o.updatedAt),
});
