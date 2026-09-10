import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Order } from './orders.controller';

/**
 * 订单仓库：默认使用本地 JSON 文件持久化（重启不丢数据）。
 * 后续如需切换为 PostgreSQL + Prisma，只需替换本实现（实现同样的
 * findAll / create 行为）而不改动 Service/Controller。
 */
export interface OrderRepository {
  findAll(): Order[];
  findById(id: number): Order | undefined;
  create(order: Order): Order;
}

@Injectable()
export class JsonFileOrderRepository implements OrderRepository {
  private readonly filePath: string;
  private orders: Order[] = [];
  private nextId = 1;

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    this.filePath = path.join(dataDir, 'orders.json');
    this.load();
  }

  findAll(): Order[] {
    return this.orders;
  }

  findById(id: number): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  create(order: Order): Order {
    const saved: Order = { ...order, id: this.nextId++ };
    this.orders.push(saved);
    this.persist();
    return saved;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Order[];
      if (Array.isArray(raw)) {
        this.orders = raw;
        this.nextId = raw.reduce((m, o) => Math.max(m, o.id), 0) + 1;
      }
    } catch (err) {
      console.error('加载订单数据失败（将使用空库）:', err);
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.orders, null, 2), 'utf-8');
    } catch (err) {
      console.error('保存订单数据失败:', err);
    }
  }
}
